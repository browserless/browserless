import { convertIfBase64, safeParse } from './utils.js';
import { CDPLaunchOptions } from './types';

const shimParam = [
  'headless',
  'stealth',
  'ignoreDefaultArgs',
  'blockAds',
  'slowMo',
];

/**
 * Given a legacy connect or API call, this shim will
 * re-order the arguments to make them valid in the 2.0
 * world as much as possible. It does not handle request
 * validation as that happens later downstream.
 *
 * @param req A parsed user requests
 */
export const shimLegacyRequests = (url: URL) => {
  const { searchParams } = url;
  const params = [...searchParams];
  const names = params.map(([k]) => k);

  const hasCLISwitches = names.some((name) => name.startsWith('--'));
  const hasLegacyParams =
    hasCLISwitches ||
    shimParam.some((name) => names.includes(name));

  if (hasLegacyParams) {
    const launchParams: CDPLaunchOptions =
      safeParse(convertIfBase64(searchParams.get('launch') || '{}')) || {};
    const ignoreDefaultArgs =
      searchParams.get('ignoreDefaultArgs') ?? launchParams.ignoreDefaultArgs;
    const stealth = searchParams.get('stealth') ?? launchParams.stealth;
    const slowMo = searchParams.get('slowMo') ?? launchParams.slowMo;
    const headless = searchParams.get('headless') ?? launchParams.headless;

    if (typeof headless !== 'undefined') {
      launchParams.headless = headless === 'new' ? 'new' : headless !== 'false';
    }

    if (typeof slowMo !== 'undefined') {
      launchParams.slowMo = +slowMo;
    }

    if (typeof stealth !== 'undefined') {
      launchParams.stealth = !!stealth;
    }

    if (typeof ignoreDefaultArgs !== 'undefined') {
      launchParams.ignoreDefaultArgs = Array.isArray(ignoreDefaultArgs)
        ? ignoreDefaultArgs
        : ignoreDefaultArgs !== 'false';
    }

    // Handle CLI switches
    if (hasCLISwitches) {

    }
  }
};
