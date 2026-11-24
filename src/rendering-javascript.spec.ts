import { Browserless, Config } from '@browserless.io/browserless';
import { expect } from 'chai';
import { readdir } from 'node:fs/promises';

const browsers = (await readdir(new Config().getRoutes())).filter((name) =>
  ['chromium', 'chrome', 'edge'].includes(name),
);

describe('rendering JavaScript options', function () {
  let browserless: Browserless;

  before(async () => {
    const config = new Config();
    config.setToken('browserless');
    config.setPort(31337);
    browserless = new Browserless({ config });
    await browserless.start();
  });
  after(async () => browserless?.stop());

  const html = `<!doctype html><p id="static">STATIC</p>
    <script>document.querySelector('p').id = 'executed';</script>`;
  const post = (path: string, body: object) =>
    fetch(`http://localhost:31337${path}?token=browserless`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  for (const path of browsers.flatMap((browser) => [
    ...['content', 'screenshot', 'pdf'].map((route) => `/${browser}/${route}`),
    ...(browser === 'chromium' ? ['/content', '/pdf'] : []),
  ])) {
    for (const input of ['html', 'url']) {
      for (const setting of [false, true, undefined]) {
        it(`${path} honors setJavaScriptEnabled=${setting} with ${input}`, async () => {
          const selector = setting === false ? '#static' : '#executed';
          const res = await post(path, {
            [input]:
              input === 'html'
                ? html
                : `data:text/html,${encodeURIComponent(html)}`,
            setJavaScriptEnabled: setting,
            waitForSelector: { selector, timeout: 1000 },
            addScriptTag:
              setting === false
                ? [
                    {
                      type: 'application/ld+json',
                      content: '{"name":"STATIC_METADATA"}',
                    },
                  ]
                : [
                    {
                      url: 'data:text/javascript,document.documentElement.dataset.injected="yes"',
                    },
                  ],
            ...(setting !== false
              ? {
                  waitForFunction: {
                    fn: `document.querySelector('#executed') !== null && document.documentElement.dataset.injected === 'yes'`,
                    timeout: 1000,
                  },
                }
              : {}),
          });
          const bytes = Buffer.from(await res.arrayBuffer());
          expect(res.status, bytes.toString()).to.equal(200);
          if (path.endsWith('content')) {
            expect(bytes.toString()).to.include(
              `<p id="${selector.slice(1)}">`,
            );
            if (setting === false)
              expect(bytes.toString()).to.include('STATIC_METADATA');
          } else if (path.endsWith('pdf')) {
            expect(bytes.subarray(0, 5).toString()).to.equal('%PDF-');
          } else {
            expect(bytes.subarray(0, 8).toString('hex')).to.equal(
              '89504e470d0a1a0a',
            );
          }
        });
      }
    }

    for (const bestAttempt of [false, true]) {
      for (const option of path.endsWith('screenshot')
        ? ['scrollPage', 'waitForEvent', 'waitForFunction', 'addScriptTag']
        : ['waitForEvent', 'waitForFunction', 'addScriptTag']) {
        it(`${path} rejects disabled-script ${option}, bestAttempt=${bestAttempt}`, async () => {
          const res = await post(path, {
            html,
            setJavaScriptEnabled: false,
            bestAttempt,
            [option]:
              option === 'scrollPage'
                ? true
                : option === 'addScriptTag'
                  ? [{ url: 'data:text/javascript,void%200' }]
                  : option === 'waitForFunction'
                    ? { fn: 'false', timeout: 50 }
                    : { event: 'ready', timeout: 50 },
          });
          const text = await res.text();
          expect(res.status, text).to.equal(400);
          expect(text).to.include(option);
        });
      }
    }
  }
});
