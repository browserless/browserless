// TypeScript types for the session replay player

export interface ReplayMetadata {
  id: string;
  browserType: string;
  duration: number;
  startedAt: number;
  endedAt: number;
  eventCount: number;
  routePath: string;
  trackingId?: string;
  userAgent?: string;
}

export interface ReplayEvent {
  type: number;
  timestamp: number;
  data: unknown;
}

export interface Replay {
  events: ReplayEvent[];
  metadata: ReplayMetadata;
}

// Network event types
export interface NetworkRequestPayload {
  id: string;
  url: string;
  method: string;
  type: string;
  timestamp: number;
  requestHeaders?: Record<string, string>;
  requestBody?: string;
}

export interface NetworkResponsePayload {
  id: string;
  url: string;
  method: string;
  status: number;
  statusText: string;
  duration: number;
  type: string;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
}

export interface NetworkErrorPayload {
  id: string;
  url: string;
  method: string;
  error: string;
  duration: number;
  type: string;
}

export interface NetworkItem {
  id: string;
  timestamp: number;
  type: 'network';
  request?: NetworkRequestPayload;
  response?: NetworkResponsePayload;
  error?: NetworkErrorPayload;
}

// Console event types
export interface ConsolePayload {
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  trace: string[];
}

export interface ConsoleItem {
  timestamp: number;
  type: 'console';
  level: string;
  message: string;
  trace: string[];
  count?: number;
  source?: string;
}

// Marker event types
export interface MarkerPayload {
  [key: string]: unknown;
}

export interface MarkerItem {
  timestamp: number;
  type: 'marker';
  tag: string;
  payload: MarkerPayload;
}

// Union type for all inspector items
export type InspectorItem = NetworkItem | ConsoleItem | MarkerItem;

// Filter types
export interface InspectorFilters {
  network: boolean;
  console: boolean;
  markers: boolean;
  cloudflare: boolean;
  levels: {
    log: boolean;
    info: boolean;
    warn: boolean;
    error: boolean;
    debug: boolean;
  };
}

// Player options
export interface PlayerOptions {
  events: ReplayEvent[];
  metadata: ReplayMetadata;
  width?: number;
  height?: number;
  autoPlay?: boolean;
  speed?: number;
  speedOption?: number[];
  showController?: boolean;
  skipInactive?: boolean;
  tags?: Record<string, string>;
  inactiveColor?: string;
}
