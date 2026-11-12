import * as http from 'http';
import {
  CDPLaunchOptions,
  Request,
  convertIfBase64,
  safeParse,
} from '@browserless.io/browserless';

const shimParam = [
  'headless',
  'stealth',
  'ignoreDefaultArgs',
  'slowMo',
  'ignoreHTTPSErrors',
];

/**
 * Obfuscates the ?token parameter by shifting it to a header instead of a query-parameter.
 * A header the client already sent wins. With a TOKEN_HEADER other than
 * Authorization, the raw token goes there, leaving Authorization to a proxy.
 */
export function moveTokenToHeader(
  req: http.IncomingMessage,
  tokenHeader = 'authorization',
): string {
  if (tokenHeader !== 'authorization') {
    (req as Request).tokenHeader = tokenHeader;
  }
  const requestUrl = req.url || '';
  const queryStart = requestUrl.indexOf('?');
  if (queryStart === -1) return requestUrl;

  const rawPathname = requestUrl
    .slice(0, queryStart)
    .replace(/^[A-Za-z][A-Za-z\d+.-]*:\/\/[^/]*/, '');
  const searchParams = new URLSearchParams(requestUrl.slice(queryStart + 1));
  const token = searchParams.get('token');

  if (token) {
    searchParams.delete('token');
    // Preserved separately so downstream code can tell this exact value
    // apart from whatever ends up in the token header below.
    (req as Request).queryToken = token;
    req.headers[tokenHeader] =
      req.headers[tokenHeader] ??
      (tokenHeader === 'authorization' ? `Bearer ${token}` : token);
    const search = searchParams.toString();
    req.url = `${rawPathname || '/'}${search ? `?${search}` : ''}`;
  }

  return req.url!;
}

/**
 * Given a legacy connect or API call, this shim will
 * re-order the arguments to make them valid in the 2.0
 * world as much as possible. It does not handle request
 * validation as that happens later downstream.
 *
 * @param req A parsed user requests
 */
export function shimLegacyRequests(url: URL): URL {
  const { searchParams } = url;
  const params = [...searchParams];
  const names = params.map(([k]) => k);

  const cliSwitches = params.filter(([name]) => name.startsWith('--'));
  const hasLegacyParams =
    cliSwitches.length || shimParam.some((name) => names.includes(name));

  if (hasLegacyParams) {
    const parsedLaunch = safeParse(
      convertIfBase64(searchParams.get('launch') || '{}'),
    );
    // The shim writes onto launchParams below, so fall back to {} unless the
    // parsed value is a plain object — a primitive/array `launch` would throw.
    const launchParams = (
      parsedLaunch &&
      typeof parsedLaunch === 'object' &&
      !Array.isArray(parsedLaunch)
        ? parsedLaunch
        : {}
    ) as CDPLaunchOptions;
    const ignoreDefaultArgs =
      searchParams.get('ignoreDefaultArgs') ?? launchParams.ignoreDefaultArgs;
    const ignoreHTTPSErrors =
      searchParams.get('ignoreHTTPSErrors') ?? launchParams.ignoreHTTPSErrors;
    const stealth = searchParams.get('stealth') ?? launchParams.stealth;
    const slowMo = searchParams.get('slowMo') ?? launchParams.slowMo;
    const headless = searchParams.get('headless') ?? launchParams.headless;

    if (
      typeof headless !== 'undefined' &&
      launchParams.headless === undefined
    ) {
      launchParams.headless =
        headless === 'shell' ? 'shell' : headless !== 'false';
    }

    if (typeof slowMo !== 'undefined' && launchParams.slowMo === undefined) {
      launchParams.slowMo = +slowMo;
    }

    if (typeof stealth !== 'undefined' && launchParams.stealth === undefined) {
      launchParams.stealth = stealth !== 'false';
    }

    if (
      typeof ignoreHTTPSErrors !== 'undefined' &&
      launchParams.ignoreHTTPSErrors === undefined
    ) {
      launchParams.ignoreHTTPSErrors = ignoreHTTPSErrors !== 'false';
    }

    // When acceptInsecureCerts is set, ignoreHTTPSErrors is ignored
    if (launchParams.acceptInsecureCerts !== undefined) {
      launchParams.ignoreHTTPSErrors = undefined;
    }

    // When ignoreHTTPSErrors sent, convert it to acceptInsecureCerts
    if (
      typeof ignoreHTTPSErrors !== 'undefined' &&
      launchParams.acceptInsecureCerts === undefined
    ) {
      launchParams.acceptInsecureCerts = ignoreHTTPSErrors !== 'false';
      launchParams.ignoreHTTPSErrors = undefined;
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

    // Explicit launch options take precedence over legacy parameters.
    // Leave malformed args intact for downstream request validation.
    if (
      cliSwitches.length &&
      (launchParams.args === undefined || Array.isArray(launchParams.args))
    ) {
      const args = launchParams.args ?? [];
      launchParams.args = [
        ...args,
        ...cliSwitches
          .filter(
            ([name]) =>
              !args.some(
                (arg) => typeof arg === 'string' && arg.split('=')[0] === name,
              ),
          )
          .map(([name, value]) => `${name}=${value}`),
      ];
    }

    shimParam.forEach((n) => searchParams.delete(n));
    cliSwitches.forEach(([n]) => searchParams.delete(n));
    searchParams.set('launch', JSON.stringify(launchParams));
  }

  return url;
}
