import { createApiKeysRepository } from "./apiKeysRepository";
import { createAuthTokenLifecycleRepository } from "./authTokenLifecycleRepository";

export function createAuthTokensRepository() {
  return {
    ...createAuthTokenLifecycleRepository(),
    ...createApiKeysRepository(),
  };
}
