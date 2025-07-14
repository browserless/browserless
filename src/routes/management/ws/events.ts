import {
  APITags,
  BrowserManager,
  BrowserlessRoutes,
  Logger,
  Request,
  SystemQueryParameters,
  WebSocketRoute,
  WebsocketRoutes,
  dedent,
} from '@browserless.io/browserless';
import { Duplex } from 'stream';

export interface QuerySchema extends SystemQueryParameters {
  token?: string;
}

export interface TargetCreatedEvent {
  type: 'targetCreated';
  timestamp: number;
  data: {
    id: string;
    url: string;
    title: string;
    createdAt: number;
    createdBy: string;
    sessionId: string;
    webSocketDebuggerUrl: string;
  };
}

export type EventMessage = TargetCreatedEvent;

export default class EventsWebSocketRoute extends WebSocketRoute {
  name = BrowserlessRoutes.EventsWebSocketRoute;
  auth = true;
  browser = null;
  concurrency = false;
  description = dedent(
    `Connect to a real-time stream of browser events, including new tab/page creation
    from target="_blank" links. Useful for monitoring and reacting to browser state changes
    in headless automation workflows.`,
  );
  path = WebsocketRoutes.events;
  tags = [APITags.management];
  
  private browserManagerInstance: BrowserManager | null = null;
  
  setBrowserManager(browserManager: BrowserManager) {
    this.browserManagerInstance = browserManager;
  }

  async handler(
    _req: Request,
    socket: Duplex,
    _head: Buffer,
    logger: Logger,
  ): Promise<void> {
    logger.trace('Events WebSocket connection established');
    
    if (!this.browserManagerInstance) {
      logger.error('BrowserManager not available');
      socket.end();
      return;
    }
    
    const browserManager = this.browserManagerInstance;
    
    const welcomeMessage = {
      type: 'connected',
      timestamp: Date.now(),
      message: 'Events stream connected successfully'
    };
    
    socket.write(JSON.stringify(welcomeMessage) + '\n');
    
    const onTargetCreated = (eventData: TargetCreatedEvent['data']) => {
      const event: TargetCreatedEvent = {
        type: 'targetCreated',
        timestamp: Date.now(),
        data: eventData
      };
      
      logger.trace(`Sending targetCreated event: ${eventData.id}`);
      socket.write(JSON.stringify(event) + '\n');
    };
    
    browserManager.on('targetCreated', onTargetCreated);
    
    socket.on('close', () => {
      logger.trace('Events WebSocket connection closed');
      browserManager.removeListener('targetCreated', onTargetCreated);
    });
    
    socket.on('error', (error) => {
      logger.error(`Events WebSocket error: ${error}`);
      browserManager.removeListener('targetCreated', onTargetCreated);
    });
  }
}
