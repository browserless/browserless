import type { BQLBrowserAPI, Context } from '@browserless.io/browserless';
import type { DocumentNode, GraphQLFieldResolver } from 'graphql';

export type Resolver<API extends BQLBrowserAPI = BQLBrowserAPI> =
  GraphQLFieldResolver<unknown, Context<API>>;

/** Add SDL definitions and standard graphql-js field resolvers. */
export interface BQLModule<API extends BQLBrowserAPI = BQLBrowserAPI> {
  name: string;
  typeDefs: string | DocumentNode;
  resolvers?: Record<string, Record<string, Resolver<API>>>;
  subscriptionResolvers?: Record<string, Resolver<API>>;
}

export const defineBQLModule = <API extends BQLBrowserAPI = BQLBrowserAPI>(
  module: BQLModule<API>,
): BQLModule<API> => module;
