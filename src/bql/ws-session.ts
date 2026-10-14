import type { ExecutionResult, FormattedExecutionResult } from 'graphql';
import { GraphQLError, getOperationAST, parse } from 'graphql';
import type { BrowserQL } from './browserql.js';
import type { Context } from './context.js';
import type { RawData } from 'ws';
import { WebSocket } from 'ws';

export const BQL_WEBSOCKET_PROTOCOL = 'graphql-transport-ws';

type Operation = { iterator?: AsyncIterator<ExecutionResult> };
type Service = Pick<
  BrowserQL,
  'execute' | 'subscribe' | 'version' | 'capabilities'
>;
type Payload = {
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
};

export interface BQLWebSocketSessionOptions {
  /** Format GraphQL envelopes without changing protocol control frames. */
  formatResponse?: (
    result: FormattedExecutionResult,
  ) => FormattedExecutionResult;
  /** Runs in queue order, immediately before an operation is dispatched. */
  onOperation?: (operation: {
    id: string;
    request: Payload;
    protocol: 'legacy' | typeof BQL_WEBSOCKET_PROTOCOL;
  }) => void;
  /** Invalid frame observations cannot override protocol handling. */
  onValidationError?: (error: {
    reason:
      | 'invalid_json'
      | 'missing_query'
      | 'invalid_subscribe'
      | 'unsupported_message';
    message: string;
    id?: string;
    operationName?: string;
  }) => void;
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const validPayload = (value: unknown): value is Payload =>
  object(value) &&
  typeof value.query === 'string' &&
  (value.variables == null || object(value.variables)) &&
  (value.operationName == null || typeof value.operationName === 'string') &&
  (value.extensions == null || object(value.extensions));

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : 'Internal server error';

/** Owns one socket's context, operation IDs and serial execution queue. */
export class BQLWebSocketSession {
  private operations = new Map<string, Operation>();
  private queue = Promise.resolve();
  private initialized = false;
  private closed = false;
  private running?: Promise<void>;
  private sequence = 0;

  constructor(
    private client: WebSocket,
    private bql: Service,
    private context: Context,
    private options: BQLWebSocketSessionOptions = {},
  ) {}

  run(): Promise<void> {
    return (this.running ??= new Promise<void>((resolve, reject) => {
      const browser = this.context.getBrowserInstance();
      let unsubscribe = () => {};
      const cleanup = () => {
        if (this.closed) return;
        this.closed = true;
        browser.off('close', onDisconnected);
        unsubscribe();
        this.client.off('message', onMessage);
        for (const id of this.operations.keys()) this.cancel(id);
        this.context.close().then(resolve, reject);
      };
      const onDisconnected = () => {
        this.client.close(1011, 'Browser session ended');
        cleanup();
      };
      const onMessage = (data: RawData) => {
        if (this.closed || this.client.readyState !== WebSocket.OPEN) return;
        if (this.client.protocol === BQL_WEBSOCKET_PROTOCOL) this.receive(data);
        else this.enqueue(() => this.legacy(data));
      };
      this.client.once('close', cleanup);
      this.client.once('error', () => {
        this.client.close(1011, 'WebSocket error');
        cleanup();
      });
      this.client.on('message', onMessage);
      browser.once('close', onDisconnected);
      unsubscribe = this.context.onDisconnected(onDisconnected);
      if (this.closed) unsubscribe();
      if (this.client.readyState !== WebSocket.OPEN) cleanup();
      else if (this.context.hasErrored()) onDisconnected();
    }));
  }

  private send(value: unknown): void {
    if (!this.closed && this.client.readyState === WebSocket.OPEN) {
      this.client.send(JSON.stringify(value));
    }
  }

  private format(result: FormattedExecutionResult): FormattedExecutionResult {
    return this.options.formatResponse?.(result) ?? result;
  }

  private invalid(
    error: Parameters<
      NonNullable<BQLWebSocketSessionOptions['onValidationError']>
    >[0],
  ): void {
    try {
      this.options.onValidationError?.(error);
    } catch {
      /* Observers cannot change protocol outcomes. */
    }
  }

  private enqueue(work: () => Promise<void>): void {
    this.queue = this.queue
      .then(async () => {
        if (!this.closed && this.client.readyState === WebSocket.OPEN)
          await work();
      })
      .catch(() => this.client.close(1011, 'Internal server error'));
  }

  private returnIterator(iterator?: AsyncIterator<ExecutionResult>): void {
    // Cancellation must not wait for a stream's pending next() to settle.
    Promise.resolve()
      .then(() => iterator?.return?.())
      .catch(() => {});
  }

  private cancel(id: string): void {
    const operation = this.operations.get(id);
    this.operations.delete(id);
    this.returnIterator(operation?.iterator);
  }

  private receive(data: RawData): void {
    let message: unknown;
    try {
      message = JSON.parse(data.toString());
    } catch {
      this.invalid({ reason: 'invalid_json', message: 'Invalid JSON message' });
      this.client.close(4400, 'Invalid JSON message');
      return;
    }
    if (!object(message)) {
      this.invalid({
        reason: 'unsupported_message',
        message: 'Invalid message',
      });
      this.client.close(4400, 'Invalid message');
      return;
    }
    const { type, id, payload } = message;
    switch (type) {
      case 'connection_init':
        if (payload != null && !object(payload)) {
          this.client.close(4400, 'Invalid connection_init');
          return;
        }
        if (this.initialized) {
          this.client.close(4429, 'Too many initialization requests');
          return;
        }
        this.initialized = true;
        this.send({
          type: 'connection_ack',
          payload: {
            version: this.bql.version,
            capabilities: this.bql.capabilities,
          },
        });
        return;
      case 'ping':
      case 'pong':
        if (payload != null && !object(payload)) {
          this.client.close(4400, 'Invalid ping/pong');
          return;
        }
        if (type === 'ping')
          this.send({
            type: 'pong',
            ...(payload === undefined ? {} : { payload }),
          });
        return;
      case 'complete':
        if (typeof id !== 'string' || !id) {
          this.client.close(4400, 'Invalid operation ID');
          return;
        }
        this.cancel(id);
        return;
      case 'subscribe': {
        if (!this.initialized) {
          this.client.close(4401, 'Unauthorized');
          return;
        }
        if (typeof id !== 'string' || !id || !validPayload(payload)) {
          this.invalid({
            reason: 'invalid_subscribe',
            message: 'Invalid subscribe message',
            id: typeof id === 'string' ? id : undefined,
            operationName:
              object(payload) && typeof payload.operationName === 'string'
                ? payload.operationName
                : undefined,
          });
          this.client.close(4400, 'Invalid subscribe message');
          return;
        }
        if (this.operations.has(id)) {
          this.client.close(4409, 'Subscriber already exists');
          return;
        }
        const operation: Operation = {};
        this.operations.set(id, operation);
        this.enqueue(() => this.execute(id, payload, operation));
        return;
      }
      default:
        this.invalid({
          reason: 'unsupported_message',
          message: 'Unsupported message type',
          id: typeof id === 'string' ? id : undefined,
        });
        this.client.close(4400, 'Unsupported message type');
    }
  }

  private active(id: string, operation: Operation): boolean {
    return !this.closed && this.operations.get(id) === operation;
  }

  private async execute(
    id: string,
    payload: Payload,
    operation: Operation,
  ): Promise<void> {
    if (!this.active(id, operation)) return;
    try {
      this.options.onOperation?.({
        id,
        request: payload,
        protocol: BQL_WEBSOCKET_PROTOCOL,
      });
      // Parsing here selects the transport path; schema validation remains in the service.
      const document = parse(payload.query);
      const subscription =
        getOperationAST(document, payload.operationName)?.operation ===
        'subscription';
      const result = await (subscription
        ? this.bql.subscribe(payload, this.context)
        : this.bql.execute(payload, this.context));
      if (Symbol.asyncIterator in result) {
        const iterator = result[Symbol.asyncIterator]();
        if (!this.active(id, operation)) {
          this.returnIterator(iterator);
          return;
        }
        operation.iterator = iterator;
        void this.stream(id, operation, iterator).catch(() =>
          this.client.close(1011, 'Internal server error'),
        );
      } else if (this.active(id, operation)) {
        if (result.errors && !('data' in result))
          this.send({ id, type: 'error', payload: this.format(result).errors });
        else {
          this.send({ id, type: 'next', payload: this.format(result) });
          this.send({ id, type: 'complete' });
        }
        this.operations.delete(id);
        if (this.context.hasErrored())
          this.client.close(1011, 'Browser session ended');
      }
    } catch (error) {
      this.fail(id, operation, error);
    }
  }

  private fail(id: string, operation: Operation, error: unknown): void {
    if (!this.active(id, operation)) return;
    this.operations.delete(id);
    this.returnIterator(operation.iterator);
    this.send({
      id,
      type: 'error',
      payload: this.format({
        errors: [
          error instanceof GraphQLError ? error : { message: messageOf(error) },
        ],
      }).errors,
    });
    if (this.context.hasErrored())
      this.client.close(1011, 'Browser session ended');
  }

  private async stream(
    id: string,
    operation: Operation,
    iterator: AsyncIterator<ExecutionResult>,
  ): Promise<void> {
    try {
      while (this.active(id, operation)) {
        const value = await iterator.next();
        if (!this.active(id, operation)) return;
        if (value.done) {
          this.operations.delete(id);
          this.send({ id, type: 'complete' });
          return;
        }
        this.send({ id, type: 'next', payload: this.format(value.value) });
      }
    } catch (error) {
      this.fail(id, operation, error);
    }
  }

  private async legacy(data: RawData): Promise<void> {
    let body: unknown;
    try {
      body = JSON.parse(data.toString());
    } catch {
      this.invalid({ reason: 'invalid_json', message: 'Invalid JSON message' });
      this.send(this.format({ errors: [{ message: 'Invalid JSON message' }] }));
      return;
    }
    if (!validPayload(body)) {
      const message =
        !object(body) || !body.query
          ? 'Missing required "query" field'
          : 'Invalid GraphQL request body';
      this.invalid({
        reason: 'missing_query',
        message,
        operationName:
          object(body) && typeof body.operationName === 'string'
            ? body.operationName
            : undefined,
      });
      this.send(
        this.format({
          errors: [
            {
              message,
            },
          ],
        }),
      );
      return;
    }
    try {
      this.options.onOperation?.({
        id: `legacy-${++this.sequence}`,
        request: body,
        protocol: 'legacy',
      });
      this.send(this.format(await this.bql.execute(body, this.context)));
      if (this.context.hasErrored())
        this.client.close(1011, 'Browser session ended');
    } catch (error) {
      this.send(
        this.format({
          errors: [
            {
              message: this.context.hasErrored()
                ? 'Browser session has ended unexpectedly'
                : messageOf(error),
            },
          ],
        }),
      );
      if (this.context.hasErrored())
        this.client.close(1011, 'Browser session ended');
    }
  }
}
