import { Browserless, Config, Metrics } from '@browserless.io/browserless';
import { BrowserQL, defineBQLModule } from './bql/index.js';
import { expect } from 'chai';
import getPort from 'get-port';
import { randomUUID } from 'node:crypto';

describe('BrowserQL service injection', function () {
  let server: Browserless | undefined;

  afterEach(async () => {
    await server?.stop();
    server = undefined;
  });

  it('serves injected modules and capabilities through the normal authenticated route', async () => {
    const bql = new BrowserQL({
      modules: [
        defineBQLModule({
          name: 'fixture',
          typeDefs: 'extend type Query { fixture: String! }',
          resolvers: { Query: { fixture: () => 'injected service' } },
        }),
      ],
    });
    const config = new Config();
    const token = randomUUID();
    config.setToken(token);
    config.setPort(await getPort());
    server = new Browserless({ config, metrics: new Metrics(), bql });
    await server.start();
    const endpoint = `http://localhost:${config.getPort()}/chromium/bql`;
    const options = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ fixture capabilities }' }),
    };

    expect((await fetch(endpoint, options)).status).to.equal(401);
    const response = await fetch(`${endpoint}?token=${token}`, options);
    expect(response.status).to.equal(200);
    expect(response.headers.get('x-bql-capabilities')).to.include('fixture');
    expect(await response.json()).to.deep.equal({
      data: {
        fixture: 'injected service',
        capabilities: ['core', 'fixture'],
      },
    });
  });
});
