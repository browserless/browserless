import type { Resolver } from '../../module.js';

export const dom: Record<string, Resolver> = {
  html: async (_source, args, context) =>
    (await context.getBrowser()).html(args),
  text: async (_source, args, context) =>
    (await context.getBrowser()).text(args),
  markdown: async (_source, args, context) =>
    (await context.getBrowser()).markdown(args),
  title: async (_source, _args, context) => ({
    title: (await (await context.getBrowser()).title()).value,
  }),
  url: async (_source, _args, context) => ({
    url: (await (await context.getBrowser()).url()).value,
  }),
  evaluate: async (_source, args, context) => {
    if (args.timeout != null && args.timeout < 0)
      throw new Error('timeout must be zero or greater');
    const api = await context.getBrowser();
    return api.evaluate({
      ...args,
      timeout: args.timeout ?? api.preferences({}).timeout,
    });
  },
  mapSelector: async (_source, args, context) =>
    (await context.getBrowser()).mapSelector({
      ...args,
      selector: args.selector,
    }),
  querySelector: async (_source, args, context) =>
    (await context.getBrowser()).querySelector({
      ...args,
      selector: args.selector,
    }),
  querySelectorAll: async (_source, args, context) =>
    (await context.getBrowser()).querySelectorAll({
      ...args,
      selector: args.selector,
    }),
  addScriptTag: async (_source, args, context) =>
    (await context.getBrowser()).addScriptTag(args),
  addStyleTag: async (_source, args, context) =>
    (await context.getBrowser()).addStyleTag(args),
};
