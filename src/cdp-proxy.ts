import WebSocket from 'ws';
import { Duplex } from 'stream';
import { IncomingMessage } from 'http';
import { Logger } from '@browserless.io/browserless';

/**
 * Replay metadata sent via CDP event.
 */
export interface ReplayCompleteParams {
  id: string;
  trackingId: string;
  duration: number;
  eventCount: number;
  frameCount: number;
  encodingStatus: string;
  playerUrl: string;
  videoPlayerUrl?: string;
}

/**
 * CDP-aware WebSocket proxy that can inject custom events.
 *
 * Unlike http-proxy which creates an opaque tunnel, CDPProxy:
 * 1. Transparently forwards all CDP messages between client and browser
 * 2. Can inject custom CDP events to the client before closing
 * 3. Handles the WebSocket upgrade from the HTTP socket
 *
 * This enables sending replay metadata to clients (like Pydoll)
 * without requiring an additional HTTP call after session close.
 *
 * Flow:
 *   Client <-> CDPProxy <-> Chrome
 *              (can inject events)
 */
export class CDPProxy {
  private clientWs: WebSocket | null = null;
  private browserWs: WebSocket | null = null;
  private isClosing = false;
  private log = new Logger('cdp-proxy');

  constructor(
    private clientSocket: Duplex,
    private clientHead: Buffer,
    private clientRequest: IncomingMessage,
    private browserWsEndpoint: string,
    private onClose?: () => void,
  ) {}

  /**
   * Connect to browser and establish bidirectional proxy.
   *
   * CRITICAL: Connect to Chrome FIRST, then upgrade client socket.
   * This ensures no messages are dropped during the connection race.
   */
  async connect(): Promise<void> {
    // Step 1: Connect to Chrome's CDP endpoint FIRST
    await new Promise<void>((resolve, reject) => {
      this.browserWs = new WebSocket(this.browserWsEndpoint);

      this.browserWs.on('open', () => {
        this.log.trace(`Connected to browser: ${this.browserWsEndpoint}`);
        resolve();
      });

      this.browserWs.on('error', (err) => {
        this.log.error(`Browser WebSocket error: ${err.message}`);
        reject(err);
      });
    });

    // Step 2: Now upgrade the client socket (Chrome is ready to receive)
    return new Promise((resolve, reject) => {
      const wss = new WebSocket.Server({ noServer: true });

      wss.handleUpgrade(
        this.clientRequest,
        this.clientSocket,
        this.clientHead,
        (clientWs) => {
          this.clientWs = clientWs;
          this.log.trace('Client WebSocket upgraded');

          // Set up bidirectional proxying
          this.setupProxy();

          clientWs.on('error', (err) => {
            this.log.warn(`Client WebSocket error: ${err.message}`);
            this.handleClose();
          });

          resolve();
        },
      );

      // Handle upgrade failure
      this.clientSocket.on('error', (err) => {
        this.log.error(`Client socket error during upgrade: ${err.message}`);
        this.handleClose();
        reject(err);
      });
    });
  }

  /**
   * Set up bidirectional message forwarding.
   */
  private setupProxy(): void {
    if (!this.clientWs || !this.browserWs) return;

    // Forward client messages to browser
    this.clientWs.on('message', (data, isBinary) => {
      if (this.browserWs?.readyState === WebSocket.OPEN) {
        this.browserWs.send(data, { binary: isBinary });
      }
    });

    // Forward browser messages to client
    this.browserWs.on('message', (data, isBinary) => {
      if (this.clientWs?.readyState === WebSocket.OPEN) {
        this.clientWs.send(data, { binary: isBinary });
      }
    });

    // Handle close from either side
    this.clientWs.on('close', () => {
      this.log.trace('Client WebSocket closed');
      this.handleClose();
    });

    this.browserWs.on('close', () => {
      this.log.trace('Browser WebSocket closed');
      this.handleClose();
    });
  }

  /**
   * Inject a custom CDP event to the client.
   *
   * CDP events are JSON messages with "method" and "params" fields.
   * We use a custom method name "Browserless.replayComplete" that
   * clients (Pydoll) can listen for.
   */
  async emitClientEvent(method: string, params: object): Promise<void> {
    if (this.clientWs?.readyState === WebSocket.OPEN) {
      const message = JSON.stringify({ method, params });
      // Await the send to ensure message is queued before returning
      await new Promise<void>((resolve, reject) => {
        this.clientWs!.send(message, (err) => {
          if (err) {
            this.log.warn(`Failed to inject CDP event ${method}: ${err.message}`);
            reject(err);
          } else {
            this.log.trace(`Injected CDP event: ${method}`);
            resolve();
          }
        });
      });
    } else {
      this.log.warn(`Cannot inject event ${method}: client WebSocket not open`);
    }
  }

  /**
   * Send replay metadata to client before closing.
   *
   * This is the key method that enables zero-delay replay URL delivery.
   * Called by SessionLifecycleManager after stopReplay() returns metadata.
   */
  async sendReplayComplete(metadata: ReplayCompleteParams): Promise<void> {
    await this.emitClientEvent('Browserless.replayComplete', metadata);
    this.log.info(`Sent replay complete event: ${metadata.id}`);
  }

  /**
   * Close both WebSocket connections.
   */
  private handleClose(): void {
    if (this.isClosing) return;
    this.isClosing = true;

    // Close client WebSocket
    if (this.clientWs?.readyState === WebSocket.OPEN) {
      this.clientWs.close();
    }
    this.clientWs = null;

    // Close browser WebSocket
    if (this.browserWs?.readyState === WebSocket.OPEN) {
      this.browserWs.close();
    }
    this.browserWs = null;

    this.onClose?.();
  }

  /**
   * Gracefully close the proxy.
   */
  async close(): Promise<void> {
    this.handleClose();
  }

  /**
   * Check if the proxy is still connected.
   */
  isConnected(): boolean {
    return (
      !this.isClosing &&
      this.clientWs?.readyState === WebSocket.OPEN &&
      this.browserWs?.readyState === WebSocket.OPEN
    );
  }
}
