import type { Resolver } from '../../module.js';

export const network: Record<string, Resolver> = {
  request: async (_source, args, context) =>
    (await context.getBrowser()).request({ ...args, wait: args.wait }),
  response: async (_source, args, context) =>
    (await context.getBrowser()).response({ ...args, wait: args.wait }),
  reject: async (_source, args, context) =>
    (await context.getBrowser()).reject({ ...args, enabled: args.enabled }),
  fulfill: async (_source, args, context) => {
    if (
      !args.url?.length &&
      !args.regex?.length &&
      !args.method?.length &&
      !args.type?.length
    ) {
      throw new Error('At least one request filter is required');
    }
    return (await context.getBrowser()).fulfill({
      ...args,
      status: args.status,
    });
  },
};
