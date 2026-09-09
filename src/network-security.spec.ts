import { expect } from 'chai';
import {
  NetworkRangeSet,
  findBlockedNavigationInMessage,
  findBlockedNavigationUrl,
  isBlockedNavigationIP,
  isBlockedNavigationUrl,
  looksLikeIPv4Literal,
  matchesBlockedUrlPattern,
  toBlockedUrlPatterns,
} from '@browserless.io/browserless';

// A representative opt-in range set: loopback, link-local/cloud-metadata,
// 0.0.0.0/8, the 172.16-31 RFC1918 block, dangerous IPv6, smtp/ftp, localhost.
// It deliberately OMITS 10.x and 192.168.x to exercise a carve-out (a consumer
// that lets the browser reach those LANs while still blocking metadata).
const RANGES: NetworkRangeSet = {
  ipv4Prefixes: [
    '0.',
    '127.',
    '169.254.',
    ...Array.from({ length: 16 }, (_, i) => `172.${16 + i}.`),
  ],
  ipv6Prefixes: ['::1', '::', 'fc', 'fd', 'fe80:', '::ffff:'],
  protocols: ['smtp://', 'ftp://'],
  hostnames: ['localhost'],
};

describe('Network Security', () => {
  describe('looksLikeIPv4Literal', () => {
    it('treats all-numeric/dotted hosts as literals, names as not', () => {
      expect(looksLikeIPv4Literal('169.254.169.254')).to.be.true;
      expect(looksLikeIPv4Literal('0.0.0.0')).to.be.true;
      expect(looksLikeIPv4Literal('0.gravatar.com')).to.be.false;
      expect(looksLikeIPv4Literal('example.com')).to.be.false;
    });
  });

  describe('isBlockedNavigationUrl', () => {
    it('blocks IPv6-mapped metadata (and textual variants)', () => {
      expect(
        isBlockedNavigationUrl(
          'http://[::ffff:169.254.169.254]/latest',
          RANGES,
        ),
      ).to.be.true;
      expect(isBlockedNavigationUrl('http://[::ffff:a9fe:a9fe]/', RANGES)).to.be
        .true;
      expect(
        isBlockedNavigationUrl(
          'http://[0:0:0:0:0:ffff:169.254.169.254]/',
          RANGES,
        ),
      ).to.be.true;
    });

    it('blocks plain metadata + link-local', () => {
      expect(isBlockedNavigationUrl('http://169.254.169.254/meta', RANGES)).to
        .be.true;
      expect(isBlockedNavigationUrl('http://169.254.0.1/', RANGES)).to.be.true;
    });

    it('blocks alternate IPv4 encodings (decimal/hex/octal)', () => {
      expect(isBlockedNavigationUrl('http://2852039166/', RANGES)).to.be.true;
      expect(isBlockedNavigationUrl('http://0xA9FEA9FE/', RANGES)).to.be.true;
      expect(isBlockedNavigationUrl('http://0251.0376.0251.0376/', RANGES)).to
        .be.true;
    });

    it('blocks loopback in all forms', () => {
      expect(isBlockedNavigationUrl('http://127.0.0.1/', RANGES)).to.be.true;
      expect(isBlockedNavigationUrl('http://127.1/', RANGES)).to.be.true;
      expect(isBlockedNavigationUrl('http://localhost/', RANGES)).to.be.true;
      expect(isBlockedNavigationUrl('http://LOCALHOST:3000/', RANGES)).to.be
        .true;
      expect(isBlockedNavigationUrl('http://app.localhost/', RANGES)).to.be
        .true;
      expect(isBlockedNavigationUrl('http://[::1]/', RANGES)).to.be.true;
      expect(isBlockedNavigationUrl('http://[::ffff:127.0.0.1]:3000/', RANGES))
        .to.be.true;
    });

    it('blocks 0.0.0.0/8 and the unspecified IPv6 address', () => {
      expect(isBlockedNavigationUrl('http://0.0.0.0:3000/', RANGES)).to.be.true;
      expect(isBlockedNavigationUrl('http://[::]:3000/', RANGES)).to.be.true;
    });

    it('blocks 172.16.0.0/12 and dangerous IPv6 ranges', () => {
      expect(isBlockedNavigationUrl('http://172.16.0.1/', RANGES)).to.be.true;
      expect(isBlockedNavigationUrl('http://172.31.255.255/', RANGES)).to.be
        .true;
      expect(isBlockedNavigationUrl('http://[fe80::1]/', RANGES)).to.be.true;
      expect(isBlockedNavigationUrl('http://[fc00::1]/', RANGES)).to.be.true;
    });

    it('blocks configured protocols (view-source unwrapped)', () => {
      expect(isBlockedNavigationUrl('smtp://internal/x', RANGES)).to.be.true;
      expect(isBlockedNavigationUrl('ftp://internal/x', RANGES)).to.be.true;
      expect(
        isBlockedNavigationUrl('view-source:http://169.254.169.254/', RANGES),
      ).to.be.true;
    });

    it('allows ranges omitted from the set (carve-out) and public hosts', () => {
      expect(isBlockedNavigationUrl('http://10.0.0.5/', RANGES)).to.be.false;
      expect(isBlockedNavigationUrl('http://192.168.1.1/', RANGES)).to.be.false;
      expect(isBlockedNavigationUrl('http://172.32.0.1/', RANGES)).to.be.false;
      expect(isBlockedNavigationUrl('https://example.com/', RANGES)).to.be
        .false;
      expect(isBlockedNavigationUrl('http://8.8.8.8/', RANGES)).to.be.false;
      expect(isBlockedNavigationUrl('http://[2001:db8::1]/', RANGES)).to.be
        .false;
    });

    it('keys on the host, not URL substrings (userinfo cannot fool it)', () => {
      expect(
        isBlockedNavigationUrl('http://169.254.169.254@example.com/', RANGES),
      ).to.be.false;
      expect(
        isBlockedNavigationUrl('http://example.com@169.254.169.254/', RANGES),
      ).to.be.true;
    });

    it('fails closed on unparseable URLs', () => {
      expect(isBlockedNavigationUrl('not-a-url', RANGES)).to.be.true;
      expect(isBlockedNavigationUrl('', RANGES)).to.be.true;
    });

    it('blocks NOTHING when ranges is null (default off)', () => {
      expect(isBlockedNavigationUrl('http://169.254.169.254/', null)).to.be
        .false;
      expect(isBlockedNavigationUrl('http://127.0.0.1/', null)).to.be.false;
      expect(isBlockedNavigationUrl('http://[::ffff:169.254.169.254]/', null))
        .to.be.false;
      expect(isBlockedNavigationUrl('not-a-url', null)).to.be.false;
    });

    it('allows an otherwise-blocked host when it is in allowedHosts, port-specific', () => {
      const allowed = ['0.0.0.0:3000', 'localhost:3000'];
      // The server's own origin (host:port) is allowed even though the host is
      // in the blocklist — lets the browser load browserless's own pages.
      expect(
        isBlockedNavigationUrl(
          'http://0.0.0.0:3000/function/index.html',
          RANGES,
          allowed,
        ),
      ).to.be.false;
      expect(
        isBlockedNavigationUrl(
          'ws://0.0.0.0:3000/function/connect/x',
          RANGES,
          allowed,
        ),
      ).to.be.false;
      expect(isBlockedNavigationUrl('http://localhost:3000/', RANGES, allowed))
        .to.be.false;
      // A different port on the same loopback host stays blocked.
      expect(isBlockedNavigationUrl('http://0.0.0.0:5432/', RANGES, allowed)).to
        .be.true;
      // allowedHosts never overrides a metadata/private destination elsewhere.
      expect(isBlockedNavigationUrl('http://169.254.169.254/', RANGES, allowed))
        .to.be.true;
    });
  });

  describe('isBlockedNavigationIP', () => {
    it('blocks private/metadata IPs and allows public/carve-out', () => {
      expect(isBlockedNavigationIP('127.0.0.1', RANGES)).to.be.true;
      expect(isBlockedNavigationIP('169.254.169.254', RANGES)).to.be.true;
      expect(isBlockedNavigationIP('172.22.0.3', RANGES)).to.be.true;
      expect(isBlockedNavigationIP('0.0.0.0', RANGES)).to.be.true;
      expect(isBlockedNavigationIP('::1', RANGES)).to.be.true;
      expect(isBlockedNavigationIP('fe80::1', RANGES)).to.be.true;
      expect(isBlockedNavigationIP('::ffff:169.254.169.254', RANGES)).to.be
        .true;
      expect(isBlockedNavigationIP('8.8.8.8', RANGES)).to.be.false;
      expect(isBlockedNavigationIP('10.0.0.5', RANGES)).to.be.false;
      expect(isBlockedNavigationIP('192.168.1.1', RANGES)).to.be.false;
      expect(isBlockedNavigationIP('2001:db8::1', RANGES)).to.be.false;
    });

    it('blocks NOTHING when ranges is null (default off)', () => {
      expect(isBlockedNavigationIP('169.254.169.254', null)).to.be.false;
      expect(isBlockedNavigationIP('::1', null)).to.be.false;
    });
  });

  describe('findBlockedNavigationUrl', () => {
    it('returns the matched scheme pattern (file:// governed by patterns)', () => {
      expect(
        findBlockedNavigationUrl('file:///etc/passwd', ['file://'], RANGES),
      ).to.equal('file://');
    });

    it('respects an empty pattern list (ALLOW_FILE_PROTOCOL) for file://', () => {
      expect(findBlockedNavigationUrl('file:///etc/passwd', [], RANGES)).to.be
        .null;
    });

    it('returns the URL for a private/metadata host via ranges', () => {
      expect(
        findBlockedNavigationUrl(
          'http://[::ffff:169.254.169.254]/',
          [],
          RANGES,
        ),
      ).to.equal('http://[::ffff:169.254.169.254]/');
      expect(
        findBlockedNavigationUrl('http://0.0.0.0:3000/', [], RANGES),
      ).to.equal('http://0.0.0.0:3000/');
    });

    it('returns null for allowed/public destinations', () => {
      expect(
        findBlockedNavigationUrl('https://example.com/', ['file://'], RANGES),
      ).to.be.null;
      expect(findBlockedNavigationUrl('http://10.0.0.5/', ['file://'], RANGES))
        .to.be.null;
    });

    it('with null ranges + empty patterns blocks nothing (OSS default)', () => {
      expect(findBlockedNavigationUrl('http://169.254.169.254/', [], null)).to
        .be.null;
    });
  });

  // Used by the CDP and Playwright WebSocket bridges to reject private-network
  // navigations from raw protocol frames, scoped to navigation methods.
  describe('findBlockedNavigationInMessage', () => {
    it('blocks a Playwright goto to a private host (both wire spellings)', () => {
      for (const method of ['goto', 'Frame.goto']) {
        const frame = {
          guid: 'frame@abc',
          method,
          params: { url: 'http://169.254.169.254/latest', waitUntil: 'load' },
        };
        expect(findBlockedNavigationInMessage(frame, RANGES)).to.equal(
          'http://169.254.169.254/latest',
        );
      }
    });

    it('blocks CDP Page.navigate and Target.createTarget to a private host', () => {
      expect(
        findBlockedNavigationInMessage(
          { method: 'Page.navigate', params: { url: 'http://127.0.0.1/' } },
          RANGES,
        ),
      ).to.equal('http://127.0.0.1/');
      expect(
        findBlockedNavigationInMessage(
          {
            method: 'Target.createTarget',
            params: { url: 'http://[::ffff:169.254.169.254]/' },
          },
          RANGES,
        ),
      ).to.equal('http://[::ffff:169.254.169.254]/');
    });

    it('allows a goto to a public host', () => {
      expect(
        findBlockedNavigationInMessage(
          { method: 'goto', params: { url: 'https://example.com/' } },
          RANGES,
        ),
      ).to.be.null;
    });

    it('does NOT fire on non-navigation methods that carry a url', () => {
      // A cookie/route frame pointed at localhost must not tear down the session.
      expect(
        findBlockedNavigationInMessage(
          { method: 'addCookies', params: { url: 'http://localhost/' } },
          RANGES,
        ),
      ).to.be.null;
      expect(
        findBlockedNavigationInMessage(
          { method: 'setNetworkCookie', params: { url: 'http://127.0.0.1/' } },
          RANGES,
        ),
      ).to.be.null;
    });

    it('returns null for malformed frames and when ranges is null', () => {
      expect(findBlockedNavigationInMessage({ method: 'goto' }, RANGES)).to.be
        .null;
      expect(findBlockedNavigationInMessage(null, RANGES)).to.be.null;
      expect(findBlockedNavigationInMessage('not-an-object', RANGES)).to.be
        .null;
      expect(
        findBlockedNavigationInMessage(
          { method: 'goto', params: { url: 'http://169.254.169.254/' } },
          null,
        ),
      ).to.be.null;
    });
  });
  describe('toBlockedUrlPatterns', () => {
    // These patterns are the verdict — nothing pauses to ask the matcher
    // afterwards — so both directions matter: everything the classifier blocks
    // has to be covered, and ordinary traffic has to come through untouched.
    const blocks = (url: string, patterns: string[]): boolean =>
      patterns.some((pattern) => matchesBlockedUrlPattern(url, pattern));

    describe('matchesBlockedUrlPattern', () => {
      // Chromium splits the pattern on `*` and looks for each piece in order,
      // so a pattern is a substring test and cannot be anchored. Everything
      // else in this file depends on that being what the browser does; the
      // browser-level spec in browsers.cdp.spec.ts is what proves it.
      it('matches each piece in order, anywhere in the URL', () => {
        expect(matchesBlockedUrlPattern('http://127.0.0.1/x', '127.0.0.1')).to
          .be.true;
        expect(matchesBlockedUrlPattern('http://127.0.0.1/x', '*://127.0*')).to
          .be.true;
        expect(matchesBlockedUrlPattern('http://example.com/a/b', 'a/b')).to.be
          .true;
        expect(
          matchesBlockedUrlPattern(
            'http://127.0.0.1/localhost',
            '*localhost*127.*',
          ),
          'pieces have to appear in the pattern order',
        ).to.be.false;
        expect(matchesBlockedUrlPattern('http://example.com/', 'nope')).to.be
          .false;
      });
    });

    it('blocks every URL the matcher blocks', () => {
      const patterns = toBlockedUrlPatterns(['file://'], RANGES);

      for (const url of [
        'file:///etc/passwd',
        'http://127.0.0.1/',
        'http://127.0.0.1:8888/wordpress/wp-content/uploads/svg/world-map.svg',
        'http://localhost:8888/x.svg',
        'http://localhost/x.svg',
        'http://sub.localhost/x',
        'http://sub.localhost:9000/x',
        'http://169.254.169.254/latest/meta-data/',
        'http://0.0.0.0:3000/',
        'http://172.16.0.1/',
        'http://[::1]:8080/',
        'http://[fe80::1]/',
        'smtp://127.0.0.1/',
        'ftp://example.com/',
      ]) {
        expect(blocks(url, patterns), `should block ${url}`).to.be.true;
      }
    });

    // A credentialed URL puts userinfo where the scheme separator would
    // otherwise sit right in front of the host, so every host-shaped pattern
    // needs its `@` twin or the host hides behind the credentials.
    it('blocks hosts hidden behind userinfo', () => {
      const patterns = toBlockedUrlPatterns(['file://'], RANGES);

      for (const url of [
        'http://user@127.0.0.1/',
        'http://user:pass@127.0.0.1:8888/nav',
        'http://user:pass@localhost:8888/x.svg',
        'http://user@sub.localhost/x',
        'http://user@169.254.169.254/latest/meta-data/',
        'http://user@[::1]:8080/',
        'smtp://user@127.0.0.1/',
      ]) {
        expect(blocks(url, patterns), `should block ${url}`).to.be.true;
      }
    });

    // The reason the patterns are anchored rather than the plain prefixes the
    // `Fetch` guard could afford: with no per-request verdict behind them, a
    // lookalike host that matches is a customer's sub-resource that silently
    // fails. `0.gravatar.com` is the one that matters — it sits on a great
    // many WordPress sites, which is exactly the population PLT-1572 came
    // from.
    it('leaves lookalike hosts alone', () => {
      const patterns = toBlockedUrlPatterns(['file://'], RANGES);

      for (const url of [
        'https://example.com/index.html',
        'https://careers.kinly.com/o/av-event-technician-38',
        'https://0.gravatar.com/avatar/abc123',
        'https://2.gravatar.com/avatar/abc123',
        'https://localhostings.com/',
        'https://127.example.com/',
        'https://172.16.example.com/',
        'https://cdn.example.com/app.js?v=127',
        'https://10.0.0.1.example.com/',
        'https://user@example.com/dashboard',
      ]) {
        expect(blocks(url, patterns), `should not block ${url}`).to.be.false;
      }
    });

    // Every prefix in this file's RANGES ends at a dot boundary, and that is
    // what let the first version of these patterns ship broken: enterprise
    // spells the cloud-metadata range `169.254`, with no trailing dot, and a
    // digit-only anchor turned it into `://169.2540`…`://169.2549` — patterns
    // that cannot match `169.254.169.254`. The range read as configured and
    // blocked nothing, which is the worst way for a blocklist to fail.
    describe('prefixes that do not end at a dot boundary', () => {
      const fromPrefixes = (prefixes: string[]) =>
        toBlockedUrlPatterns([], {
          hostnames: [],
          ipv4Prefixes: prefixes,
          ipv6Prefixes: [],
          protocols: [],
        });

      it('blocks a prefix that stops mid-octet, as enterprise spells it', () => {
        const patterns = fromPrefixes(['169.254']);

        for (const url of [
          'http://169.254.169.254/latest/meta-data/',
          'http://169.254.169.254/',
          'http://169.254.1.1/',
          'http://user@169.254.169.254/',
          'http://169.254.169.254:8080/',
        ]) {
          expect(blocks(url, patterns), `should block ${url}`).to.be.true;
        }
        expect(blocks('https://example.com/', patterns)).to.be.false;
      });

      // The dot that ends an octet has to carry a digit. A bare one would
      // match a name that merely starts with the prefix, and the classifier
      // does not: prefix-matching applies to hosts that are all digits and
      // dots, so `169.254.example.com` is an ordinary name it allows.
      it('leaves a DNS host that starts with the prefix alone', () => {
        for (const [prefix, url] of [
          ['169.254', 'http://169.254.example.com/'],
          ['169.254', 'https://169.254.customer.io/assets/logo.svg'],
          ['127.0.0.1', 'http://127.0.0.1.example.com/'],
          ['172.16.', 'http://172.16.example.com/'],
        ]) {
          const patterns = fromPrefixes([prefix]);

          expect(blocks(url, patterns), `should not block ${url}`).to.be.false;
          expect(
            isBlockedNavigationUrl(url, {
              hostnames: [],
              ipv4Prefixes: [prefix],
              ipv6Prefixes: [],
              protocols: [],
            }),
            `the matcher these mirror should not block ${url} either`,
          ).to.be.false;
        }
      });

      // A prefix can also be a whole address, which has to let the host end
      // rather than only continue.
      it('blocks a prefix that is a complete address', () => {
        const patterns = fromPrefixes(['127.0.0.1']);

        for (const url of [
          'http://127.0.0.1/',
          'http://127.0.0.1/x',
          'http://127.0.0.1:8080/x',
          'http://127.0.0.10/x',
        ]) {
          expect(blocks(url, patterns), `should block ${url}`).to.be.true;
        }
      });
    });

    describe('the self-origin carve-out', () => {
      // What `Network.setBlockedURLs` cannot express is an exemption, and the
      // server's own origin needs one: the /function runtime's code is a
      // sub-resource of a page served from it, and blocking beats interception
      // to the request. Carving the origin out of the patterns is the whole
      // reason this file computes a match itself.
      const SELF = ['localhost:3000'];

      it("lets the server's own origin through", () => {
        const patterns = toBlockedUrlPatterns(['file://'], RANGES, SELF);

        for (const url of [
          'http://localhost:3000/',
          'http://localhost:3000/function/index.html',
          'http://localhost:3000/function/browserless-function-abc.js',
          'ws://localhost:3000/function/connect/abc?token=t',
        ]) {
          expect(blocks(url, patterns), `should allow ${url}`).to.be.false;
        }
      });

      // The point of doing this per character rather than by dropping the
      // colliding pattern outright: PLT-1572's own customer case is
      // `http://localhost:8888/…`, which a dropped `localhost` pattern would
      // stop blocking.
      it('still blocks every other port on the same host', () => {
        const patterns = toBlockedUrlPatterns(['file://'], RANGES, SELF);

        for (const url of [
          'http://localhost:8888/x.svg',
          'http://localhost:3001/x',
          'http://localhost:30001/x',
          'http://localhost:300/x',
          'http://localhost:30/x',
          'http://localhost:3/x',
          'http://localhost/x',
          'http://localhost:22/',
          'http://sub.localhost:3000/x',
          'http://127.0.0.1:3000/x',
        ]) {
          expect(blocks(url, patterns), `should block ${url}`).to.be.true;
        }
      });

      it('carves out an IP-literal self host without losing the range', () => {
        const patterns = toBlockedUrlPatterns(['file://'], RANGES, [
          '127.0.0.1:3000',
        ]);

        expect(blocks('http://127.0.0.1:3000/function/code.js', patterns)).to.be
          .false;
        for (const url of [
          'http://127.0.0.1:8888/x',
          'http://127.0.0.1/x',
          'http://127.0.0.2:3000/x',
          'http://127.1.0.1:3000/x',
          'http://169.254.169.254/',
          'http://localhost:3000/x',
        ]) {
          expect(blocks(url, patterns), `should block ${url}`).to.be.true;
        }
      });

      it('carves out a self host bound to a default port', () => {
        const patterns = toBlockedUrlPatterns(['file://'], RANGES, [
          'localhost',
        ]);

        expect(blocks('http://localhost/function/code.js', patterns)).to.be
          .false;
        expect(blocks('http://localhost:8888/x', patterns)).to.be.true;
        expect(blocks('http://sub.localhost/x', patterns)).to.be.true;
      });

      it('carves out every self host it is given', () => {
        const patterns = toBlockedUrlPatterns(['file://'], RANGES, [
          'localhost:3000',
          '127.0.0.1:3000',
        ]);

        expect(blocks('http://localhost:3000/x', patterns)).to.be.false;
        expect(blocks('http://127.0.0.1:3000/x', patterns)).to.be.false;
        expect(blocks('http://localhost:8888/x', patterns)).to.be.true;
        expect(blocks('http://127.0.0.1:8888/x', patterns)).to.be.true;
      });

      // A self host outside the blocklist changes nothing — no pattern matches
      // it, so none is rewritten.
      it('leaves the patterns alone when nothing collides', () => {
        expect(
          toBlockedUrlPatterns(['file://'], RANGES, ['example.com:3000']),
        ).to.deep.equal(toBlockedUrlPatterns(['file://'], RANGES));
      });
    });

    it('returns [] when nothing is configured to block', () => {
      expect(toBlockedUrlPatterns([], null)).to.deep.equal([]);
    });

    it('covers the scheme blocklist on its own when ranges are disabled', () => {
      const patterns = toBlockedUrlPatterns(['file://'], null);

      expect(patterns).to.deep.equal(['file://']);
      expect(blocks('file:///etc/passwd', patterns)).to.be.true;
      expect(blocks('https://example.com/', patterns)).to.be.false;
    });
  });
});
