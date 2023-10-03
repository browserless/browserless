const shimmableParams = [
  'headless',
  'stealth',
  'ignoreDefaultArgs',
  'blockAds',
  'slowMo',
];

const unsupportedParams = ['trackingId', 'keepalive'];

/**
 * Given a legacy connect or API call, this shim will
 * re-order the arguments to make them valid in the 2.0
 * world as much as possible.
 *
 * @param req A parsed user requests
 */
export const shimLegacyRequests = (params: Array<[string, string]>) => {
  const paramNames = params.map(([k]) => k);

  const badParams = paramNames.filter((name) =>
    unsupportedParams.includes(name),
  );

  if (badParams.length) {
    throw new Error(
      `Parameter(s) "${unsupportedParams.join(', ')}" are no longer supported.`,
    );
  }

  const hasLegacyParams =
    paramNames.some((name) => name.startsWith('--')) ||
    shimmableParams.some((name) => paramNames.includes(name));

  if (hasLegacyParams) {
    // shim params
  }
};
