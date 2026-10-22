import { GraphQLResolveInfo, Kind, SelectionSetNode } from 'graphql';
import type { Resolver } from '@browserless.io/browserless';
import micromatch from 'micromatch';

interface NetworkEvent {
  id: string;
  url: string;
  method: string;
  type: string;
  status?: number;
  headers: Record<string, string>;
}
interface Filter {
  url?: string[];
  method?: string[];
  type?: string[];
  status?: number[];
  operator?: 'and' | 'or';
}

function matches(event: NetworkEvent, filter: Filter): boolean {
  const checks: boolean[] = [];
  const match = (results: boolean[]) =>
    filter.operator === 'and' ? results.every(Boolean) : results.some(Boolean);
  if (filter.url?.length)
    checks.push(
      match(
        filter.url.map((pattern) =>
          micromatch.isMatch(event.url, pattern, { bash: true }),
        ),
      ),
    );
  if (filter.method?.length)
    checks.push(match(filter.method.map((method) => event.method === method)));
  if (filter.type?.length)
    checks.push(match(filter.type.map((type) => event.type === type)));
  if (filter.status?.length)
    checks.push(match(filter.status.map((status) => event.status === status)));
  return !checks.length || match(checks);
}

function wantsBody(info: GraphQLResolveInfo): boolean {
  function selected(set?: SelectionSetNode): boolean {
    return (
      set?.selections.some((node) => {
        if (node.kind === Kind.FIELD)
          return (
            node.name.value === 'body' || node.name.value === 'base64Encoded'
          );
        return selected(
          node.kind === Kind.INLINE_FRAGMENT
            ? node.selectionSet
            : info.fragments[node.name.value]?.selectionSet,
        );
      }) ?? false
    );
  }
  return info.fieldNodes.some((node) => selected(node.selectionSet));
}

function stream(field: 'console' | 'request' | 'response'): Resolver {
  return async (_source, args: Filter, context, info) => {
    const api = await context.getBrowser();
    if (field === 'console') await api.ensureConsoleCapture();
    const events = api.streamEvents<NetworkEvent>(field);
    let closed = false;
    let unregister = () => {};
    const close = async () => {
      closed = true;
      unregister();
      return events.return(undefined);
    };
    try {
      unregister = context.onClose(close);
    } catch (error) {
      await close();
      throw error;
    }
    // Forward return to the source: async-generator wrappers cannot cancel an idle next().
    return {
      async next(): Promise<IteratorResult<Record<string, unknown>>> {
        try {
          while (!closed) {
            const result = await events.next();
            if (result.done) {
              await close();
              return { done: true, value: undefined };
            }
            if (field === 'console')
              return { done: false, value: { console: result.value } };
            const event = result.value;
            if (!matches(event, args)) continue;
            const body =
              field === 'response' && wantsBody(info)
                ? await api.getResponseBody(event.id)
                : null;
            if (closed) break;
            return {
              done: false,
              value: {
                [field]: {
                  ...event,
                  headers: Object.entries(event.headers ?? {}).map(
                    ([name, value]) => ({ name, value }),
                  ),
                  ...(field === 'response'
                    ? {
                        body: body?.body ?? null,
                        base64Encoded: body?.base64Encoded ?? false,
                      }
                    : {}),
                },
              },
            };
          }
          return { done: true, value: undefined };
        } catch (error) {
          await close();
          throw error;
        }
      },
      return: close,
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  };
}

export const subscriptionResolvers: Record<string, Resolver> = {
  console: stream('console'),
  request: stream('request'),
  response: stream('response'),
};
