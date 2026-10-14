import { BadRequest } from '../../../utils.js';
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
    if (!args.content && !args.url)
      throw new BadRequest('One of "content" or "url" is required');
    if (args.timeout != null && args.timeout < 0)
      throw new BadRequest('"timeout" must be 0 (no limit) or greater');
    const api = await context.getBrowser();
    const executionTimeout = args.timeout ?? api.preferences({}).timeout;
    const options = {
      content: args.content ?? undefined,
      url: args.url ?? undefined,
      // Fetching a script retains its own finite bound when execution is unlimited.
      timeout: args.timeout || undefined,
      executionTimeout,
    };
    const evaluation = api.evaluate(options);
    if (executionTimeout <= 0) return evaluation;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        evaluation,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(
                Object.assign(
                  new Error(`"evaluate" timed out after ${executionTimeout}ms`),
                  { name: 'TimeoutError' },
                ),
              ),
            Math.min(executionTimeout, 2 ** 31 - 1),
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
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
  addScriptTag: async (_source, args, context) => {
    if (!args.url && !args.content)
      throw new BadRequest('One of "url" or "content" is required');
    return (await context.getBrowser()).addScriptTag(args);
  },
  addStyleTag: async (_source, args, context) => {
    if (!args.url && !args.content)
      throw new BadRequest('One of "url" or "content" is required');
    return (await context.getBrowser()).addStyleTag(args);
  },
};
