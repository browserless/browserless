import type { BQLBrowserAPI } from './api/browser-api.js';
import type { Resolver } from './module.js';

/** One queue per context, shared by every field and every composed module. */
export const serializeApi = <API extends BQLBrowserAPI>(
  resolver: Resolver<API>,
): Resolver<API> => {
  return (source, args, context, info) =>
    context.runSerial(() => resolver(source, args, context, info));
};
