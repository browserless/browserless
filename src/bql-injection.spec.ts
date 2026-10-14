import { Browserless, Config, Metrics } from '@browserless.io/browserless';
import { BrowserQL, defineBQLModule } from './bql/index.js';
import WebSocket from 'ws';
import { expect } from 'chai';
import getPort from 'get-port';
import { once } from 'node:events';
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

    const mutation = await fetch(`${endpoint}?token=${token}`, {
      ...options,
      body: JSON.stringify({
        query: `mutation {
          evaluate(content: "document.title = 'HTTP fixture'") { value }
          title { title }
        }`,
      }),
    });
    const result = await mutation.json();
    expect(result.errors).to.equal(undefined);
    expect(result.data.title.title).to.equal('HTTP fixture');
    for (const query of [
      'mutation { solve { time } }',
      'mutation { proxy { time } }',
      'mutation { verify { time } }',
    ]) {
      const excluded = await fetch(`${endpoint}?token=${token}`, {
        ...options,
        body: JSON.stringify({ query }),
      });
      expect((await excluded.json()).errors).not.to.be.empty;
    }
    expect(
      (
        await fetch(
          endpoint.replace('/chromium/', '/stealth/') + `?token=${token}`,
          options,
        )
      ).status,
    ).to.equal(404);

    for (const protocol of ['', 'graphql-transport-ws']) {
      const socket = new WebSocket(
        endpoint.replace('http:', 'ws:') + `?token=${token}`,
        protocol || undefined,
      );
      try {
        await once(socket, 'open');
        if (protocol) {
          const reply = once(socket, 'message');
          socket.send(JSON.stringify({ type: 'connection_init' }));
          const ack = JSON.parse(String((await reply)[0]));
          expect(ack.type).to.equal('connection_ack');
          expect(ack.payload.capabilities).to.deep.equal(['core', 'fixture']);
        }
        const reply = once(socket, 'message');
        const payload = {
          query: `mutation { evaluate(content: "document.title = 'Socket fixture'") { value } title { title } }`,
        };
        socket.send(
          JSON.stringify(
            protocol ? { type: 'subscribe', id: 'page', payload } : payload,
          ),
        );
        const frame = JSON.parse(String((await reply)[0]));
        const result = protocol ? frame.payload : frame;
        expect(result.errors).to.equal(undefined);
        expect(result.data.title.title).to.equal('Socket fixture');
      } finally {
        const closed = once(socket, 'close');
        socket.close();
        await closed;
      }
    }
  });
});
