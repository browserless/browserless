import type { BQLBrowserAPI, Resolver } from '@browserless.io/browserless';

// GraphQL creates a fresh coerced variable map for each execution, shared by
// its nested fields. Independent operations may release each other's waits.
const queues = new WeakMap<object, Promise<unknown>>();

/** Serialize nested mutations within an execution, not across a session. */
export const serializeApi = <API extends BQLBrowserAPI>(
  resolver: Resolver<API>,
): Resolver<API> => {
  return (source, args, context, info) => {
    const key = info?.variableValues ?? context;
    const result = (queues.get(key) ?? Promise.resolve()).then(() =>
      resolver(source, args, context, info),
    );
    queues.set(
      key,
      result.catch(() => undefined),
    );
    return result;
  };
};
