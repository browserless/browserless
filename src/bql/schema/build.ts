import {
  DocumentNode,
  GraphQLScalarType,
  Kind,
  assertValidSchema,
  buildASTSchema,
  concatAST,
  isObjectType,
  parse,
  valueFromASTUntyped,
} from 'graphql';

import {
  BQLBrowserAPI,
  BQLModule,
  Resolver,
  serializeApi,
} from '@browserless.io/browserless';
import { capture } from './resolvers/capture.js';
import { cookiesHeaders } from './resolvers/cookies-headers.js';
import { dom } from './resolvers/dom.js';
import { flow } from './resolvers/flow.js';
import { input } from './resolvers/input.js';
import { navigation } from './resolvers/navigation.js';
import { network } from './resolvers/network.js';
import { readFileSync } from 'node:fs';
import { subscriptionResolvers } from './resolvers/subscription.js';
import { wait } from './resolvers/wait.js';
import { windows } from './resolvers/windows.js';

const base = [
  'scalars-directives',
  'navigation',
  'dom',
  'input',
  'network',
  'capture',
  'cookies-headers',
  'wait',
  'windows',
  'flow',
  'query',
  'subscription',
].map((domain) =>
  parse(
    readFileSync(new URL(`./base/${domain}.graphql`, import.meta.url), 'utf8'),
  ),
);

export function buildBQLSchema<API extends BQLBrowserAPI = BQLBrowserAPI>(
  modules: BQLModule<API>[] = [],
  query: Record<string, Resolver<API>> = {},
) {
  const names = new Set(['core']);
  for (const module of modules) {
    if (!module.name.trim() || names.has(module.name))
      throw new Error(`Duplicate or empty module name: ${module.name}`);
    names.add(module.name);
  }
  const documents = modules.map(({ typeDefs }): DocumentNode =>
    typeof typeDefs === 'string'
      ? typeDefs.trim()
        ? parse(typeDefs)
        : { kind: Kind.DOCUMENT, definitions: [] }
      : typeDefs,
  );
  const schema = buildASTSchema(concatAST([...base, ...documents]));
  const resolvers: Record<string, Record<string, Resolver<API>>> = {
    Mutation: {
      ...navigation,
      ...dom,
      ...input,
      ...network,
      ...capture,
      ...cookiesHeaders,
      ...wait,
      ...windows,
      ...flow,
    },
    Query: query,
  };
  const subscriptions: Record<string, Resolver<API>> = {
    ...subscriptionResolvers,
  };
  for (const module of modules) {
    for (const [type, fields] of Object.entries(module.resolvers ?? {})) {
      resolvers[type] ??= Object.create(null) as Record<string, Resolver<API>>;
      for (const [field, resolver] of Object.entries(fields)) {
        if (Object.hasOwn(resolvers[type], field))
          throw new Error(`Duplicate resolver: ${type}.${field}`);
        resolvers[type][field] = resolver;
      }
    }
    for (const [field, resolver] of Object.entries(
      module.subscriptionResolvers ?? {},
    )) {
      if (Object.hasOwn(subscriptions, field))
        throw new Error(
          `Duplicate subscription resolver: Subscription.${field}`,
        );
      subscriptions[field] = resolver;
    }
  }
  for (const [name, fields] of Object.entries(resolvers)) {
    const type = schema.getType(name);
    if (!isObjectType(type))
      throw new Error(`Resolver type is not an object: ${name}`);
    for (const [name, resolver] of Object.entries(fields)) {
      const field = type.getFields()[name];
      if (!field)
        throw new Error(`Resolver field does not exist: ${type.name}.${name}`);
      field.resolve =
        type === schema.getMutationType() ? serializeApi(resolver) : resolver;
    }
  }
  for (const [name, resolver] of Object.entries(subscriptions)) {
    const field = schema.getSubscriptionType()?.getFields()[name];
    if (!field) throw new Error(`Subscription field does not exist: ${name}`);
    field.subscribe = resolver;
  }
  for (const field of Object.values(schema.getMutationType()!.getFields())) {
    if (!field.resolve)
      throw new Error(`Missing mutation resolver: ${field.name}`);
  }
  for (const field of Object.values(
    schema.getSubscriptionType()!.getFields(),
  )) {
    if (!field.subscribe)
      throw new Error(`Missing subscription resolver: ${field.name}`);
  }
  for (const name of ['FloatOrString', 'StringOrArray']) {
    const scalar = schema.getType(name) as GraphQLScalarType;
    const coerce = (value: unknown) => {
      if (
        typeof value === 'string' ||
        (name === 'FloatOrString'
          ? typeof value === 'number' && Number.isFinite(value)
          : Array.isArray(value) &&
            value.every((item) => typeof item === 'string'))
      )
        return value;
      throw new Error(`${name} received an invalid value`);
    };
    scalar.serialize = coerce;
    scalar.parseValue = coerce;
    scalar.parseLiteral = (node, variables) =>
      coerce(valueFromASTUntyped(node, variables));
  }
  assertValidSchema(schema);
  return schema;
}
