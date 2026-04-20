import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from './useAuth';
import { io, Socket } from 'socket.io-client';
import { API_BASE_URL } from "@/lib/api";

// Sockets are ON by default; set VITE_ENABLE_SOCKETS=false to disable
const ENABLE_SOCKETS = import.meta.env.VITE_ENABLE_SOCKETS !== "false";

interface FoodTruckLocation {
  restaurantId: string;
  latitude: number;
  longitude: number;
  heading?: number;
  speed?: number;
  accuracy?: number;
  timestamp: string;
  sessionId: string;
}

interface FoodTruckStatus {
  restaurantId: string;
  isOnline: boolean;
  lastSeen: string;
  sessionId?: string;
}

interface UseFoodTruckSocketProps {
  onLocationUpdate?: (location: FoodTruckLocation) => void;
  onStatusUpdate?: (status: FoodTruckStatus) => void;
  autoConnect?: boolean;
}

export function useFoodTruckSocket({
  onLocationUpdate,
  onStatusUpdate,
  autoConnect = true
}: UseFoodTruckSocketProps = {}) {
  const { user } = useAuth();
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  type ClientToServerEvents = {
    subscribe_nearby: (data: { latitude: number; longitude: number; radiusKm?: number }) => void;
    subscribe_restaurant: (data: { restaurantId: string }) => void;
    auth: (data: { userId: string }) => void;
  };

  type ServerToClientEvents = {
    location_update: (payload: { type: 'location_update'; restaurantId: string; location: Record<string, unknown>; timestamp: string }) => void;
    truck_location_update: (payload: { type: 'truck_location_update'; restaurantId: string; location: Record<string, unknown>; timestamp: string }) => void;
    status_update: (payload: { restaurantId: string; status: { isOnline: boolean; mobileOnline?: boolean } }) => void;
    nearby_trucks: (payload: { trucks: unknown[] }) => void;
    error: (payload: { message: string }) => void;
    pong: (payload: Record<string, never>) => void;
    subscribed: (payload: { restaurantId: string; room: string }) => void;
    unsubscribed: (payload: { room: string }) => void;
  };

  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const subscriptionQueueRef = useRef<string[]>([]);
  
  const maxReconnectAttempts = 10; // Increased for free tier wake-up
  const baseReconnectDelay = 3000; // 3 seconds to allow backend spin-up

  const connect = useCallback(() => {
    if (!ENABLE_SOCKETS) {
      return;
    }

    if (socketRef.current?.connected) return;

    try {
      // Create Socket.IO connection via same-origin proxy (no explicit URL)
      // Allow polling first for dev compatibility, then upgrade to websocket
      const socketUrl = import.meta.env.DEV ? undefined : (API_BASE_URL || undefined);
      const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(socketUrl, {
        autoConnect: true,
        transports: ['polling', 'websocket'],
        withCredentials: true,
        path: '/socket.io',
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 3000,
        reconnectionDelayMax: 10000,
        timeout: 20000 // Allow time for Render free tier to wake up
      });
      
      socketRef.current = socket;

      socket.on('connect', () => {
        console.log('Food truck Socket.IO connected');
        setIsConnected(true);
        setConnectionError(null);
        setReconnectAttempts(0);

        // Send authentication if user is logged in - Socket.IO style
        if (user && user.id) {
          socket.emit('auth', { userId: user.id });
        }

        // Process queued subscriptions now that connection is established
        if (subscriptionQueueRef.current.length > 0) {
          console.log('Processing queued subscriptions:', subscriptionQueueRef.current.length);
          subscriptionQueueRef.current.forEach(channel => {
            // Parse the channel to extract subscription data
            if (channel.startsWith('nearby:')) {
              const parts = channel.split(':');
              const latitude = parseFloat(parts[1]);
              const longitude = parseFloat(parts[2]);
              const radiusKm = parseInt(parts[3]) / 1000; // Convert meters to km
              socket.emit('subscribe_nearby', { latitude, longitude, radiusKm });
            } else if (channel.startsWith('restaurant:')) {
              const restaurantId = channel.split(':')[1];
              socket.emit('subscribe_restaurant', { restaurantId });
            }
          });
          subscriptionQueueRef.current = []; // Clear the queue
        }
      });

      // Handle location updates
      socket.on('location_update', (data) => {
        const locData = data.location || {};
        const toNumber = (v: unknown): number | undefined => {
          if (typeof v === 'number') return v;
          if (typeof v === 'string') {
            const n = Number(v);
            return Number.isNaN(n) ? undefined : n;
          }
          return undefined;
        };

        const mapped: FoodTruckLocation = {
          restaurantId: data.restaurantId,
          latitude: toNumber((locData as any).latitude) ?? 0,
          longitude: toNumber((locData as any).longitude) ?? 0,
          heading: toNumber((locData as any).heading),
          speed: toNumber((locData as any).speed),
          accuracy: toNumber((locData as any).accuracy),
          timestamp: data.timestamp,
          sessionId: (locData as any).sessionId ?? ''
        };

        onLocationUpdate?.(mapped);
      });

      // Handle status updates
      socket.on('status_update', (data) => {
        const mapped: FoodTruckStatus = {
          restaurantId: data.restaurantId,
          isOnline: !!data.status?.isOnline,
          lastSeen: new Date().toISOString(),
          sessionId: undefined,
        };
        onStatusUpdate?.(mapped);
      });

      // Handle nearby trucks data
      socket.on('nearby_trucks', (data) => {
        console.log('Received nearby trucks:', data.trucks?.length || 0);
        // This can be handled by parent components if needed
      });

      // Handle errors
      socket.on('error', (error) => {
        console.error('Socket.IO server error:', error.message || error);
        setConnectionError(error.message || 'Server error');
      });

      socket.on('disconnect', (reason: Socket.DisconnectReason) => {
        console.log('Food truck Socket.IO disconnected:', reason);
        setIsConnected(false);
        socketRef.current = null;

        // Socket.IO handles reconnection automatically, but we track attempts
        if (reason === 'io server disconnect' || reason === 'io client disconnect') {
          // Intentional disconnect - don't reconnect
          return;
        }

        // For other disconnects, Socket.IO will auto-reconnect, so we just track state
        if (reconnectAttempts < maxReconnectAttempts && autoConnect) {
          setReconnectAttempts(prev => prev + 1);
          console.log(`Socket.IO will attempt auto-reconnect (attempt ${reconnectAttempts + 1}/${maxReconnectAttempts})`);
        } else if (reconnectAttempts >= maxReconnectAttempts) {
          console.log('Max reconnection attempts reached. Food truck updates disabled.');
          setConnectionError('Connection failed after multiple attempts');
        }
      });

      socket.on('connect_error', (error) => {
        console.error('Socket.IO connection error:', error);
        setConnectionError('Socket connection failed');
      });

    } catch (error) {
      console.error('Failed to create Socket.IO connection:', error);
      setConnectionError('Failed to establish connection');
    }
  }, [user, onLocationUpdate, onStatusUpdate, autoConnect, reconnectAttempts]);

  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    
    setIsConnected(false);
    setConnectionError(null);
    setReconnectAttempts(0);
  }, []);

  const subscribeToNearby = useCallback((latitude: number, longitude: number, radiusKm: number = 5000) => {
    if (socketRef.current?.connected) {
      console.log('Subscribing to nearby trucks:', { latitude, longitude, radiusKm: radiusKm / 1000 });
      socketRef.current.emit('subscribe_nearby', { latitude, longitude, radiusKm: radiusKm / 1000 });
    } else {
      // Queue subscription for when connection is established  
      const channel = `nearby:${latitude.toFixed(4)}:${longitude.toFixed(4)}:${radiusKm}`;
      console.log('Queueing subscription for nearby trucks:', channel);
      subscriptionQueueRef.current = [channel];
    }
  }, []);

  const subscribeToRestaurant = useCallback((restaurantId: string) => {
    if (socketRef.current?.connected) {
      console.log('Subscribing to restaurant updates:', restaurantId);
      socketRef.current.emit('subscribe_restaurant', { restaurantId });
    } else {
      // Queue subscription for when connection is established
      subscriptionQueueRef.current.push(`restaurant:${restaurantId}`);
    }
  }, []);

  // Auto-connect on mount if enabled
  useEffect(() => {
    if (autoConnect && ENABLE_SOCKETS) {
      connect();
    }
  }, [connect, autoConnect]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    isConnected,
    connectionError,
    connect,
    disconnect,
    subscribeToNearby,
    subscribeToRestaurant,
    reconnectAttempts,
    socket: socketRef.current
  };
}

// Legacy hook name for backward compatibility
export const useFoodTruckWebSocket = useFoodTruckSocket;

// Fallback polling hook for when WebSocket is not available
export function useFoodTruckPolling(interval: number = 30000) {
  const [foodTrucks, setFoodTrucks] = useState<FoodTruckLocation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchFoodTrucks = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await fetch(API_BASE_URL ? `${API_BASE_URL}/api/trucks/live` : '/api/trucks/live', {
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error('Failed to fetch food trucks');
      }
      const data = await response.json();
      setFoodTrucks(data.trucks || []);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFoodTrucks(); // Initial fetch
    const intervalId = setInterval(fetchFoodTrucks, interval);
    
    return () => clearInterval(intervalId);
  }, [fetchFoodTrucks, interval]);

  return {
    foodTrucks,
    isLoading,
    error,
    refetch: fetchFoodTrucks
  };
}