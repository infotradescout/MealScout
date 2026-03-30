import type { Express } from "express";

import { registerSystemUtilityRoutes } from "./systemUtilityRoutes";

export async function registerRuntimeBootstrapRoutes(app: Express) {
  app.head("/api", (_req, res) => {
    res.status(200).end();
  });

  const setupStoriesRoutes = (await import("../storiesRoutes")).default;
  setupStoriesRoutes(app);

  const incidentRoutes = (await import("../incidentRoutes")).default;
  app.use("/api/incidents", incidentRoutes);
  registerSystemUtilityRoutes(app, { incidentRoutes });

  const adminRoutes = (await import("../adminRoutes")).default;
  app.use("/api/admin", adminRoutes);

  const telemetryRoutes = (await import("../telemetryRoutes")).default;
  app.use("/api/admin/telemetry", telemetryRoutes);

  const evidenceExportRoutes = (await import("../evidenceExportRoutes"))
    .default;
  app.use("/api/admin", evidenceExportRoutes);

  const affiliateRoutes = (await import("../affiliateRoutes")).default;
  app.use("/api/affiliate", affiliateRoutes);

  const setupPayoutRoutes = (await import("../payoutRoutes")).default;
  setupPayoutRoutes(app);

  const setupEmptyCountyRoutes = (await import("../emptyCountyRoutes")).default;
  setupEmptyCountyRoutes(app);

  const setupShareRoutes = (await import("../shareRoutes")).default;
  setupShareRoutes(app);

  const userRoutes = (await import("../userRoutes")).default;
  app.use("/api/users", userRoutes);

  const redemptionRoutes = (await import("../redemptionRoutes")).default;
  app.use("/api/restaurants", redemptionRoutes);

  const { shareUrlMiddleware } = await import("../shareMiddleware");
  app.use(shareUrlMiddleware);
}
