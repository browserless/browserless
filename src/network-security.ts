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
 * Chromium matches a `Network.setBlockedURLs` pattern by splitting it on `*`
 * and requiring each piece to appear in the URL in order, so a pattern with no
 * `*` is a plain substring test and there is no way to anchor one to the start
 * or the end of the URL. Mirrored here so {@link toBlockedUrlPatterns} can work
 * out which of its own patterns would swallow the server's own origin, under
 * exactly the rules the browser will apply.
 */
export const matchesBlockedUrlPattern = (
  url: string,
  pattern: string,
): boolean => {
  let from = 0;
  for (const piece of pattern.split('*')) {
    if (!piece) continue;
    const at = url.indexOf(piece, from);
    if (at === -1) return false;
    from = at + piece.length;
  }
  return true;
};

// A host sits between the scheme separator (or the userinfo, in a credentialed
// URL) and either its port or the path. Against a matcher with no anchors of
// its own, those four strings are the only way to say "this is the host".
const HOST_STARTS = ['://', '@'] as const;
const HOST_ENDS = ['/', ':'] as const;
// `url.spec()` always carries a path, so a host is always followed by `/` or
// `:` — a pattern never has to consider `?` or `#` sitting directly after it.
const PATH_END = '/';
const DIGITS = '0123456789';
// What can follow a partial match inside a blocked origin: more of the host
// (IPv4 literals are digits and dots), or the port.
const HOST_CHARS = `${DIGITS}.:`;

/**
 * Every spelling of a blocked hostname, anchored at both ends. The classifier
 * blocks the name itself and any sub-domain of it, and the anchors are what
 * keep `localhost` from also blocking `localhostings.com` — a substring
 * matcher would otherwise treat the lookalike as a hit.
 */
const hostnamePatterns = (hostname: string): string[] => [
  ...HOST_STARTS.flatMap((start) =>
    HOST_ENDS.map((end) => `${start}${hostname}${end}`),
  ),
  // Sub-domains: the leading dot anchors these on its own, credentials or not.
  ...HOST_ENDS.map((end) => `.${hostname}${end}`),
];

/**
 * An IPv4 prefix, with the characters that can legitimately follow it pinned
 * after it. Pinning is what stops `0.` from also blocking `0.gravatar.com` — a
 * real host on a great many WordPress sites, which is exactly the sort of page
 * this guard runs against. Chromium canonicalizes decimal
 * (`http://2130706433/`) and hex (`http://0x7f.0.0.1/`) forms to dotted-quad
 * before matching, so only the canonical spelling needs listing.
 *
 * What may follow depends on where the prefix stops, and getting it wrong is
 * silent. The classifier prefix-matches the host, so a prefix that stops
 * mid-octet — `169.254`, which is how enterprise spells the cloud-metadata
 * range — continues with the rest of that octet *or* with the dot that ends
 * it. Pinning only a digit there yields `://169.2540`…`://169.2549`, none of
 * which can ever match `169.254.169.254`: the range reads as configured and
 * blocks nothing. A prefix that is a whole address (`127.0.0.1`) likewise has
 * to let the host end, hence the terminators.
 */
const ipv4Patterns = (prefix: string): string[] => {
  const continuations = prefix.endsWith('.')
    ? // Already at a dot boundary, so only another octet can follow.
      [...DIGITS]
    : [
        // The rest of the octet, the octet after it, or the end of the host.
        // The dot carries a digit rather than standing alone: the classifier
        // only prefix-matches hosts that are all digits and dots, so a bare
        // `://169.254.` would also block `169.254.example.com`, which it
        // treats as an ordinary name and allows.
        ...DIGITS,
        ...[...DIGITS].map((digit) => `.${digit}`),
        ...HOST_ENDS,
      ];

  return continuations.flatMap((continuation) =>
    HOST_STARTS.map((start) => `${start}${prefix}${continuation}`),
  );
};

/**
 * An IPv6 prefix. The opening bracket anchors these as literals, so no
 * hostname can collide with them and no closing anchor is needed.
 */
const ipv6Patterns = (prefix: string): string[] =>
  HOST_STARTS.map((start) => `${start}[${prefix}`);

/**
 * Rewrites one pattern into the set that matches everything it did except the
 * server's own origin.
 *
 * `Network.setBlockedURLs` has no notion of an exemption, and the original
 * `Fetch`-based guard leaned on that: it paused a request and let
 * {@link findBlockedNavigationUrl} decide, self-origin carve-out included.
 * Pausing is what broke `page.authenticate()`, so the carve-out has to be
 * expressed in the patterns themselves.
 *
 * It can be, because a URL that is not our origin has to differ from it at
 * some character: one pattern per (position, alternative character) covers all
 * of them and none of ours. For a server on `localhost:3000` that is ~50
 * patterns — `://localhost:8`, `://localhost:30/`, `://localhost:3001`, and so
 * on — which still block every other port on the host while leaving the pages
 * browserless serves itself (the `/function` runtime and its own WebSocket)
 * reachable.
 */
const withoutSelfOrigin = (pattern: string, origin: string): string[] => {
  const at = origin.indexOf(pattern);

  // Only a literal pattern can be taken apart this way. A wildcard one that
  // reaches our own origin is dropped instead: refusing to guard that shape
  // costs one blocklist entry, while decomposing from the wrong offset would
  // emit patterns like `/` and block every request the browser makes.
  if (at === -1) {
    return [];
  }

  const consumed = at + pattern.length;
  // The port's colon, skipping both the scheme separator and the colons inside
  // an IPv6 literal.
  const bracketEnd = origin.lastIndexOf(']');
  const portAt = origin.indexOf(':', bracketEnd > 0 ? bracketEnd : 3);
  const out: string[] = [];

  for (let index = consumed; index < origin.length; index++) {
    const inPort = portAt !== -1 && index > portAt;
    // A port has to start with a digit, so `/` is only an alternative once at
    // least one digit of it is fixed; anywhere else it means "the origin ends
    // here", which is a different origin from ours.
    const alternatives =
      (inPort ? DIGITS : HOST_CHARS) +
      (index === portAt + 1 && inPort ? '' : PATH_END);

    for (const char of alternatives) {
      if (char === origin[index]) continue;
      // Rebuilt from the pattern, not from the origin, so a pattern that
      // matched partway in keeps its own anchor: a `.localhost:` rewritten
      // around a self host of `sub.localhost:3000` still covers every other
      // sub-domain, which re-anchoring on `://sub` would have dropped.
      out.push(pattern + origin.slice(consumed, index) + char);
    }
  }

  return out;
};

/**
 * Builds the patterns handed to `Network.setBlockedURLs`, which is how the CDP
 * guard stops a page reaching a blocked destination.
 *
 * Unlike the `Fetch` patterns this replaced, these *are* the verdict: nothing
 * pauses to ask {@link findBlockedNavigationUrl} afterwards, so they are
 * written to match what the classifier blocks rather than to over-match and
 * defer. Two consequences worth knowing:
 *
 * - Matching is a substring test (see {@link matchesBlockedUrlPattern}), so a
 *   pattern can be anchored within the URL but never to its start. A scheme
 *   pattern such as `file://` therefore also blocks a request whose *query*
 *   carries an unencoded `file://`. Rare, and it costs one sub-resource.
 * - `setBlockedURLs` does not apply to navigations or WebSocket handshakes
 *   (measured). Navigations stay covered by the route-level 403, the
 *   wire-protocol check in {@link findBlockedNavigationInMessage}, and the
 *   observational teardown in the CDP browser class.
 *
 * `selfHosts` (`Config.getSelfNavigationHosts()`) is carved back out of the
 * result rather than left to a per-request exemption — see
 * {@link withoutSelfOrigin}.
 *
 * Returns `[]` when nothing is configured to block, which callers should treat
 * as "do not install the guard at all".
 */
export const toBlockedUrlPatterns = (
  patterns: string[],
  ranges: NetworkRangeSet | null,
  selfHosts: readonly string[] = [],
): string[] => {
  const built: string[] = [
    // Scheme blocklists (`file://`) and blocked protocols (`smtp://`, `ftp://`)
    // are already the head of the URL, so they need no anchoring of their own.
    ...patterns,
    ...(ranges?.protocols ?? []),
    ...(ranges?.hostnames ?? []).flatMap(hostnamePatterns),
    ...(ranges?.ipv4Prefixes ?? []).flatMap(ipv4Patterns),
    ...(ranges?.ipv6Prefixes ?? []).flatMap(ipv6Patterns),
  ];

  // The origins the browser has to keep reaching. A self host never carries
  // credentials, so only the `://` spelling can collide.
  const origins = selfHosts.map((host) => `://${host}/`);
  const exempted = origins.reduce(
    (current, origin) =>
      current.flatMap((pattern) =>
        matchesBlockedUrlPattern(origin, pattern)
          ? withoutSelfOrigin(pattern, origin)
          : [pattern],
      ),
    built,
  );

  return [...new Set(exempted)];
};

/**
 * Ordered CDP rules that exempt dotted DNS names from IPv4 prefix matches.
 * Chromium applies these before the legacy `urls` list, so scheme and hostname
 * blocks must precede the exemptions. Arbitrary URL prefixes cannot be safely
 * translated; those configurations keep their conservative legacy behavior.
 *
 * These are strings for Chromium's native matcher, not Node URLPattern objects.
 * Keep the legacy list installed too: it enforces IPv4/IPv6 ranges and supplies
 * the fallback on browsers without support for ordered rules.
 */
export const toBlockedUrlRules = (
  patterns: string[],
  ranges: NetworkRangeSet | null,
  selfHosts: readonly string[] = [],
): { urlPattern: string; block: boolean }[] => {
  const schemes = [...patterns, ...(ranges?.protocols ?? [])];
  if (
    !ranges?.ipv4Prefixes.length ||
    schemes.some((scheme) => !/^[a-z][a-z0-9+.-]*:\/\/$/.test(scheme)) ||
    ranges.hostnames.some(
      (hostname) => !/^[a-z0-9_-]+(?:\.[a-z0-9_-]+)*$/.test(hostname),
    )
  ) {
    return [];
  }

  // URLPattern metacharacters must never turn a literal self host into a
  // wildcard exemption. Noncanonical overrides retain the legacy guard.
  try {
    if (
      selfHosts.some(
        (host) =>
          !/^[a-z0-9_.:[\]-]+$/.test(host) ||
          new URL(`http://${host}`).host !== host,
      ) ||
      ranges.hostnames.some(
        (hostname) => new URL(`http://${hostname}`).hostname !== hostname,
      )
    ) {
      return [];
    }
  } catch {
    return [];
  }

  return [
    ...schemes.map((scheme) => ({
      urlPattern: `${scheme}*:*/*`,
      block: true,
    })),
    ...selfHosts.map((host) => ({
      urlPattern: `*://${host}/*`,
      block: false,
    })),
    ...ranges.hostnames.flatMap((hostname) => [
      { urlPattern: `*://${hostname}:*/*`, block: true },
      { urlPattern: `*://*.${hostname}:*/*`, block: true },
    ]),
    // DNS labels (including IDNA's ASCII spelling and underscore labels) have
    // a nondigit character. Requiring a dot excludes canonical IPv6 literals;
    // neither credentials nor a path/query can satisfy a hostname pattern.
    ...[...'abcdefghijklmnopqrstuvwxyz-_'].map((character) => ({
      urlPattern: `*://*.*${character}*:*/*`,
      block: false,
    })),
  ];
};
