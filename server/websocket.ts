import { Server as SocketIOServer } from "socket.io";
import type { Server, IncomingMessage } from "http";
import { storage } from "./storage";
import session from "express-session";
import type { Request, Response } from "express";
import type { Session } from "express-session";
import connectPg from "connect-pg-simple";
import type { Socket } from "socket.io";
import type { InsertFoodTruckLocation } from "@shared/schema";
import { incConnect, incDisconnect, incSubscribeNearby, maybeWarnIfChurn } from "./utils/realtimeMetrics";

const PgSession = connectPg(session);

type ClientToServerEvents = {
  subscribe_nearby: (data: { latitude: number; longitude: number; radiusKm?: number }) => void;
  subscribe_restaurant: (data: { restaurantId: string }) => void;
  subscribe_kitchen: (data: { restaurantId: string }) => void;
  unsubscribe_kitchen: (data: { restaurantId: string }) => void;
  unsubscribe: (data: { room?: string }) => void;
  ping: () => void;
};

type NearbyTruck = Awaited<ReturnType<typeof storage.getLiveTrucksNearby>>[number];

type BroadcastLocation = {
  latitude: number | string;
  longitude: number | string;
  timestamp?: string;
  accuracy?: number | string | null;
  speed?: number | string | null;
  heading?: number | string | null;
  altitude?: number | string | null;
  [key: string]: unknown;
};

type ServerToClientEvents = {
  nearby_trucks: (payload: { trucks: NearbyTruck[] }) => void;
  error: (payload: { message: string }) => void;
  subscribed: (payload: { restaurantId: string; room: string }) => void;
  unsubscribed: (payload: { room: string }) => void;
  pong: (payload: Record<string, never>) => void;
  lisa_claim: (payload: {
    type: "lisa_claim";
    claim: {
      id?: string;
      lane: string;
      app: string;
      source: string;
      claimType: string;
      subjectType: string;
      subjectId: string;
      actorType?: string | null;
      actorId?: string | null;
      claimValue: Record<string, unknown>;
      confidence?: string | number | null;
      createdAt: string;
    };
  }) => void;
  location_update: (payload: { type: "location_update"; restaurantId: string; location: BroadcastLocation; timestamp: string }) => void;
  truck_location_update: (payload: { type: "truck_location_update"; restaurantId: string; location: BroadcastLocation; timestamp: string }) => void;
  status_update: (payload: { restaurantId: string; status: { isOnline: boolean; mobileOnline?: boolean } }) => void;
  'kitchen:order_update': (payload: { order: Record<string, unknown> }) => void;
};

type InterServerEvents = Record<string, never>;

type SocketData = {
  userId?: string | null;
  sessionID?: string;
  user?: Awaited<ReturnType<typeof storage.getUser>> | null;
};

type RealtimeSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData> & {
  userId?: string | null;
  sessionID?: string;
  user?: Awaited<ReturnType<typeof storage.getUser>> | null;
};

type SessionRequest = IncomingMessage & {
  session?: Session & { passport?: { user?: string } };
  sessionID?: string;
};

// Global WebSocket server instance
let io: SocketIOServer | null = null;

// Store user subscriptions for cleanup
const userSubscriptions = new Map<string, Set<string>>();

export function setupWebSocketServer(httpServer: Server): SocketIOServer {
  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) {
    throw new Error(
      "SESSION_SECRET is required for WebSocket session authentication"
    );
  }
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week

  // Session middleware configuration (same as Express app)
  const sessionMiddleware = session({
    store: new PgSession({
      conString: process.env.DATABASE_URL,
      tableName: 'sessions',
      createTableIfMissing: false,
      ttl: sessionTtl,
    }),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    proxy: true,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: sessionTtl,
    },
  });

  // Create Socket.IO server with restricted CORS
  const defaultOrigins = 'http://localhost:5000,http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174,https://meal-scout.vercel.app,https://mealscout.us,https://www.mealscout.us,https://mealscout.onrender.com';
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || defaultOrigins).split(',').map(o => o.trim());
  io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(httpServer, {
    path: "/socket.io",
    cors: {
      origin: function(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      },
      methods: ["GET", "POST"],
      credentials: true,
    },
    transports: ["polling", "websocket"],
  });

  // Connection handling - no auth middleware (TradeScout Law: read-only realtime discovery allowed)
  io.on("connection", async (socket: RealtimeSocket) => {
    incConnect();
    socket.userId = null;
    socket.sessionID = undefined;
    socket.user = null;
    
    // Extract session data if available (non-blocking, best-effort)
    sessionMiddleware(socket.request as unknown as Request, {} as unknown as Response, async () => {
      const session = (socket.request as SessionRequest).session;
      const user = session?.passport?.user;
      
      if (user) {
        socket.userId = user;
        socket.sessionID = (socket.request as SessionRequest).sessionID;
        socket.user = await storage.getUser(socket.userId);
        console.log(`WebSocket connected: ${socket.id}, userId: ${socket.userId}`);

        if (["staff", "admin", "super_admin"].includes(String(socket.user?.userType || ""))) {
          socket.join("admin_lisa");
        }
      } else {
        socket.userId = null;
        socket.sessionID = `anon_${Date.now()}_${Math.random()}`;
        console.log(`WebSocket connected: ${socket.id} (anonymous)`);
      }

      // Initialize user subscriptions tracking
      const userKey = socket.userId || socket.sessionID || `fallback_${socket.id}`;
      if (!userSubscriptions.has(userKey)) {
        userSubscriptions.set(userKey, new Set());
      }

      // Handle subscription to nearby trucks by location
      socket.on("subscribe_nearby", async (data: { latitude: number; longitude: number; radiusKm?: number }) => {
        try {
          incSubscribeNearby();
          const { latitude, longitude, radiusKm = 5 } = data;
          
          // Validate coordinates
          if (typeof latitude !== 'number' || typeof longitude !== 'number' ||
              latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
            socket.emit("error", { message: "Invalid coordinates" });
            return;
          }

          // Create geographic room key (grid-based approach for efficiency)
          const gridSize = 0.1; // ~11km grid squares
          const gridLat = Math.floor(latitude / gridSize) * gridSize;
          const gridLng = Math.floor(longitude / gridSize) * gridSize;
          const roomKey = `grid_${gridLat}_${gridLng}`;
          
          // Leave previous geographic rooms
          const userSubs = userSubscriptions.get(userKey);
          if (userSubs) {
            userSubs.forEach(room => {
              if (room.startsWith('grid_')) {
                socket.leave(room);
                userSubs.delete(room);
              }
            });
          }

          // Join new geographic room
          socket.join(roomKey);
          userSubs?.add(roomKey);

          // Send initial nearby trucks data
          const nearbyTrucks = await storage.getLiveTrucksNearby(latitude, longitude, radiusKm);
          socket.emit("nearby_trucks", { trucks: nearbyTrucks });
          
          console.log(`User ${userKey} subscribed to nearby trucks in ${roomKey}`);
        } catch (error) {
          console.error("Error handling nearby subscription:", error);
          socket.emit("error", { message: "Failed to subscribe to nearby trucks" });
        }
      });

      // Handle subscription to specific restaurant updates (for owners)
      socket.on("subscribe_restaurant", async (data) => {
        try {
          const { restaurantId } = data;
          
          if (!socket.user) {
            socket.emit("error", { message: "Authentication required" });
            return;
          }

          // Verify user owns this restaurant
          const isAuthorized = await storage.verifyRestaurantOwnership(
            restaurantId,
            socket.user.id,
            "manageProfile",
          );
          if (!isAuthorized) {
            socket.emit("error", { message: "Unauthorized: You can only subscribe to restaurants you own" });
            return;
          }

          const roomKey = `restaurant_${restaurantId}`;
          socket.join(roomKey);
          userSubscriptions.get(userKey)?.add(roomKey);
          
          socket.emit("subscribed", { restaurantId, room: roomKey });
          console.log(`User ${userKey} subscribed to restaurant ${restaurantId}`);
        } catch (error) {
          console.error("Error handling restaurant subscription:", error);
          socket.emit("error", { message: "Failed to subscribe to restaurant" });
        }
      });

      // Handle kitchen queue subscription (restaurant owners / staff)
      socket.on("subscribe_kitchen", async (data) => {
        try {
          const { restaurantId } = data;

          if (!socket.user) {
            socket.emit("error", { message: "Authentication required" });
            return;
          }

          const isAuthorized = await storage.verifyRestaurantOwnership(
            restaurantId,
            socket.user.id,
          );
          if (!isAuthorized) {
            socket.emit("error", { message: "Unauthorized: kitchen access denied" });
            return;
          }

          const roomKey = `kitchen:${restaurantId}`;
          socket.join(roomKey);
          userSubscriptions.get(userKey)?.add(roomKey);

          socket.emit("subscribed", { restaurantId, room: roomKey });
          console.log(`User ${userKey} subscribed to kitchen queue for ${restaurantId}`);
        } catch (error) {
          console.error("Error handling kitchen subscription:", error);
          socket.emit("error", { message: "Failed to subscribe to kitchen queue" });
        }
      });

      socket.on("unsubscribe_kitchen", (data) => {
        try {
          const roomKey = `kitchen:${data.restaurantId}`;
          const userSubs = userSubscriptions.get(userKey);
          if (userSubs?.has(roomKey)) {
            socket.leave(roomKey);
            userSubs.delete(roomKey);
            socket.emit("unsubscribed", { room: roomKey });
          }
        } catch (error) {
          console.error("Error handling kitchen unsubscribe:", error);
          socket.emit("error", { message: "Failed to unsubscribe from kitchen queue" });
        }
      });

      // Handle unsubscribe
      socket.on("unsubscribe", (data) => {
        try {
          const userSubs = userSubscriptions.get(userKey);
          if (data.room && userSubs?.has(data.room)) {
            socket.leave(data.room);
            userSubs.delete(data.room);
            socket.emit("unsubscribed", { room: data.room });
          }
        } catch (error) {
          console.error("Error handling unsubscribe:", error);
          socket.emit("error", { message: "Failed to unsubscribe" });
        }
      });

      // Handle ping for connection keepalive
      socket.on("ping", () => {
        try {
          socket.emit("pong", {});
        } catch (error) {
          console.error("Error handling ping:", error);
        }
      });

      // Handle disconnect
      socket.on("disconnect", (reason) => {
        console.log(`WebSocket disconnected: ${socket.id}, reason: ${reason}`);
        incDisconnect();
        maybeWarnIfChurn((msg) => console.warn(msg));
        
        // Clean up user subscriptions
        userSubscriptions.delete(userKey);
      });
    });
  });

  console.log("Socket.IO server setup complete at default path");
  return io;
}

// Broadcast location update to subscribers
export function broadcastLocationUpdate(restaurantId: string, locationData: BroadcastLocation) {
  if (!io) {
    console.warn("WebSocket server not initialized");
    return;
  }

  try {
    // Broadcast to restaurant-specific room (for owners)
    const restaurantRoom = `restaurant_${restaurantId}`;
    io.to(restaurantRoom).emit("location_update", {
      type: "location_update",
      restaurantId,
      location: locationData,
      timestamp: new Date().toISOString(),
    });

    // Broadcast to geographic grid rooms (for nearby customers)
    if (locationData.latitude && locationData.longitude) {
      const gridSize = 0.1;
      const latNum = typeof locationData.latitude === 'string' ? Number(locationData.latitude) : locationData.latitude;
      const lngNum = typeof locationData.longitude === 'string' ? Number(locationData.longitude) : locationData.longitude;

      if (Number.isNaN(latNum) || Number.isNaN(lngNum)) {
        console.warn("Skipping broadcast: invalid coordinates", locationData);
        return;
      }

      const gridLat = Math.floor(latNum / gridSize) * gridSize;
      const gridLng = Math.floor(lngNum / gridSize) * gridSize;
      
      // Broadcast to current grid and adjacent grids for seamless coverage
      for (let latOffset = -1; latOffset <= 1; latOffset++) {
        for (let lngOffset = -1; lngOffset <= 1; lngOffset++) {
          const targetGridLat = gridLat + (latOffset * gridSize);
          const targetGridLng = gridLng + (lngOffset * gridSize);
          const gridRoom = `grid_${targetGridLat}_${targetGridLng}`;
          
          io.to(gridRoom).emit("truck_location_update", {
            type: "truck_location_update",
            restaurantId,
            location: locationData,
            timestamp: new Date().toISOString(),
          });
        }
      }
    }

    console.log(`Broadcasted location update for restaurant ${restaurantId}`);
  } catch (error) {
    console.error("Error broadcasting location update:", error);
  }
}

// Broadcast status update (online/offline)
export function broadcastStatusUpdate(restaurantId: string, status: { isOnline: boolean; mobileOnline?: boolean }) {
  if (!io) {
    console.warn("WebSocket server not initialized");
    return;
  }

  try {
    // Broadcast to restaurant-specific room
    const restaurantRoom = `restaurant_${restaurantId}`;
    io.to(restaurantRoom).emit("status_update", {
      type: "status_update", 
      restaurantId,
      status,
      timestamp: new Date().toISOString(),
    });

    // Also broadcast to all geographic rooms if going offline
    if (!status.isOnline) {
      io.emit("truck_status_update", {
        type: "truck_status_update",
        restaurantId,
        status,
        timestamp: new Date().toISOString(),
      });
    }

    console.log(`Broadcasted status update for restaurant ${restaurantId}:`, status);
  } catch (error) {
    console.error("Error broadcasting status update:", error);
  }
}

export function broadcastLisaClaim(claim: {
  id?: string;
  app: string;
  source: string;
  claimType: string;
  subjectType: string;
  subjectId: string;
  actorType?: string | null;
  actorId?: string | null;
  claimValue: Record<string, unknown>;
  confidence?: string | number | null;
  createdAt?: string | Date | null;
}) {
  if (!io) {
    console.warn("WebSocket server not initialized");
    return;
  }

  try {
    const lane = [
      claim.app || "unknown",
      claim.source || "unknown",
      claim.claimType || "unknown",
      claim.subjectType || "unknown",
    ].join(":");

    io.to("admin_lisa").emit("lisa_claim", {
      type: "lisa_claim",
      claim: {
        ...claim,
        lane,
        createdAt:
          claim.createdAt instanceof Date
            ? claim.createdAt.toISOString()
            : claim.createdAt
              ? String(claim.createdAt)
              : new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error("Error broadcasting LISA claim:", error);
  }
}

// Get WebSocket server instance
export function getWebSocketServer(): SocketIOServer | null {
  return io;
}

// Get connection stats for monitoring
export function getConnectionStats() {
  if (!io) return { totalConnections: 0, rooms: [] };

  const sockets = io.sockets.sockets;
  const rooms = Array.from(io.sockets.adapter.rooms.keys()).filter(room => 
    !sockets.has(room) // Filter out socket IDs (which are also stored as rooms)
  );

  return {
    totalConnections: sockets.size,
    rooms: rooms,
    userSubscriptions: userSubscriptions.size,
  };
}
