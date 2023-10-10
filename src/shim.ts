import { CDPLaunchOptions } from './types';
import { convertIfBase64, safeParse } from './utils.js';

const shimParam = ['headless', 'stealth', 'ignoreDefaultArgs', 'slowMo'];

/**
 * Given a legacy connect or API call, this shim will
 * re-order the arguments to make them valid in the 2.0
 * world as much as possible. It does not handle request
 * validation as that happens later downstream.
 *
 * @param req A parsed user requests
 */
export const shimLegacyRequests = (url: URL): URL => {
  const { searchParams } = url;
  const params = [...searchParams];
  const names = params.map(([k]) => k);

  const cliSwitches = params.filter(([name]) => name.startsWith('--'));
  const hasLegacyParams =
    cliSwitches || shimParam.some((name) => names.includes(name));

  if (hasLegacyParams) {
    const launchParams: CDPLaunchOptions =
      safeParse(convertIfBase64(searchParams.get('launch') || '{}')) || {};
    const ignoreDefaultArgs =
      searchParams.get('ignoreDefaultArgs') ?? launchParams.ignoreDefaultArgs;
    const stealth = searchParams.get('stealth') ?? launchParams.stealth;
    const slowMo = searchParams.get('slowMo') ?? launchParams.slowMo;
    const headless = searchParams.get('headless') ?? launchParams.headless;

    if (
      typeof headless !== 'undefined' &&
      launchParams.headless === undefined
    ) {
      launchParams.headless = headless === 'new' ? 'new' : headless !== 'false';
    }

    if (typeof slowMo !== 'undefined' && launchParams.slowMo === undefined) {
      launchParams.slowMo = +slowMo;
    }

    if (typeof stealth !== 'undefined' && launchParams.stealth === undefined) {
      launchParams.stealth = stealth !== 'false';
    }

    if (typeof stealth !== 'undefined' && launchParams.stealth === undefined) {
      launchParams.stealth = stealth !== 'false';
    }

    if (
      typeof ignoreDefaultArgs !== 'undefined' &&
      launchParams.ignoreDefaultArgs === undefined
    ) {
      const parsed =
        typeof ignoreDefaultArgs === 'string' && ignoreDefaultArgs.includes(',')
          ? ignoreDefaultArgs.split(',')
          : ignoreDefaultArgs;
      launchParams.ignoreDefaultArgs = Array.isArray(parsed)
        ? parsed
        : parsed !== 'false';
    }

    // Handle CLI switches
    if (cliSwitches.length) {
      launchParams.args = cliSwitches.map(([n, v]) => `${n}=${v}`);
    }

    shimParam.forEach((n) => searchParams.delete(n));
    cliSwitches.forEach(([n]) => searchParams.delete(n));
    searchParams.set('launch', JSON.stringify(launchParams));
  }

  return url;
};
