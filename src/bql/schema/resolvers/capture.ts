import type { Resolver } from '@browserless.io/browserless';

export const capture: Record<string, Resolver> = {
  screenshot: async (_source, args, context) =>
    (await context.getBrowser()).screenshot({
      selector: args.selector,
      options: args,
    }),
  pdf: async (_source, args, context) =>
    (await context.getBrowser()).pdf({ options: args }),
  viewport: async (_source, args, context) =>
    (await context.getBrowser()).viewport({
      ...args,
      width: args.width,
      height: args.height,
    }),
  emulateMediaType: async (_source, args, context) =>
    (await context.getBrowser()).emulateMediaType({ type: args.type }),
};
