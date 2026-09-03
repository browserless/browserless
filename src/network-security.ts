import {
  Forbidden,
  findBlockedUrlInMessage,
  normalizeUrlForBlocklist,
} from './utils.js';

/**
 * Describes the network destinations the browser is not allowed to navigate to
 * (or load subresources from). Supplied by `Config.getBlockedNetworkRanges()`.
 *
 * A `null` range set — the default — disables private-network navigation
 * blocking entirely, so the matcher is inert unless a consumer opts in.
 *
 * - `ipv4Prefixes` — dotted-decimal prefixes matched against a canonicalized
 *   IPv4 literal host (e.g. `'127.'`, `'169.254.'`, `'0.'`). Decimal, octal,
 *   hex and short-form IPv4 are canonicalized to dotted-quad before matching,
 *   so only the canonical form needs listing.
 * - `ipv6Prefixes` — prefixes matched against the bracket-stripped IPv6 host
 *   (e.g. `'::1'`, `'fe80:'`, `'::ffff:'`).
 * - `protocols` — URL schemes blocked outright (e.g. `'smtp://'`, `'ftp://'`).
 *   `file://` is governed separately, by `Config.getBlockedURLPatterns()`.
 * - `hostnames` — blocked by exact match or as a dot-suffix (e.g. `'localhost'`
 *   blocks both `localhost` and `*.localhost`, which resolve to loopback).
 */
export interface NetworkRangeSet {
  ipv4Prefixes: string[];
  ipv6Prefixes: string[];
  protocols: string[];
  hostnames: string[];
}

/**
 * A host made only of digits and dots is an IPv4 literal — `new URL()` has
 * already canonicalized decimal/octal/hex/short forms to dotted-quad by the
 * time this is tested. A hostname that merely starts with digits (e.g.
 * `0.example.com`) is not, and must NOT be prefix-matched against IPv4 ranges.
 */
export const looksLikeIPv4Literal = (host: string): boolean =>
  /^[0-9.]+$/.test(host);

const isBlockedNavigationHost = (
  host: string,
  ranges: NetworkRangeSet,
): boolean => {
  if (host.startsWith('[')) {
    // IPv6 literal — covers ::1, ::ffff:<v4>, fc/fd ULA, fe80 link-local, etc.
    const inner = host.slice(1, -1);
    return ranges.ipv6Prefixes.some((prefix) => inner.startsWith(prefix));
  }
  if (looksLikeIPv4Literal(host)) {
    return ranges.ipv4Prefixes.some((prefix) => host.startsWith(prefix));
  }
  return ranges.hostnames.some(
    (name) => host === name || host.endsWith(`.${name}`),
  );
};

/**
 * Decides whether the browser may navigate to (or load a subresource from) a
 * URL, given a {@link NetworkRangeSet}. Robust against IPv6-mapped (`::ffff:`),
 * alternate-encoding (decimal/octal/hex) and `view-source:` / control-char
 * obfuscations — candidate canonicalization is shared with the scheme blocklist
 * via {@link normalizeUrlForBlocklist}.
 *
 * Returns `false` when `ranges` is `null` (blocking disabled). Returns `true`
 * (blocked) for unparseable URLs as a safety measure.
 *
 * `allowedHosts` is an optional set of `host[:port]` values (matched against the
 * URL's `host`, so it is port-specific) that are never blocked — used to let the
 * browser reach the server's own origin (see `Config.getSelfNavigationHosts()`)
 * even when it binds an address the range set would otherwise reject.
 */
export const isBlockedNavigationUrl = (
  rawUrl: string,
  ranges: NetworkRangeSet | null,
  allowedHosts?: readonly string[],
): boolean => {
  if (!ranges) return false;
  const normalized = normalizeUrlForBlocklist(rawUrl);
  if (ranges.protocols.some((proto) => normalized.startsWith(proto))) {
    return true;
  }
  try {
    const { host, hostname } = new URL(normalized);
    if (allowedHosts?.includes(host)) return false;
    return isBlockedNavigationHost(hostname, ranges);
  } catch {
    return true;
  }
};

/**
 * Decides whether a raw IP address (e.g. puppeteer's
 * `response.remoteAddress().ip`) is blocked. The browser reports a canonical
 * IP, so no encoding normalization is needed. Returns `false` when `ranges` is
 * `null`.
 */
export const isBlockedNavigationIP = (
  ip: string,
  ranges: NetworkRangeSet | null,
): boolean => {
  if (!ranges) return false;
  const host = ip.toLowerCase().replace(/^\[|\]$/g, '');
  if (host.includes(':')) {
    return ranges.ipv6Prefixes.some((prefix) => host.startsWith(prefix));
  }
  if (looksLikeIPv4Literal(host)) {
    return ranges.ipv4Prefixes.some((prefix) => host.startsWith(prefix));
  }
  return false;
};

/**
 * Composes both navigation blocklists for a single candidate URL: the
 * scheme/prefix list from `Config.getBlockedURLPatterns()` (e.g. `file://`) and
 * the private-network host classifier from `Config.getBlockedNetworkRanges()`.
 * Returns the offending pattern or URL, or `null`. This is the single check a
 * route should run before navigating, to reject with a clean status rather than
 * relying on a mid-navigation teardown.
 */
export const findBlockedNavigationUrl = (
  url: string,
  patterns: string[],
  ranges: NetworkRangeSet | null,
  allowedHosts?: readonly string[],
): string | null =>
  findBlockedUrlInMessage({ url }, patterns) ??
  (isBlockedNavigationUrl(url, ranges, allowedHosts) ? url : null);

/**
 * Whether a wire-protocol method initiates a navigation, across the CDP and
 * Playwright JSON-RPC formats. {@link findBlockedNavigationInMessage} is scoped
 * to these so the host check never fires on a frame that merely carries a `url`
 * field for some non-navigation purpose (e.g. setting a cookie). Matches both
 * Playwright spellings (`goto` and the channel-qualified `Frame.goto`).
 */
const isNavigationMethod = (method: string): boolean =>
  method === 'Page.navigate' || // CDP
  method === 'Target.createTarget' || // CDP
  method === 'goto' ||
  method.endsWith('.goto'); // Playwright Frame.goto

/**
 * Returns the blocked navigation target inside a wire-protocol message (a CDP
 * or Playwright JSON-RPC frame), or `null`. Only inspects navigation-creating
 * methods, so it cannot over-block on frames that incidentally carry a `url`.
 * Returns `null` when `ranges` is `null` (guard disabled). Lets a route's
 * WebSocket bridge reject private-network navigations the same way the HTTP
 * handlers do.
 */
export const findBlockedNavigationInMessage = (
  message: unknown,
  ranges: NetworkRangeSet | null,
  allowedHosts?: readonly string[],
): string | null => {
  if (!ranges || !message || typeof message !== 'object') return null;
  const { method, params } = message as {
    method?: unknown;
    params?: { url?: unknown };
  };
  if (
    typeof method === 'string' &&
    isNavigationMethod(method) &&
    typeof params?.url === 'string' &&
    isBlockedNavigationUrl(params.url, ranges, allowedHosts)
  ) {
    return params.url;
  }
  return null;
};

/**
 * Throws {@link Forbidden} (→ HTTP 403) when `url` is a blocked navigation
 * target, so route handlers can reject before navigating rather than letting a
 * mid-navigation teardown surface as a 500. No-op when `url` is empty (e.g. an
 * `html`-only request that never navigates).
 */
export const assertNavigationAllowed = (
  url: string | undefined,
  patterns: string[],
  ranges: NetworkRangeSet | null,
  allowedHosts?: readonly string[],
): void => {
  if (!url) return;
  const blocked = findBlockedNavigationUrl(url, patterns, ranges, allowedHosts);
  if (blocked) {
    throw new Forbidden(`Navigation to "${blocked}" is not allowed`);
  }
};

/**
 * Builds the `Fetch.enable` URL patterns that decide which requests are paused
 * for a blocklist verdict. Everything the matcher could reject must match one
 * of these — a request that is never paused is never checked — so the patterns
 * deliberately over-match and leave the real decision to
 * {@link findBlockedNavigationUrl}, which canonicalizes and understands the
 * self-origin exemption. A pause that resolves to "allowed" costs one
 * `Fetch.continueRequest`; a miss costs the guard entirely.
 *
 * Over-matching is why these are not the blocklist itself: `*://127.*` also
 * pauses `http://127.example.com/`, and `*://localhost*` also pauses
 * `https://localhostings.com/` — both continue on unchanged once the matcher
 * has looked at them.
 *
 * Chromium canonicalizes a URL before matching, so decimal (`http://2130706433/`)
 * and hex (`http://0x7f.0.0.1/`) IPv4 forms arrive here already spelled as
 * dotted-quad and are caught by the numeric prefixes. IPv6 literals are covered
 * wholesale by `*://[*` rather than per-prefix, since the bracket form is rare
 * enough that pausing all of it is cheaper than getting the prefixes right.
 *
 * Userinfo is NOT canonicalized away: a navigation to
 * `http://user@127.0.0.1/` reaches the pattern matcher with the credentials
 * still in the string, where `*://127.*` does not match because `user@` sits
 * between the scheme and the host. Every host-shaped glob therefore gets a
 * `*://*@…` twin. (Credentialed *sub-resources* never get this far — Chromium
 * blocks them outright — but a credentialed navigation does, and without the
 * twin it would slip past interception into the observational path, which can
 * only react once the request is already gone.)
 *
 * Returns `[]` when nothing is configured to block, which callers should treat
 * as "do not enable interception at all".
 */
export const toBlockedUrlInterceptPatterns = (
  patterns: string[],
  ranges: NetworkRangeSet | null,
): string[] => {
  const globs = new Set<string>();

  // Scheme blocklists (`file://`) and blocked protocols (`smtp://`, `ftp://`)
  // are already prefixes of the URL, so they need only a trailing wildcard —
  // userinfo sits after the scheme, so these cover the credentialed form too.
  for (const pattern of [...patterns, ...(ranges?.protocols ?? [])]) {
    globs.add(`${pattern}*`);
  }

  // Both spellings of a host-shaped glob: bare, and with userinfo ahead of it.
  const addHostGlob = (host: string) => {
    globs.add(`*://${host}*`);
    globs.add(`*://*@${host}*`);
  };

  if (ranges) {
    for (const prefix of ranges.ipv4Prefixes) {
      addHostGlob(prefix);
    }
    if (ranges.ipv6Prefixes.length) {
      addHostGlob('[');
    }
    for (const hostname of ranges.hostnames) {
      // The host itself, plus the dot-suffix form the classifier also blocks.
      addHostGlob(hostname);
      addHostGlob(`*.${hostname}`);
    }
  }

  return [...globs];
};
