# Extending BrowserQL

Configure a `BrowserQL` service and inject it into `Browserless`. The same service
is available to the HTTP and WebSocket routes; each request or connection still
gets its own context and browser API instance.

## Add fields with a module

```ts
import {
  Browserless,
  BrowserQL,
  defineBQLModule,
} from '@browserless.io/browserless';

const pageTools = defineBQLModule({
  name: 'page-tools',
  typeDefs: `
    extend type Query {
      toolVersion: String!
    }
    extend type Mutation {
      pageTextLength: Int!
    }
  `,
  resolvers: {
    Query: {
      toolVersion: () => '1',
    },
    Mutation: {
      pageTextLength: async (_source, _args, context) => {
        const api = await context.getBrowser();
        const result = await api.text();
        return result.text.length;
      },
    },
  },
});

const bql = new BrowserQL({ modules: [pageTools] });
await new Browserless({ bql }).start();
```

Clients can discover `page-tools` through `Query.capabilities`, the HTTP
`X-BQL-Capabilities` header, or the WebSocket initialization acknowledgement.

A `BQLModule` has a unique `name`, `typeDefs` as SDL text or a GraphQL
`DocumentNode`, optional `resolvers` grouped by root type, and optional
`subscriptionResolvers`. Resolvers receive `(source, args, context, info)`. Subscription
sources return async iterables whose values contain the subscribed field.

Modules use standard GraphQL `extend type` and `extend enum`. They may add types,
fields and enum values, but cannot replace a core field or change its arguments.
Schema construction fails on duplicate fields, duplicate resolver registrations,
or mutation/subscription fields without a resolver. Invalid modules therefore
fail during service construction rather than on a client's first request.

Mutation resolvers, including module fields and conditional nested actions, run
through the context's serial queue. Separate contexts do not block one another.
Subscription iterators remain outside that queue. Always release listeners and
other resources when an iterator receives `return()` or its context closes.

Services that need different top-level mutation failure handling can supply
`mutationResultPolicy(fieldName, result)` to `BrowserQL`. It receives the original
field name, even when the client aliases it. Returning `continue` preserves prior
partial results and executes later fields even after a non-null field error;
returning `stop` skips later fields. Returning `undefined` keeps the default
GraphQL non-null propagation. Errors remain in the response in every case. This
policy runs after a top-level field group completes; it does not cancel actions
already dispatched or change execution within a nested selection.

## Customize the browser API

Pass an `apiFactory` to construct a subclass of `BQLBrowserAPI`:

```ts
import { BQLBrowserAPI, BrowserQL } from '@browserless.io/browserless';

class PageAPI extends BQLBrowserAPI {
  protected override async beforeNavigate() {
    // Apply application-specific policy before navigation.
  }
}

const bql = new BrowserQL({
  apiFactory: (options) => new PageAPI(options),
});
```

The constructor options contain `browser`, `config`, `logger`, `req`, and
`blockConsentModals`. A context starts the API lazily and shares the in-flight
startup promise between callers. A failed startup must not expose a partially
initialized browser API. Transports close the context when their session ends.

| Extension point                    | Default behavior                                             |
| ---------------------------------- | ------------------------------------------------------------ |
| `onStart(mainCDP, browserCDP)`     | No additional startup work                                   |
| `beforeTargetSetup(cdp, kind)`     | No additional work before target domains are enabled         |
| `setupRuntime(cdp)`                | Enable the Runtime domain                                    |
| `onTargetAttached(cdp, kind)`      | No additional target setup                                   |
| `resolveSelector(selector)`        | Accept ordinary selectors; reject unsupported deep selectors |
| `inputDriver`                      | Plain CDP pointer and keyboard input                         |
| `beforeRequestRules(event, cdp)`   | No decision before configured request rules                  |
| `requestPipeline.use(handler)`     | Add request handling after navigation policy and core rules  |
| `beforeNavigate` / `afterNavigate` | No additional navigation work                                |
| `beforeReadback` / `beforeCapture` | No additional read or capture work                           |
| `fetchScript(url, timeout)`        | Fetch scripts with destination checks on every redirect      |
| `applyUserAgent(cdp, userAgent)`   | Ordinary CDP user-agent override                             |
| `onClose()`                        | No additional teardown work                                  |

Request handlers return a Fetch decision instead of independently sending
competing terminal commands. The dispatcher applies destination policy first,
then `beforeRequestRules`, reject rules, fulfill rules and additional handlers.
A handler must not bypass
the server's destination restrictions.

Keep runtime state on the API or context, not on the shared service or module.
Use the normal transport limits and authentication when adding routes. The
exported `handleBQLHTTP` and `BQLWebSocketSession` let custom route wrappers share
execution and cleanup rather than implementing another GraphQL transport.

`BQLWebSocketSessionOptions` supports response formatting and operation or invalid
frame observers. Formatting applies to GraphQL envelopes, not protocol control
frames. Invalid-frame observers cannot change the protocol outcome.
