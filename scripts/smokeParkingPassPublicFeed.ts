import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";

process.env.NODE_ENV ||= "development";

const futureDate = (daysFromNow: number) => {
  const date = new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000);
  date.setHours(12, 0, 0, 0);
  return date.toISOString();
};

const parkingPassRow = (overrides: Record<string, unknown>) => ({
  id: "parking-pass-row",
  eventType: "parking_pass",
  title: "Parking Pass Host",
  status: "open",
  seriesStatus: "published",
  date: futureDate(1),
  startTime: "11:00",
  endTime: "22:00",
  maxTrucks: 2,
  spotCount: 2,
  bookedSpots: 0,
  availableSpotNumbers: [1, 2],
  host: {
    id: "host-row",
    businessName: "Parking Pass Host",
    address: "1 Main St",
    city: "Pensacola",
    state: "FL",
    latitude: "30.4213",
    longitude: "-87.2169",
    stripeConnectAccountId: "acct_test",
    stripeChargesEnabled: true,
  },
  ...overrides,
});

const listen = (server: http.Server) =>
  new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve(address.port);
    });
  });

const close = (server: http.Server) =>
  new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

const run = async () => {
  const { registerEventRoutes } = await import("../server/routes/eventRoutes");

  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.isAuthenticated = () => true;
    req.user = { id: "parking-pass-smoke-user" };
    next();
  });

  registerEventRoutes(app, {
    hasBusinessDistributionAccess: async () => true,
    parkingPassFeedBuilder: async () => [
      parkingPassRow({
        id: "deleted-host",
        status: "deleted",
        host: {
          id: "deleted-host",
          businessName: "My House",
          address: "99 Deleted Way",
          city: "Pensacola",
          state: "FL",
          latitude: "30.4213",
          longitude: "-87.2169",
          stripeConnectAccountId: "acct_deleted",
          stripeChargesEnabled: true,
        },
      }),
      parkingPassRow({
        id: "draft-series",
        seriesStatus: "draft",
      }),
      parkingPassRow({
        id: "expired-row",
        date: futureDate(-2),
      }),
      parkingPassRow({
        id: "full-row",
        availableSpotNumbers: [],
        bookedSpots: 2,
      }),
      parkingPassRow({
        id: "active-host",
        host: {
          id: "active-host",
          businessName: "Active Test Host",
          address: "101 Active Ave",
          city: "Pensacola",
          state: "FL",
          latitude: "30.4213",
          longitude: "-87.2169",
          stripeConnectAccountId: "acct_active",
          stripeChargesEnabled: true,
        },
      }),
    ],
  });

  const server = http.createServer(app);
  const port = await listen(server);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/parking-pass`);
    assert.equal(response.status, 200);

    const rows = (await response.json()) as Array<{ id?: string }>;
    const ids = rows.map((row) => row.id).sort();

    assert.deepEqual(ids, ["active-host"]);
    assert.equal(rows.length, 1);

    console.log("parking-pass public API smoke passed");
  } finally {
    await close(server);
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
