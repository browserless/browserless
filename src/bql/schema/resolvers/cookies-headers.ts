import { BadRequest, type Resolver } from '@browserless.io/browserless';

export const cookiesHeaders: Record<string, Resolver> = {
  authenticate: async (_source, args, context) =>
    (await context.getBrowser()).authenticate({
      username: args.username,
      password: args.password,
      origin: args.origin,
    }),
  cookies: async (_source, args, context) =>
    (await context.getBrowser()).cookies(args),
  setExtraHTTPHeaders: async (_source, args, context) =>
    (await context.getBrowser()).setExtraHTTPHeaders({ headers: args.headers }),
  userAgent: async (_source, args, context) =>
    (await context.getBrowser()).userAgent({ userAgent: args.userAgent }),
  javaScriptEnabled: async (_source, args, context) =>
    (await context.getBrowser()).javaScriptEnabled({ enabled: args.enabled }),
  preferences: async (_source, args, context) => {
    if (
      args.timeout != null &&
      (args.timeout < 1 || args.timeout > 2147483647)
    ) {
      throw new BadRequest('"timeout" must be between 1 and 2147483647');
    }
    return (await context.getBrowser()).preferences(args);
  },
};
