import type { BQLBrowserAPI, Resolver } from '@browserless.io/browserless';

/** One queue per context, shared by every field and every composed module. */
export const serializeApi = <API extends BQLBrowserAPI>(
  resolver: Resolver<API>,
): Resolver<API> => {
  return (source, args, context, info) =>
    context.runSerial(() => resolver(source, args, context, info));
};
