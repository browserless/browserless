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

Each request owns one browser context. The browser can be released as soon as
the result starts sending. A blocked HTTP write has 30 seconds to progress;
the entire transfer, including the final flush, has a five-minute deadline.
If delivery times out after headers are sent, the connection closes without a
second response. Treat an incomplete JSON body as a failed download.
Inspect both the HTTP status and the GraphQL `errors` array; a successfully
delivered GraphQL response is not necessarily a successful operation.
Subscriptions require the WebSocket transport.

For click-triggered navigation, use `click(selector: "a", waitUntil: load) {
navigation { status url } }`. Monitoring starts before the press, and `timeout`
covers finding the element and waiting for navigation together. A click that
does not navigate fails when that timeout expires. Same-document changes such
as a hash update are not detected. Omit `waitUntil` or pass `null` for a plain
click; its `navigation` result is `null`.

The same limitation applies to `goto`, `back`, `forward`, and
`waitForNavigation`: hash or `pushState` changes alone do not satisfy a
navigation wait. The field returns `null` with a `Navigation timed out` error
when its timeout expires.

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

WebSocket messages obey `MAX_PAYLOAD_SIZE` (10 MiB by default); oversized
messages close the connection with code `1009` before GraphQL dispatch.

HTTP results can be streamed without a `Content-Length` header. Read the
response to completion rather than using that header to determine its size.

Response-body capture uses decoded network size events to exclude bodies above
20,000,000 bytes. Their metadata remains available with `body: null`. Base64
expansion does not count toward that per-response limit. The retained body cache
is separately bounded to 10 MiB; bodies that do not fit can still be read on
demand, subject to browser availability.

Fallback body reads run one at a time per browser API instance, including across
concurrent SDK calls. A timed-out read retains its slot until CDP settles. This
bounds concurrent fallback reads, not total response bytes or browser/worker
memory: one query can return many large bodies. With `wait: true`, matching and
body reads share the requested timeout; with `wait: false`, each body read gets
the API's default timeout, so sequential reads can take longer overall. The
server's session deadline still applies.

`querySelector` and `querySelectorAll` include hidden elements by default.
With `visible: true`, they filter matches before selecting or serializing them:
elements need a nonzero bounding rectangle and must pass CSS visibility and
opacity checks. This does not require being inside the viewport or unobscured
by other elements, and it does not wait for an element to become visible.
If no matches remain, the result is `null`.

Scripts downloaded by `evaluate(url: ...)` are limited to 10 MiB of decoded
response bytes. This limit applies even when the response has no Content-Length.
Downloads use the current page's browser network stack, including session proxy,
cookies, headers and request rules. The page's CORS and CSP restrictions apply;
there is no server-side fallback. Use `content` for scripts that cannot be fetched
under those restrictions. Structured evaluation results are JSON-encoded in the
response's `value` string; strings are returned unchanged.

Network `regex` filters use RE2 when possible. Valid JavaScript-only expressions
(including lookaround and backreferences) run in a worker. Intercepted requests
share one second across all fallback evaluations, including queue time. If a rule
cannot be decided within that budget or the queue is full, Browserless fails the
request rather than sending it upstream. SDK `request` and `response` history
filters treat unavailable evaluations as no match. A matcher that times out
during execution retries new matches after a one-second cooldown. Invalid
expressions fail when registered. Patterns are limited to 200 characters, and
fallback inputs to 65,536 UTF-16 code units. Readback `clean.regexes` remains
RE2-only and case-insensitive.

SDK history queries with `wait: true` return any confirmed, still-current
matches at the deadline. With `wait: false`, a JavaScript fallback filter scans
only records already present when the call starts, up to the session timeout.
RE2-only filters retain the existing 100 ms window for arriving records.

URL and title globs are compiled to
RE2 with a 200-character limit. Common `*`/`?` wildcards, brace alternatives,
character classes (such as `[0-9]`) and leading negation are supported.
Leading and trailing globstars work in URL patterns such as `**/posts/**`,
`**/*.png` and `https://example.com/**`. A leading `**/` can match zero
directories, and a trailing `/**` can match the prefix without a slash.
Micromatch collapses adjacent globstars: `**/**/posts` behaves like `**/posts`.
Dot handling follows bash-style micromatch, not a blanket hidden-path filter:
`**/*.png` matches `assets/.icons/a.png` but not `.icons/a.png`.
Other supported examples include `*/*`, `*/*.png`, `*/*.js`, `cdn.*`,
`example.com*`, `www.example.com*`, `*.*`, `Slow *opup`, `Order * confirmed`
and `a*b*c`.
Patterns requiring unsupported assertions (including bare `**`, `a/**/b`, negative extglobs
and some grouped stars such as `http://example.test/{a,lib/*}.js`), invalid
character ranges, quoted/escaped patterns and `./` normalization return an
explicit input error rather than silently matching literally. Globs preserve
legacy UTF-16 code-unit matching, including emoji and lone surrogates. Patterns
and values containing private-use characters U+E000–U+E7FF are rejected because
that range is reserved internally for surrogate encoding. Nonliteral matches
against values containing line terminators also return an explicit input error.
Window switching examines targets in order and continues polling when no title
or URL matches. An unsupported pattern or value stops that poll's ordered search,
not the wait: later polls may find a match before reaching the unsupported target.
At timeout, an input error is thrown only if the final poll's ordered search failed.
If that search completed normally without a match, an ordinary timeout result is
returned instead; historical input errors are discarded. Targets are never silently
skipped. Selecting by `targetId` takes precedence over patterns.
The GraphQL `reject` and `fulfill` fields and SDK network
filters offer `regex` as an alternative; other GraphQL URL/title filters do not.
`fulfill(base64Body: ...)` accepts standard base64 with or without trailing
padding. Do not include whitespace or line breaks.

Readback cleanup does not modify the live page. HTML cleanup and URL rewriting
use an inert document. Cleaned text excludes selected and hidden elements while
retaining block and line-break separators. Explicit waits accept durations from
0 through 2147483647 ms; larger values are rejected rather than overflowing timers.
WebSocket subscription events pause while more than 16 MiB is queued. If the
buffer does not drain below that threshold within five seconds, the connection
closes with code `1013`. Independently, a fragment write that makes no progress
for 15 seconds terminates the socket and releases the session. A blocked socket
may not receive a close frame. This deadline resets after each successful write;
it is not a time limit on the whole message.

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
