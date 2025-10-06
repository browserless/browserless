import { Browserless, Config, Metrics } from '@browserless.io/browserless';
import { expect } from 'chai';

describe('/json/ API', function () {
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

  it('rejects unauthorized requests to /json/list', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });

    const res = await fetch('http://localhost:3000/json/list?token=imabadboi');
    expect(res.status).to.equal(401);
  });

  it('allows requests to /json/protocol', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });

    const res = await fetch(
      'http://localhost:3000/json/protocol?token=browserless',
    );
    expect(res.status).to.equal(200);
    const resJSON = await res.json();
    expect(resJSON).to.be.an('object');
    expect(resJSON).to.haveOwnProperty('version');
    expect(resJSON).to.haveOwnProperty('domains');
  });

  it('rejects unauthorized requests to /json/protocol', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });

    const res = await fetch(
      'http://localhost:3000/json/protocol?token=imabadboi',
    );
    expect(res.status).to.equal(401);
  });

  it('allows requests to PUT /json/new', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });

    const res = await fetch(
      'http://localhost:3000/json/new?token=browserless',
      {
        method: 'PUT',
      },
    );
    expect(res.status).to.equal(200);
    const resJSON = await res.json();

    const keys = [
      'description',
      'devtoolsFrontendUrl',
      'id',
      'title',
      'type',
      'url',
      'webSocketDebuggerUrl',
    ];
    keys.forEach((k) => expect(resJSON).to.haveOwnProperty(k));

    expect(resJSON.type).to.equal('page');
    expect(resJSON.title).to.equal('New Tab');
    expect(resJSON.url).to.equal('about:blank');
    expect(resJSON.description).to.equal('');
  });

  it('rejects unauthorized requests to PUT /json/new', async () => {
    const config = new Config();
    config.setToken('browserless');
    const metrics = new Metrics();
    await start({ config, metrics });

    const res = await fetch('http://localhost:3000/json/new?token=imabadboi', {
      method: 'PUT',
    });
    expect(res.status).to.equal(401);
  });
});
