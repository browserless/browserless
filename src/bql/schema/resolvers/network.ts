import { BadRequest } from '../../../utils.js';
import type { Resolver } from '../../module.js';

export const network: Record<string, Resolver> = {
  request: async (_source, args, context) =>
    (await context.getBrowser()).request({ ...args, wait: args.wait }),
  response: async (_source, args, context) =>
    (await context.getBrowser()).response({ ...args, wait: args.wait }),
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
