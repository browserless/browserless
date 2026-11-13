import assert from 'node:assert/strict';
import {
  BrowserQL,
  BQLBrowserAPI,
  Context,
  defineBQLModule,
} from '@browserless.io/browserless';

const options = {} as ConstructorParameters<typeof BQLBrowserAPI>[0];
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

describe('BrowserQL schema and execution', () => {
  it('preserves per-field variable errors only in legacy mutation mode', async () => {
    for (const legacyMutationSemantics of [false, true]) {
      const service = new BrowserQL({ legacyMutationSemantics });
      const context = service.createContext(options);
      for (const variables of [{}, { content: 5 }]) {
        const result = await service.execute(
          {
            query:
              'mutation ($content: String!) { a:evaluate(content:$content){value} b:evaluate(content:"2"){value} }',
            variables,
          },
          context,
        );
        assert.deepEqual(
          plain(result.data ?? null),
          legacyMutationSemantics ? {} : null,
        );
        assert.equal(result.errors?.length, legacyMutationSemantics ? 2 : 1);
        if (legacyMutationSemantics)
          assert.deepEqual(plain(result.errors![0]), plain(result.errors![1]));
      }
      await context.close();
    }
  });

  it('preserves first-mutation selection and shallow exports when requested', async () => {
    const service = new BrowserQL({
      legacyMutationSemantics: true,
      modules: [
        {
          name: 'echo',
          typeDefs:
            'type Echo { value: String } extend type Mutation { echo(value:String!):Echo list:[Echo] fail:Echo }',
          resolvers: {
            Mutation: {
              echo: (_s, args) => ({ value: args.value }),
              list: () => [{ value: 'one' }, { value: 'two' }],
              fail: () => {
                throw new Error('failure');
              },
            },
          },
        },
      ],
    });
    const context = service.createContext(options);
    const query =
      'mutation A { echo(value:"A") {value} } mutation B {echo(value:"B"){value}}';
    for (const operationName of [undefined, 'B'])
      assert.deepEqual(
        plain(await service.execute({ query, operationName }, context)),
        { data: { echo: { value: 'A' } } },
      );
    assert.deepEqual(
      plain(
        await service.execute(
          {
            query:
              'mutation { ...F } fragment F on Mutation {echo(value:"not run"){value}}',
          },
          context,
        ),
      ),
      { data: {} },
    );
    for (const field of ['list', 'fail']) {
      const result = await service.execute(
        {
          query: `mutation { ${field} {value @export(as:"v")} echo(value:"\${v}"){value} }`,
        },
        context,
      );
      assert.deepEqual(plain(result.data?.echo), { value: 'undefined' });
    }
    await context.close();
  });

  it('executes repeated mutation fields in document order', async () => {
    let count = 0;
    const service = new BrowserQL({
      modules: [
        {
          name: 'counter',
          typeDefs: 'extend type Mutation { increment: Int }',
          resolvers: { Mutation: { increment: () => ++count } },
        },
      ],
    });
    const context = service.createContext(options);
    const result = await service.execute(
      { query: 'mutation { increment increment }' },
      context,
    );
    assert.deepEqual(plain(result), { data: { increment: 2 } });
    await context.close();
  });

  it('allows concurrent operations to release each other on one context', async function () {
    this.timeout(1000);
    let release!: () => void;
    const gate = new Promise<string>((resolve) => {
      release = () => resolve('released');
    });
    const service = new BrowserQL({
      modules: [
        {
          name: 'race',
          typeDefs: 'extend type Mutation { wait: String release: String }',
          resolvers: {
            Mutation: {
              wait: () => gate,
              release: () => {
                release();
                return 'triggered';
              },
            },
          },
        },
      ],
    });
    const context = service.createContext(options);
    try {
      const results = await Promise.all([
        service.execute({ query: 'mutation { wait }' }, context),
        service.execute({ query: 'mutation { release }' }, context),
      ]);
      assert.deepEqual(results.map(plain), [
        { data: { wait: 'released' } },
        { data: { release: 'triggered' } },
      ]);
    } finally {
      release();
      await context.close();
    }
  });

  it('rejects subscription operations through the non-streaming executor', async () => {
    const service = new BrowserQL();
    const context = service.createContext(options);
    const result = await service.execute(
      { query: 'subscription { console { text } }' },
      context,
    );
    assert.match(result.errors?.[0].message ?? '', /graphql-transport-ws/);
    assert.equal(result.data, undefined);
    await context.close();
  });

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

  it('keeps non-null error propagation by default and allows explicit partial-result continuation', async () => {
    for (const preserve of [false, true]) {
      const visited: string[] = [];
      const service = new BrowserQL({
        modules: [
          {
            name: 'steps',
            typeDefs:
              'extend type Mutation { firstStep: String requiredStep: String! lastStep: String }',
            resolvers: {
              Mutation: {
                firstStep: () => {
                  visited.push('first');
                  return 'first';
                },
                requiredStep: () => {
                  visited.push('required');
                  throw new Error('step failed');
                },
                lastStep: () => {
                  visited.push('last');
                  return 'last';
                },
              },
            },
          },
        ],
        mutationResultPolicy: preserve ? () => 'continue' : undefined,
      });
      const context = service.createContext(options);
      const result = await service.execute(
        {
          query: 'mutation { firstStep alias:requiredStep lastStep }',
        },
        context,
      );
      assert.deepEqual(result.errors?.[0].path, ['alias']);
      assert.deepEqual(
        plain(result.data),
        preserve ? { firstStep: 'first', lastStep: 'last' } : null,
      );
      assert.deepEqual(
        visited,
        preserve ? ['first', 'required', 'last'] : ['first', 'required'],
      );
      await context.close();
    }
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
    for (const name of ['', 'a}b', 'a.b']) {
      const context = service.createContext(options);
      const placeholder = JSON.stringify('${' + name + '} / ${unknown}');
      const literal = await service.execute(
        {
          query: `mutation($input:String!) { first:echo(value:$input) { value @export(as:${JSON.stringify(name)}) } second:echo(value:${placeholder}) { value } }`,
          variables: { input: value },
        },
        context,
      );
      assert.deepEqual(plain(literal), {
        data: { first: { value }, second: { value: value + ' / ${unknown}' } },
      });
      await context.close();
    }
    for (const variables of [undefined, null]) {
      const context = service.createContext(options);
      assert.deepEqual(
        plain(
          await service.execute(
            {
              query:
                'mutation($input:String! = "default") { echo(value:$input) { value } }',
              variables,
            },
            context,
          ),
        ),
        { data: { echo: { value: 'default' } } },
      );
      const missing = await service.execute(
        {
          query: 'mutation($input:String!) { echo(value:$input) { value } }',
          variables,
        },
        context,
      );
      assert.match(missing.errors![0].message, /non-null type "String!"/);
      await context.close();
    }
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
    assert.deepEqual(
      plain(
        await service.execute(
          {
            query:
              'mutation { null:preferences(timeout:null) { timeout } reset:preferences { timeout } }',
          },
          context,
        ),
      ),
      {
        data: {
          null: { timeout: 17 },
          reset: { timeout: 30000 },
        },
      },
    );
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
