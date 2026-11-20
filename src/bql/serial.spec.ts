import assert from 'node:assert/strict';
import { BQLBrowserAPI, BrowserQL } from '@browserless.io/browserless';

const options = {} as ConstructorParameters<typeof BQLBrowserAPI>[0];

describe('nested mutation order', () => {
  it('does not deadlock later siblings after non-null argument coercion aborts a branch', async () => {
    const order: string[] = [];
    const service = new BrowserQL({
      modules: [
        {
          name: 'failure',
          typeDefs:
            'extend type Mutation { group: Mutation required(name: String! = "default"): String! step: String }',
          resolvers: {
            Mutation: {
              group: () => ({}),
              required: (_source, { name }) => name,
              step: () => {
                order.push('step');
                return 'ok';
              },
            },
          },
        },
      ],
    });
    const context = service.createContext(options);
    const result = await service.execute(
      {
        query:
          'mutation($invalid: String) { group { nested: group { required(name: $invalid) step } step } }',
        variables: { invalid: null },
      },
      context,
    );
    assert.deepEqual(order, ['step']);
    assert.deepEqual(
      result.errors?.map((error) => error.path),
      [['group', 'nested', 'required']],
    );
    assert.deepEqual(JSON.parse(JSON.stringify(result.data)), {
      group: { nested: null, step: 'ok' },
    });
    await context.close();
  });

  it('orders list groups and merged selections without waiting for invalid arguments', async () => {
    const order: string[] = [];
    const service = new BrowserQL({
      modules: [
        {
          name: 'lists',
          typeDefs:
            'extend type Mutation { group: Mutation groups: [Mutation] step(name: String! = "default"): String }',
          resolvers: {
            Mutation: {
              group: () => ({}),
              groups: () => [{}, null, {}],
              step: (_source, { name }) => {
                order.push(name);
                return name;
              },
            },
          },
        },
      ],
    });
    const context = service.createContext(options);
    const result = await service.execute(
      {
        query: `mutation($invalid: String) {
        group {
          groups { a: step(name: "a") group { b: step(name: "b") } c: step(name: "c") }
          merged: group { x: step(name: "x") }
          merged: group { y: step(name: "y") }
          invalid: step(name: $invalid)
          d: step(name: "d")
        }
      }`,
        variables: { invalid: null },
      },
      context,
    );
    assert.deepEqual(order, ['a', 'b', 'c', 'a', 'b', 'c', 'x', 'y', 'd']);
    assert.deepEqual(
      result.errors?.map((error) => error.path),
      [['group', 'invalid']],
    );
    await context.close();
  });

  for (const fail of [false, true]) {
    it(`finishes nested conditions before later siblings (failure: ${fail})`, async () => {
      const order: string[] = [];
      class API extends BQLBrowserAPI {
        override async start() {}
        override async close() {}
        override hasMadeRequest() {
          return [
            {
              id: '1',
              url: 'https://example.com',
              method: 'GET',
              type: 'Document',
              headers: {},
            },
          ];
        }
      }
      const service = new BrowserQL({
        apiFactory: () => new API(options),
        modules: [
          {
            name: 'order',
            typeDefs:
              'extend type Mutation { step(name: String!): String broken: Mutation }',
            resolvers: {
              Mutation: {
                step: async (_source, { name }) => {
                  await Promise.resolve();
                  order.push(name);
                  if (fail && name === 'c') throw new Error('expected failure');
                  if (name === 'd') assert.ok(order.includes('c'));
                  return name;
                },
                broken: () => {
                  throw new Error('broken condition');
                },
              },
            },
          },
        ],
      });
      const context = service.createContext(options);
      const result = await service.execute(
        {
          query: `mutation($skip: Boolean!) {
          outer: if(request: {}) {
            a: step(name: "a")
            nested: ifnot(selector: "") { ...Steps }
            skipped: ifnot(request: {}) { step(name: "never") }
            broken { step(name: "never") }
            d: step(name: "d")
          }
        }
        fragment Steps on Mutation {
          omitted: step(name: "never") @skip(if: $skip)
          ... on Mutation { c: step(name: "c") }
        }`,
          variables: { skip: true },
        },
        context,
      );
      assert.deepEqual(order, ['a', 'c', 'd']);
      assert.deepEqual(
        result.errors?.map((error) => error.path),
        fail
          ? [
              ['outer', 'nested', 'c'],
              ['outer', 'broken'],
            ]
          : [['outer', 'broken']],
      );
      assert.equal((result.data?.outer as Record<string, unknown>).d, 'd');
      await context.close();
    });
  }
});
