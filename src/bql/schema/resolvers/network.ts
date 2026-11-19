import { BadRequest, Resolver } from '@browserless.io/browserless';
import { Kind } from 'graphql';

export const network: Record<string, Resolver> = {
  request: async (_source, args, context) =>
    (await context.getBrowser()).request({ ...args, wait: args.wait }),
  response: async (_source, args, context, info) =>
    (await context.getBrowser()).response({
      ...args,
      wait: args.wait,
      // Fragments conservatively request bodies, even without fragment metadata.
      includeBody:
        !info ||
        info.fieldNodes.some((node) =>
          node.selectionSet?.selections.some(
            (selection) =>
              selection.kind !== Kind.FIELD ||
              selection.name.value === 'body' ||
              selection.name.value === 'base64Encoded',
          ),
        ),
    }),
  reject: async (_source, args, context) =>
    (await context.getBrowser()).reject({ ...args, enabled: args.enabled }),
  fulfill: async (_source, args, context) => {
    if (!args.url && !args.regex && !args.method && !args.type) {
      throw new BadRequest('At least one request filter is required');
    }
    return (await context.getBrowser()).fulfill({
      ...args,
      status: args.status,
    });
  },
};
