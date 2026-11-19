import assert from 'node:assert/strict';
import {
  BrowserQL,
  BQLBrowserAPI,
  executeWithChaining,
} from '@browserless.io/browserless';
import {
  GraphQLError,
  GraphQLScalarType,
  buildSchema,
  execute,
  parse,
  responsePathAsArray,
} from 'graphql';

const options = {} as ConstructorParameters<typeof BQLBrowserAPI>[0];
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

describe('mutation execution boundary', () => {
  it('closes an async mutation-list iterator when next rejects', async () => {
    const schema = buildSchema(
      'type Query { unused: Boolean } type Mutation { groups: [Mutation] step: String }',
    );
    let closed = false;
    const root = {
      groups: {
        [Symbol.asyncIterator]: () => ({
          next: async () => {
            throw new Error('iterator failed');
          },
          return: async () => {
            closed = true;
            return { done: true };
          },
        }),
      },
    };
    const result = await executeWithChaining(
      schema,
      'mutation { groups { step } }',
      root,
      {},
    );
    assert.deepEqual(
      result.errors?.map(({ message, path }) => ({ message, path })),
      [{ message: 'iterator failed', path: ['groups'] }],
    );
    assert.equal(closed, true);
  });

  it('preserves typed resolver paths and the identity of coerced input objects', async () => {
    const schema = buildSchema(`
      type Query { unused: Boolean }
      input Options { value: String }
      type Output { check: Boolean }
      type Mutation { group: Mutation output(x: Options!): Output }
    `);
    const root = {
      group: () => root,
      output: (args: any, _context: unknown, info: any) => ({
        check: (_args: unknown, _ctx: unknown, child: any) =>
          args.x === info.variableValues.coerced.x &&
          child.path.typename === 'Output' &&
          child.path.prev.typename === 'Mutation' &&
          (!child.path.prev.prev ||
            child.path.prev.prev.typename === 'Mutation'),
      }),
    };
    for (const selection of [
      'output(x: $x) { check }',
      'group { output(x: $x) { check } }',
    ]) {
      const result = await executeWithChaining(
        schema,
        `mutation($x: Options!) { ${selection} }`,
        root,
        {},
        { x: { value: 'yes' } },
      );
      assert.equal(result.errors, undefined);
      assert.deepEqual(
        plain(result.data),
        selection.startsWith('group')
          ? { group: { output: { check: true } } }
          : { output: { check: true } },
      );
    }
  });

  it('keeps covariant interface fields valid during execution', async () => {
    const schema = buildSchema(`
      type Query { unused: Boolean }
      interface Branch { next: Branch value: String }
      type Mutation implements Branch { next: Mutation value: String }
    `);
    const root = { next: { value: 'nested' }, value: 'root' };
    for (const query of ['mutation { next { value } }', 'mutation { value }']) {
      assert.deepEqual(
        plain(await executeWithChaining(schema, query, root, {})),
        plain(
          await execute({ schema, document: parse(query), rootValue: root }),
        ),
      );
    }
  });

  it('retains fragment argument scope inside nested mutation selections', async () => {
    const schema = buildSchema(`type Query { unused: Boolean }
      type Mutation { group: Mutation step(name: String!): String }`);
    const root = {
      group: () => root,
      step: ({ name }: { name: string }) => name,
    };
    const document = parse(
      `mutation { outer: group { ...F(name: "ready") } }
      fragment F($name: String!) on Mutation { inner: group { step(name: $name) } }`,
      { experimentalFragmentArguments: true },
    );
    assert.deepEqual(
      plain(await executeWithChaining(schema, document, root, {})),
      { data: { outer: { inner: { step: 'ready' } } } },
    );
  });

  it('stops actions after a non-null list item fails, but continues past nullable items', async () => {
    for (const required of [true, false]) {
      const schema = buildSchema(`type Query { unused: Boolean }
        type Mutation { groups: [Mutation${required ? '!' : ''}] step: String after: String }`);
      const seen: string[] = [];
      const root = {
        groups: [
          null,
          {
            step: () => {
              seen.push('step');
              return 'ok';
            },
          },
        ],
        after: () => {
          seen.push('after');
          return 'ok';
        },
      };
      const result = await executeWithChaining(
        schema,
        'mutation { groups { step } after }',
        root,
        {},
      );
      assert.deepEqual(seen, required ? ['after'] : ['step', 'after']);
      assert.deepEqual(plain(result.data), {
        groups: required ? null : [null, { step: 'ok' }],
        after: 'ok',
      });
      assert.deepEqual(
        result.errors?.[0].path,
        required ? ['groups', 0] : undefined,
      );
    }
  });

  it('rejects primitive strings as mutation lists without running child actions', async () => {
    const schema = buildSchema(`type Query { unused: Boolean }
      type Mutation { groups: [Mutation] step: String }`);
    let calls = 0;
    schema.getMutationType()!.getFields().step.resolve = () => {
      calls++;
      return 'bad';
    };
    const root = { groups: 'ab' };
    const query = 'mutation { groups { step } }';
    assert.deepEqual(
      plain(await executeWithChaining(schema, query, root, {})),
      plain(await execute({ schema, document: parse(query), rootValue: root })),
    );
    assert.equal(calls, 0);
  });

  it('honors Mutation.isTypeOf before starting nested actions', async () => {
    for (const asyncPredicate of [false, true]) {
      const schema = buildSchema(`type Query { unused: Boolean }
        type Mutation { group: Mutation groups: [Mutation] step: String }`);
      schema.getMutationType()!.isTypeOf = (value: any) =>
        asyncPredicate
          ? Promise.resolve(value.accepted === true)
          : value.accepted === true;
      let calls = 0;
      const bad = {
        step: () => {
          calls++;
          return 'bad';
        },
      };
      const good = { accepted: true, step: () => 'good' };
      const root = { group: bad, groups: [bad, good] };
      const query = 'mutation { group { step } groups { step } }';
      assert.deepEqual(
        plain(await executeWithChaining(schema, query, root, {})),
        plain(
          await execute({ schema, document: parse(query), rootValue: root }),
        ),
      );
      assert.equal(calls, 0);
    }
  });

  it('preserves resolver-supplied absolute error paths', async () => {
    const schema = buildSchema(`type Query { unused: Boolean }
      type Mutation { group: Mutation fail: String }`);
    const root = {
      group: () => root,
      fail: (_a: unknown, _c: unknown, info: any) => {
        throw new GraphQLError('expected', {
          path: responsePathAsArray(info.path),
        });
      },
    };
    const query = 'mutation { outer: group { alias: fail } }';
    assert.deepEqual(
      plain(await executeWithChaining(schema, query, root, {})),
      plain(await execute({ schema, document: parse(query), rootValue: root })),
    );
  });

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
