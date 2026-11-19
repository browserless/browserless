import assert from 'node:assert/strict';
import {
  BrowserQL,
  BQLBrowserAPI,
  executeWithChaining,
} from '@browserless.io/browserless';
import {
  GraphQLError,
  GraphQLScalarType,
  execute,
  parse,
  responsePathAsArray,
} from 'graphql';

const options = {} as ConstructorParameters<typeof BQLBrowserAPI>[0];
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

describe('mutation execution boundary', () => {
  it('retains the operation-wide serial lock across abstract extension results', async () => {
    let active = 0;
    let maximum = 0;
    const service = new BrowserQL({
      modules: [
        {
          name: 'abstract',
          typeDefs:
            'union Group = Mutation extend type Mutation { abstract: Group group: Mutation step: String }',
          resolvers: {
            Mutation: {
              abstract: () => ({ __typename: 'Mutation' }),
              group: () => ({}),
              step: async () => {
                maximum = Math.max(maximum, ++active);
                await new Promise((resolve) => setTimeout(resolve, 5));
                active--;
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
          'mutation { abstract { ... on Mutation { group { step } step } } }',
      },
      context,
    );
    assert.equal(result.errors, undefined);
    assert.equal(maximum, 1);
    await context.close();
  });

  it('preserves errors returned as nullable mutation-list items', async () => {
    const service = new BrowserQL({
      modules: [
        {
          name: 'list-errors',
          typeDefs: 'extend type Mutation { groups: [Mutation] value: String }',
          resolvers: {
            Mutation: {
              groups: () => [new Error('expected'), { value: 'ok' }],
              value: (source) => (source as { value: string }).value,
            },
          },
        },
      ],
    });
    const context = service.createContext(options);
    const query = 'mutation { groups { value } }';
    const expected = await execute({
      schema: service.schema,
      document: parse(query),
      contextValue: context,
    });
    assert.deepEqual(
      plain(await service.execute({ query }, context)),
      plain(expected),
    );
    await context.close();
  });

  it('completes async iterable mutation lists instead of exposing raw sources', async () => {
    const service = new BrowserQL({
      modules: [
        {
          name: 'iterable',
          typeDefs: 'extend type Mutation { groups: [Mutation] value: String }',
          resolvers: {
            Mutation: {
              groups: async function* () {
                yield { raw: 'first' };
                yield { raw: 'second' };
              },
              value: (source) => (source as { raw: string }).raw,
            },
          },
        },
      ],
    });
    const context = service.createContext(options);
    const result = await service.execute(
      { query: 'mutation { groups { value } }' },
      context,
    );
    assert.deepEqual(plain(result), {
      data: { groups: [{ value: 'first' }, { value: 'second' }] },
    });
    await context.close();
  });

  it('keeps an undefined original root and completes response resolvers and scalars once', async () => {
    let resolutions = 0;
    let coercions = 0;
    const service = new BrowserQL({
      modules: [
        {
          name: 'completion',
          typeDefs:
            'scalar Once type Output { value: Once } extend type Mutation { group: Mutation output: Output }',
          resolvers: {
            Mutation: {
              group: () => ({}),
              output: (_s, _a, _c, info) => {
                assert.equal(info.rootValue, undefined);
                return { raw: true };
              },
            },
            Output: {
              value: (source) => {
                resolutions++;
                return source;
              },
            },
          },
        },
      ],
    });
    (service.schema.getType('Once') as GraphQLScalarType).coerceOutputValue = (
      value,
    ) => {
      coercions++;
      assert.deepEqual(value, { raw: true });
      return 'done';
    };
    const context = service.createContext(options);
    assert.deepEqual(
      plain(
        await service.execute(
          { query: 'mutation { group { group { output { value } } } }' },
          context,
        ),
      ),
      {
        data: { group: { group: { output: { value: 'done' } } } },
      },
    );
    assert.equal(resolutions, 1);
    assert.equal(coercions, 1);
    await context.close();
  });

  it('consults legacy result policy for each variable-error field and stops on the original field name', async () => {
    for (const legacyMutationSemantics of [true, false]) {
      for (const stop of [true, false]) {
        const seen: string[] = [];
        const service = new BrowserQL({
          legacyMutationSemantics,
          mutationResultPolicy: (field, result) => {
            seen.push(field);
            assert.equal(result.errors?.length, 1);
            return stop && field === 'configure' ? 'stop' : undefined;
          },
          modules: [
            {
              name: 'policy',
              typeDefs:
                'extend type Mutation { configure: String required(value: String!): String }',
              resolvers: {
                Mutation: { configure: () => 'ok', required: () => 'ok' },
              },
            },
          ],
        });
        const context = service.createContext(options);
        const result = await service.execute(
          {
            query:
              'mutation($value: String!) { alias: configure required(value: $value) }',
          },
          context,
        );
        assert.equal(
          result.errors?.length,
          legacyMutationSemantics && !stop ? 2 : 1,
        );
        assert.deepEqual(
          seen,
          legacyMutationSemantics
            ? stop
              ? ['configure']
              : ['configure', 'required']
            : [],
        );
        await context.close();
      }
    }
  });

  it('retains nested fragment selections and resolver source, root and response paths', async () => {
    const root = { root: true };
    const service = new BrowserQL({
      modules: [
        {
          name: 'metadata',
          typeDefs: 'extend type Mutation { group: Mutation check: String }',
          resolvers: {
            Mutation: {
              group: () => ({ nested: true }),
              check: (source, _args, _context, info) => {
                assert.deepEqual(source, { nested: true });
                assert.equal(info.rootValue, root);
                assert.deepEqual(responsePathAsArray(info.path), [
                  'outer',
                  'inner',
                  'value',
                ]);
                assert.equal(info.schema, service.schema);
                return 'ok';
              },
            },
          },
        },
      ],
    });
    const result = await executeWithChaining(
      service.schema,
      `mutation { outer: group { ...Outer } }
      fragment Outer on Mutation { inner: group { ...Inner } }
      fragment Inner on Mutation { value: check }`,
      root,
      service.createContext(options),
    );
    assert.deepEqual(plain(result), {
      data: { outer: { inner: { value: 'ok' } } },
    });
  });

  it('preserves GraphQL error paths, extensions, locations and non-null propagation', async () => {
    const service = new BrowserQL({
      modules: [
        {
          name: 'errors',
          typeDefs:
            'extend type Mutation { group: Mutation requiredGroup: Mutation! fail: String required: String! }',
          resolvers: {
            Mutation: {
              group: () => ({}),
              requiredGroup: () => ({}),
              fail: () => {
                throw new GraphQLError('expected', {
                  extensions: { code: 'EXPECTED' },
                });
              },
              required: () => {
                throw new GraphQLError('required', {
                  extensions: { code: 'REQUIRED' },
                });
              },
            },
          },
        },
      ],
    });
    for (const query of [
      'mutation { outer: group { inner: group { alias: fail } } }',
      'mutation { outer: group { inner: requiredGroup { alias: required } } }',
      'mutation { outer: requiredGroup { inner: requiredGroup { alias: required } } }',
    ]) {
      const context = service.createContext(options);
      const expected = await execute({
        schema: service.schema,
        document: parse(query),
        contextValue: context,
      });
      assert.deepEqual(
        plain(await service.execute({ query }, context)),
        plain(expected),
      );
      await context.close();
    }
  });
});
