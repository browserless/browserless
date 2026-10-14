import assert from 'node:assert/strict';
import { BrowserQL } from './browserql.js';
import { BQLBrowserAPI } from './api/browser-api.js';
import type { Context } from './context.js';
import { defineBQLModule } from './module.js';

const options = {} as ConstructorParameters<typeof BQLBrowserAPI>[0];
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

describe('BrowserQL schema and execution', () => {
  it('composes additive modules and discovers capabilities without starting a browser', async () => {
    const service = new BrowserQL({
      modules: [
        {
          name: 'example',
          typeDefs:
            'extend type Mutation { echo(value: String!): String! } extend enum Method { CUSTOM }',
          resolvers: { Mutation: { echo: (_source, args) => args.value } },
        },
      ],
    });
    const context = service.createContext(options);
    assert.deepEqual(
      plain(
        await service.execute({ query: '{ capabilities version }' }, context),
      ),
      { data: { capabilities: ['core', 'example'], version: service.version } },
    );
    assert.deepEqual(
      plain(
        await service.execute(
          { query: 'mutation { echo(value:"hello") }' },
          context,
        ),
      ),
      { data: { echo: 'hello' } },
    );
    await context.close();
  });

  it('rejects duplicate fields, resolver collisions and missing mutation/subscription bindings', () => {
    for (const typeDefs of [
      'extend type Mutation { title: String }',
      'extend type Mutation { missing: String }',
      'extend type Subscription { missing: String }',
    ]) {
      assert.throws(
        () => new BrowserQL({ modules: [{ name: 'test', typeDefs }] }),
      );
    }
    assert.throws(
      () =>
        new BrowserQL({
          modules: [
            {
              name: 'test',
              typeDefs: '',
              resolvers: { Mutation: { title: () => 'replacement' } },
            },
          ],
        }),
    );
  });

  it('does not let a module replace the schema operation roots', () => {
    assert.throws(
      () =>
        new BrowserQL({
          modules: [
            {
              name: 'roots',
              typeDefs:
                'schema { query: Query mutation: Replacement subscription: Subscription } type Replacement { bypass: String }',
              resolvers: { Replacement: { bypass: () => 'no' } },
            },
          ],
        }),
    );
  });

  it('supports typed API subclasses in modules', async () => {
    class CustomAPI extends BQLBrowserAPI {
      override async start() {}
      override async close() {}
      custom() {
        return 'custom value';
      }
    }
    const module = defineBQLModule<CustomAPI>({
      name: 'custom',
      typeDefs: 'extend type Mutation { custom: String }',
      resolvers: {
        Mutation: {
          custom: async (_source, _args, context) =>
            (await context.getBrowser()).custom(),
        },
      },
    });
    const service = new BrowserQL({
      modules: [module],
      apiFactory: (options) => new CustomAPI(options),
    });
    const context = service.createContext(options);
    assert.deepEqual(
      plain(await service.execute({ query: 'mutation { custom }' }, context)),
      { data: { custom: 'custom value' } },
    );
    await context.close();
  });

  it('serializes nested extension mutations per context, recovers after errors, and does not block other contexts', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const order: string[] = [];
    let first!: Context;
    const service = new BrowserQL({
      modules: [
        {
          name: 'sequence',
          typeDefs:
            'extend type Mutation { group: Mutation slow: String fail: String fast: String }',
          resolvers: {
            Mutation: {
              group: () => ({}),
              slow: async (_source, _args, context) => {
                if (context === first) await gate;
                order.push('slow');
                return 'slow';
              },
              fail: () => {
                order.push('fail');
                throw new Error('expected');
              },
              fast: () => {
                order.push('fast');
                return 'fast';
              },
            },
          },
        },
      ],
    });
    first = service.createContext(options);
    const pending = service.execute(
      { query: 'mutation { group { slow fail fast } }' },
      first,
    );
    const other = await service.execute(
      { query: 'mutation { fast }' },
      service.createContext(options),
    );
    assert.deepEqual(plain(other.data), { fast: 'fast' });
    assert.deepEqual(order, ['fast']);
    release();
    const result = await pending;
    assert.deepEqual(order, ['fast', 'slow', 'fail', 'fast']);
    assert.equal(result.errors?.length, 1);
    assert.deepEqual(plain(result.data), {
      group: { slow: 'slow', fail: null, fast: 'fast' },
    });
  });

  it('chains exports without reparsing interpolated strings and respects operation names and fragments', async () => {
    const value = 'quote"\nslash\\dollar$&';
    const service = new BrowserQL({
      modules: [
        {
          name: 'echo',
          typeDefs:
            'type Echo { value: String } extend type Mutation { echo(value:String!): Echo }',
          resolvers: {
            Mutation: { echo: (_source, args) => ({ value: args.value }) },
          },
        },
      ],
    });
    const result = await service.execute(
      {
        query:
          'mutation Ignore { echo(value:"wrong") { value } } mutation Run($input:String!) { ...First second:echo(value:"${saved}") { value } } fragment First on Mutation { first:echo(value:$input) { aliased:value @export(as:"saved") } }',
        variables: { input: value },
        operationName: 'Run',
      },
      service.createContext(options),
    );
    assert.deepEqual(plain(result), {
      data: { first: { aliased: value }, second: { value } },
    });
  });

  it('applies preferences to evaluation without replacing an explicit zero timeout', async () => {
    class API extends BQLBrowserAPI {
      override async start() {}
      override async close() {}
      onDisconnected() {
        return () => {};
      }
      override async evaluate({
        executionTimeout,
      }: {
        timeout?: number;
        executionTimeout?: number;
      }) {
        return { value: String(executionTimeout), time: 0 };
      }
    }
    const service = new BrowserQL({
      apiFactory: (options) => new API(options),
    });
    const context = service.createContext(options);
    const result = await service.execute(
      {
        query:
          'mutation { preferences(timeout:17) { timeout } inherited:evaluate(content:"1") { value } unlimited:evaluate(content:"1",timeout:0) { value } invalid:evaluate(content:"1",timeout:-1) { value } }',
      },
      context,
    );
    assert.deepEqual(plain(result.data), {
      preferences: { timeout: 17 },
      inherited: { value: '17' },
      unlimited: { value: '0' },
      invalid: null,
    });
    assert.equal(result.errors?.length, 1);
    await context.close();
  });

  it('keeps unavailable operations out of the schema', async () => {
    const service = new BrowserQL();
    for (const field of [
      'solve',
      'proxy',
      'verify',
      'liveURL',
      'reconnect',
      'loadSecret',
      'saveSecret',
      'agent',
    ]) {
      assert.equal(
        service.schema.getMutationType()?.getFields()[field],
        undefined,
      );
      assert.ok(
        (
          await service.execute(
            { query: `mutation { ${field} }` },
            service.createContext(options),
          )
        ).errors?.length,
      );
    }
  });
});
