import { BadRequest, Resolver } from '@browserless.io/browserless';

export const wait: Record<string, Resolver> = {
  waitForNavigation: async (_source, args, context) =>
    (await context.getBrowser()).waitForNavigation(
      args.waitUntil,
      args.timeout,
    ),
  waitForRequest: async (_source, args, context) => {
    const start = Date.now();
    const [request] = await (
      await context.getBrowser()
    ).waitForRequest({
      urls: args.url ? [args.url] : undefined,
      methods: args.method ? [args.method] : undefined,
      operator: args.operator,
      timeout: args.timeout,
    });
    return { time: Date.now() - start, url: request.url };
  },
  waitForResponse: async (_source, args, context) => {
    const start = Date.now();
    const [response] = await (
      await context.getBrowser()
    ).waitForResponse({
      urls: args.url ? [args.url] : undefined,
      statuses: args.statuses?.length
        ? args.statuses
        : args.codes?.length
          ? args.codes
          : undefined,
      operator: args.operator,
      timeout: args.timeout,
    });
    return {
      time: Date.now() - start,
      url: response.url,
      status: response.status,
    };
  },
  waitForTimeout: async (_source, args, context) =>
    (await context.getBrowser()).waitForTimeout({ time: args.time }),
  waitForNetworkIdle: async (_source, args, context) =>
    (await context.getBrowser()).waitForNetworkIdle(args),
  waitForSelector: async (_source, args, context) => {
    if (args.visible && args.hidden)
      throw new BadRequest('"visible" and "hidden" are mutually exclusive');
    const start = Date.now();
    const result = await (
      await context.getBrowser()
    ).waitForSelector({ ...args, selector: args.selector });
    return { ...result, selector: args.selector, time: Date.now() - start };
  },
  waitForFunction: async (_source, args, context) =>
    (await context.getBrowser()).waitForFunction({ ...args, fn: args.fn }),
  waitForEvent: async (_source, args, context) =>
    (await context.getBrowser()).waitForEvent({ ...args, event: args.event }),
  watchEvent: async (_source, args, context) =>
    (await context.getBrowser()).watchEvent({ event: args.event }),
};
