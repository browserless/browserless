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
same operation. Declare a variable of the type expected by its consumer:

```graphql
mutation ($destination: String!) {
  evaluate(content: "'https://example.com'") {
    value @export(as: "destination")
  }
  goto(url: $destination) {
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

CSS selectors support shadow roots. Deep selectors beginning with `<` are not
supported. `userAgent` applies an ordinary browser user-agent override. Window
selection uses page targets; switching windows does not reset the session's
server deadline.

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
