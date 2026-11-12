# BrowserQL

BrowserQL runs GraphQL operations against a browser. A mutation executes browser
actions in document order and returns only the fields you select.

## Endpoints and authentication

| Browser  | HTTP                 | WebSocket       |
| -------- | -------------------- | --------------- |
| Chromium | `POST /chromium/bql` | `/chromium/bql` |
| Chrome   | `POST /chrome/bql`   | `/chrome/bql`   |
| Edge     | `POST /edge/bql`     | `/edge/bql`     |

The corresponding browser must be installed in the running image. These routes
use the same token authentication, launch configuration, concurrency limits and
session timeout as other browser routes. Add `?token=YOUR_TOKEN` when the server
has `TOKEN` configured. Use HTTPS and WSS outside a trusted local network.
The generated `/docs` reference lists the supported query parameters.

## HTTP

Send JSON containing `query`, with optional `variables` and `operationName`:

```sh
curl 'http://localhost:3000/chromium/bql?token=YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  --data '{"query":"mutation { goto(url: \"https://example.com\") { status } title { title } }"}'
```

Each request owns one browser context, which is closed after the result is sent.
Inspect both the HTTP status and the GraphQL `errors` array; a successfully
delivered GraphQL response is not necessarily a successful operation.
Subscriptions require the WebSocket transport.

The `X-BQL-Capabilities` response header advertises the configured capabilities.
You can also query them with GraphQL:

```graphql
query {
  version
  browser
  capabilities
}
```

The default capability is `core`. Additional modules contribute their names.
Unknown fields fail GraphQL validation before their resolvers execute.

## WebSocket: graphql-transport-ws

Request the `graphql-transport-ws` subprotocol. Initialize the connection before
sending operations, and assign a unique ID to each active operation:

```js
import WebSocket from 'ws';

const socket = new WebSocket(
  'ws://localhost:3000/chromium/bql?token=YOUR_TOKEN',
  'graphql-transport-ws',
);

socket.on('open', () => {
  socket.send(JSON.stringify({ type: 'connection_init' }));
});

socket.on('message', (data) => {
  const message = JSON.parse(data.toString());
  if (message.type === 'connection_ack') {
    console.log(message.payload.version, message.payload.capabilities);
    socket.send(
      JSON.stringify({
        id: 'page',
        type: 'subscribe',
        payload: {
          query:
            'mutation { goto(url: "https://example.com") { status } title { title } }',
        },
      }),
    );
  } else if (message.type === 'next') {
    console.log(message.payload);
  } else if (message.type === 'error') {
    console.error(message.payload);
  } else if (message.type === 'complete' && message.id === 'page') {
    socket.close();
  }
});
```

Queries and mutations use `subscribe` too: expect `next`, then `complete`.
Validation failures produce `error`. A client can send `complete` with an active
operation ID to cancel it. An ID can be reused after that operation ends.
Application-level `ping` messages receive `pong`; this is distinct from the
WebSocket protocol's control frames.

One socket owns one context. Ordinary operations run serially on that context;
long-lived subscriptions do not occupy that queue. This lets you subscribe to
network or console events before navigating:

```json
{"id":"console","type":"subscribe","payload":{"query":"subscription { console { type text } }"}}
{"id":"navigate","type":"subscribe","payload":{"query":"mutation { goto(url: \"https://example.com\") { status } }"}}
```

The core subscription fields are `console`, `request`, and `response`. Select only
the event fields you need. Cancel streams you no longer consume:

```json
{ "id": "console", "type": "complete" }
```

## WebSocket: legacy JSON mode

Without the subprotocol, send a JSON GraphQL request directly:

```json
{
  "query": "mutation { goto(url: \"https://example.com\") { status } title { title } }"
}
```

The server returns a JSON GraphQL result. Further requests use the same context
until the socket closes or its session deadline expires. Legacy mode does not
use connection initialization or operation IDs; use `graphql-transport-ws` for
subscriptions and per-operation cancellation.

## Exporting results within an operation

The `@export` directive makes an earlier result available to later fields in the
same operation. Reference the exported value inside a later string argument:

```graphql
mutation {
  evaluate(content: "'https://example.com'") {
    value @export(as: "destination")
  }
  goto(url: "${destination}") {
    status
  }
}
```

Exports are operation-local. They do not become variables for later requests on
the same socket. An export that fails must not be mistaken for a successful
value; inspect returned errors before relying on the result.

## Limits, errors and selectors

The server's session deadline bounds the connection, including queued work and
subscriptions. Individual operations also accept their documented timeouts;
`preferences(timeout: ...)` changes the browser action default, not the server's
session deadline. Closing a connection cancels its streams and releases its
context. Do not assume closing a connection can undo a browser action already
dispatched.

Scripts downloaded by `evaluate(url: ...)` are limited to 10 MiB of decoded
response bytes. This limit applies even when the response has no Content-Length.
Downloads use the current page's browser network stack, including session proxy,
cookies, headers and request rules. The page's CORS and CSP restrictions apply;
there is no server-side fallback. Use `content` for scripts that cannot be fetched
under those restrictions. Structured evaluation results are JSON-encoded in the
response's `value` string; strings are returned unchanged.

Network `regex` filters and readback `clean.regexes` use RE2 syntax with Unicode support and linear-time
matching. Each pattern is limited to 200 characters. Lookaround and
backreferences are unsupported; invalid or unsupported patterns fail when the
filter is registered. This also applies to SDK `request` and `response` filters.
Cleanup replacements are case-insensitive. URL and title patterns use only `*`
(any sequence) and `?` (one character), with all other characters treated literally
and a 200-character limit. Shell extglobs, brace expansion and character classes
are not supported. The GraphQL `reject` and `fulfill` fields and SDK network
filters offer `regex` as an alternative; other GraphQL URL/title filters do not.

Readback cleanup does not modify the live page. HTML cleanup and URL rewriting
use an inert document. Cleaned text excludes selected and hidden elements while
retaining block and line-break separators. Explicit waits accept durations from
0 through 2147483647 ms; larger values are rejected rather than overflowing timers.
WebSocket subscription events pause while more than 16 MiB is queued. If the
buffer does not drain below that threshold within five seconds, the connection
closes with code `1013`. This grace period lets large query/mutation responses
flush without immediately terminating concurrent subscriptions.

CSS selectors support shadow roots. Deep selectors beginning with `<` are not
supported. `userAgent` applies an ordinary browser user-agent override. Window
selection uses page targets; switching windows does not reset the session's
server deadline. `switchToWindow(waitUntil: ...)` waits for the selected page's
current document to reach that milestone; `waitForNavigation` waits for a future
navigation. A window-switch timeout leaves the previous target selected.

Protocol close codes include:

| Code   | Meaning                                                            |
| ------ | ------------------------------------------------------------------ |
| `4400` | Malformed or invalid protocol message                              |
| `4401` | Operation sent before initialization in graphql-transport-ws mode  |
| `4409` | Duplicate active operation ID                                      |
| `4429` | Repeated connection initialization                                 |
| `1011` | Internal session failure, including loss of the browser connection |

For schema modules, custom API implementations and application injection, see
[Extending BrowserQL](bql-extensions.md).
