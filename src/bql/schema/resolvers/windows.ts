import type { Resolver } from '../../module.js';

export const windows: Record<string, Resolver> = {
  windows: async (_source, _args, context) =>
    (await context.getBrowser()).windows(),
  switchToWindow: async (_source, args, context) =>
    (await context.getBrowser()).switchToWindow(args),
};
