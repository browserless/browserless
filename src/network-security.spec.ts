import { expect } from 'chai';
import {
  NetworkRangeSet,
  findBlockedNavigationInMessage,
  findBlockedNavigationUrl,
  isBlockedNavigationIP,
  isBlockedNavigationUrl,
  looksLikeIPv4Literal,
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
});
