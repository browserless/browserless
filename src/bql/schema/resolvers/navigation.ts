import type { Resolver } from '@browserless.io/browserless';

export const navigation: Record<string, Resolver> = {
  back: async (_source, args, context) =>
    (await context.getBrowser()).back(args),
  forward: async (_source, args, context) =>
    (await context.getBrowser()).forward(args),
  reload: async (_source, args, context) =>
    (await context.getBrowser()).reload(args),
  goto: async (_source, args, context) =>
    (await context.getBrowser()).goto({
      ...args,
      url: args.url,
      waitUntil: args.waitUntilAll?.length ? args.waitUntilAll : args.waitUntil,
    }),
  content: async (_source, args, context) =>
    (await context.getBrowser()).content({
      ...args,
      html: args.html,
      waitUntil: args.waitUntilAll?.length ? args.waitUntilAll : args.waitUntil,
    }),
};
