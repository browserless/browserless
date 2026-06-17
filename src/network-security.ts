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
 */
export const isBlockedNavigationUrl = (
  rawUrl: string,
  ranges: NetworkRangeSet | null,
): boolean => {
  if (!ranges) return false;
  const normalized = normalizeUrlForBlocklist(rawUrl);
  if (ranges.protocols.some((proto) => normalized.startsWith(proto))) {
    return true;
  }
  try {
    return isBlockedNavigationHost(new URL(normalized).hostname, ranges);
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
): string | null =>
  findBlockedUrlInMessage({ url }, patterns) ??
  (isBlockedNavigationUrl(url, ranges) ? url : null);

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
    isBlockedNavigationUrl(params.url, ranges)
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
): void => {
  if (!url) return;
  const blocked = findBlockedNavigationUrl(url, patterns, ranges);
  if (blocked) {
    throw new Forbidden(`Navigation to "${blocked}" is not allowed`);
  }
};
