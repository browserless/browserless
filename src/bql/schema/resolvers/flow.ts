import type { Resolver } from '@browserless.io/browserless';

const condition: Resolver = async (_source, args, context) => {
  const api = await context.getBrowser();
  if (
    args.selector &&
    (await api.getBoundingClientRect({
      selector: args.selector,
      visible: args.visible,
    }))
  )
    return true;
  if (
    args.request &&
    api.hasMadeRequest({
      urls: args.request.url ? [args.request.url] : undefined,
      methods: args.request.method ? [args.request.method] : undefined,
      operator: args.operator,
    })
  )
    return true;
  if (
    args.response &&
    api.hasReceivedResponse({
      urls: args.response.url ? [args.response.url] : undefined,
      statuses: args.response.statuses?.length
        ? args.response.statuses
        : args.response.codes?.length
          ? args.response.codes
          : undefined,
      operator: args.operator,
    })
  )
    return true;
  return false;
};

export const flow: Record<string, Resolver> = {
  if: async (...args) => ((await condition(...args)) ? {} : null),
  ifnot: async (...args) => ((await condition(...args)) ? null : {}),
};
