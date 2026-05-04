/**
 * Bootstrap module barrel.
 * Import from here to wire up all startup concerns in server/index.ts.
 */

export { registerSchedulers } from "./registerSchedulers";
export { registerStaticPages } from "./registerStaticPages";
export { registerOperationalEndpoints } from "./registerOperationalEndpoints";
export { registerRecurringJobs } from "./registerRecurringJobs";
export { ensureMenuSchema } from "./ensureMenuSchema";
