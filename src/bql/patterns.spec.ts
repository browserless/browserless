import assert from 'node:assert/strict';
import micromatch from 'micromatch';

import { compileRegex, matchesGlob } from './patterns.js';

describe('BrowserQL safe patterns', () => {
  for (const [pattern, value, expected] of [
    ['*.{png,jpg}', 'image.png', true],
    ['*.{png,jpg}', 'image.jpg', true],
    ['*.{png,jpg}', 'image.gif', false],
    ['https://example.com/*', 'https://example.com/page', true],
    ['https://example.com/*', 'https://example.com/.well-known', false],
    ['https://example.com/*', 'https://example.com/', true],
    ['*', '.hidden', false],
    ['*', '', false],
    ['*', 'page', true],
    ['*.png', '.png', false],
    ['*.png', 'image.png/', true],
    ['v[12]', 'v1', true],
    ['v[12]', 'v2', true],
    ['v[12]', 'v3', false],
    ['*/v[12]/*', 'https://example.com/v2/x', true],
    ['*/v[12]/*', 'https://example.com/v3/x', false],
    ['*/v[12]/*', 'https://example.com/v2/.hidden', false],
    ['a*', 'abc', true],
    ['!*.png', 'image.png', false],
    ['!*.png', 'image.txt', true],
    ['*', 'Emoji 😀', true],
    ['file?', 'file/', false],
    ['{png,jpg}', '{png,jpg}', true],
    ['*/*', 'assets/file', true],
    ['*/*', 'assets/.hidden', false],
    ['*/*', 'assets/', false],
    ['*/*.png', 'assets/image.png', true],
    ['*/*.png', 'assets/image.jpg', false],
    ['*/*.png', 'assets/.png', false],
    ['*/*.js', 'assets/app.js', true],
    ['*/*.js', 'assets/app.json', false],
    ['cdn.*', 'cdn.example.com', true],
    ['cdn.*', 'other.example.com', false],
    ['cdn.*', 'cdn.example/.hidden', false],
    ['example.com*', 'example.com/path', true],
    ['example.com*', 'example.com/.hidden', false],
    ['example.com*', 'other.com', false],
    ['www.example.com*', 'www.example.com/path', true],
    ['www.example.com*', 'example.com/path', false],
    ['*.*', 'image.png', true],
    ['*.*', 'image./', true],
    ['*.*', 'image.', false],
    ['*.*', '.hidden', false],
    ['*.*', 'image', false],
    ['Slow *opup', 'Slow popup', true],
    ['Slow *', 'Slow popup', true],
    ['Order * confirmed', 'Order 123 confirmed', true],
    ['S*w popup', 'Slow popup', true],
    ['Checkout - *', 'Checkout - payment', true],
    ['My Account*', 'My Account settings', true],
    ['Dashboard | *', 'Dashboard | Home', true],
    ['Page *.html', 'Page index.html', true],
    ['a*b*c', 'a1b2c', true],
    ['a.*.b', 'a.middle.b', true],
    ['http*.png', 'https://example.com/image.png', true],
    ['Slow *opup', 'Fast popup', false],
    ['Order * confirmed', 'Order 123 pending', false],
    ['a*b*c', 'a1c2b', false],
    ['a*b*c', 'a/.hidden/bc', false],
    ['http*.png', 'https://example.com/.hidden.png', false],
    ['a?', 'a😀', false],
    ['a??', 'a😀', true],
    ['*a?*', 'a😀', true],
    ['[😀]', '😀', false],
    ['[😀]', '\uD83D', true],
    ['😀*', '😀 popup', true],
    ['😀*', 'other popup', false],
    ['?', '\uD800', true],
    ['?', '\uDFFF', true],
    ['Café*', 'Café menu', true],
    ['Café*', 'Cafe menu', false],
    ['Café menu', 'Café menu', true],
    ['Café menu', 'Café menus', false],
    ['*afé*', 'Café menu', true],
    ['東京*', '東京 menu', true],
    ['Café.*', 'Café.txt', true],
    ['Café.*', 'Caféxtxt', false],
    ['![a-z]*', 'abc', false],
    ['![a-z]*', '123', true],
    ['!![a-z]*', 'abc', true],
    ['http://example.test/{a,lib}.js', 'http://example.test/lib.js', true],
    ['http://example.test/{a,lib}.js', 'http://example.test/.js', false],
  ] as const) {
    it(`${JSON.stringify(pattern)} matches ${JSON.stringify(value)}: ${expected}`, () => {
      assert.equal(
        micromatch.isMatch(value, pattern, { bash: true }),
        expected,
      );
      assert.equal(matchesGlob(value, pattern), expected);
      assert.equal(matchesGlob(value, pattern), expected);
    });
  }

  for (const pattern of ['**', '!(foo)', '\\*']) {
    it(`explicitly rejects unsupported glob ${JSON.stringify(pattern)}`, () => {
      assert.throws(() => matchesGlob('anything', pattern), /unsupported/i);
    });
  }

  it('rejects grouped star assertions instead of losing suffix-dot exclusion', () => {
    const pattern = 'http://example.test/{a,lib/*}.js';
    for (const [value, expected] of [
      ['http://example.test/lib/.js', false],
      ['http://example.test/lib/file.js', true],
      ['http://example.test/a.js', true],
    ] as const) {
      assert.equal(
        micromatch.isMatch(value, pattern, { bash: true }),
        expected,
      );
      assert.throws(() => matchesGlob(value, pattern), /unsupported/i);
    }
    for (const pattern of ['a*{b,/*}.c', '!a*{b,/*}.c']) {
      assert.throws(() => matchesGlob('ab/.c', pattern), /unsupported/i);
    }
  });

  it('rejects invalid-range sentinels, including negated patterns', () => {
    for (const pattern of [
      '[a-Z]*',
      '![a-Z]*',
      '!![a-Z]*',
      '!*.[z-a]*',
      '!https://example.com/[9-0]*',
      '!{+(?|b),*}',
    ]) {
      assert.equal(
        micromatch.isMatch('anything', pattern, { bash: true }),
        false,
      );
      assert.throws(() => matchesGlob('anything', pattern), /unsupported/i);
    }
    assert.equal(compileRegex('$^').test('anything'), false);
    assert.equal(compileRegex('Café\\.').test('Café.'), true);
    assert.equal(compileRegex('Café\\.').test('Caféx'), false);
  });

  it('rejects private-use encoding collisions in patterns and values', () => {
    for (const value of ['\uE000', '\uE123', '\uE7FF']) {
      assert.throws(() => matchesGlob(value, '*'), /unsupported/i);
      assert.throws(() => matchesGlob('', value), /unsupported/i);
      assert.throws(() => matchesGlob(value, value), /unsupported/i);
    }
    assert.equal(matchesGlob('\uE800', '?'), true);
  });

  it('rejects line terminators rather than silently changing matches', () => {
    for (const value of ['\n', '\r', '\u2028', '\u2029']) {
      assert.equal(micromatch.isMatch(value, '?', { bash: true }), true);
      assert.throws(() => matchesGlob(value, '?'), /unsupported/i);
    }
  });

  it('bounds patterns and retains RE2 regex restrictions', () => {
    assert.throws(() => matchesGlob('x', 'x'.repeat(201)), /too long/i);
    assert.throws(() => compileRegex('x'.repeat(201)), /too long/i);
    assert.throws(() => compileRegex('(?=x)x'), /unsupported/i);
    assert.throws(() => compileRegex('(x)\\1'), /unsupported/i);
    assert.equal(compileRegex('(a+)+$').test('a'.repeat(10_000) + '!'), false);
  });
});
