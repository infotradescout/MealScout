export function isRestaurantOrderingAuthorityVersionCurrent(input: {
  preflightVersion: unknown;
  lockedVersion: unknown;
}): boolean {
  const preflightVersion = Number(input.preflightVersion);
  const lockedVersion = Number(input.lockedVersion);
  return Boolean(
    Number.isInteger(preflightVersion) &&
      preflightVersion >= 0 &&
      Number.isInteger(lockedVersion) &&
      lockedVersion >= 0 &&
      preflightVersion === lockedVersion,
  );
}
