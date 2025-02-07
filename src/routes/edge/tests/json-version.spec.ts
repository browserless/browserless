import { Browserless, Config, Metrics } from '@browserless.io/browserless';
import { expect } from 'chai';

describe('/json/version API', function () {
  let browserless: Browserless;

  const start = ({
    config = new Config(),
    metrics = new Metrics(),
  }: { config?: Config; metrics?: Metrics } = {}) => {
    browserless = new Browserless({ config, metrics });
    return browserless.start();
  };

  afterEach(async () => {
    await browserless.stop();
  });

  it('allows requests to /json/version', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });

    const res = await fetch(
      'http://localhost:3000/json/version?token=browserless',
    );
    const resJSON = await res.json();

    [
      'Browser',
      'Protocol-Version',
      'User-Agent',
      'V8-Version',
      'WebKit-Version',
      'webSocketDebuggerUrl',
      'Debugger-Version',
    ].forEach((k) => expect(resJSON).to.haveOwnProperty(k));
  });

  it('rejects unauthorized requests to /json/version', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });

    const res = await fetch(
      'http://localhost:3000/json/version?token=imabadboi',
    );
    expect(res.status).to.equal(401);
  });
});
