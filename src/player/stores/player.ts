import { writable, derived, type Writable, type Readable } from 'svelte/store';
import { EventType } from '@divmode/rrweb-types';
import { PLUGIN_NAME } from '@divmode/rrweb-plugin-console-record';
import type {
  ReplayEvent,
  RecordingMetadata,
  InspectorItem,
  NetworkItem,
  ConsoleItem,
  MarkerItem,
  InspectorFilters,
  NetworkRequestPayload,
  NetworkResponsePayload,
  NetworkErrorPayload,
} from '../types';

// Core state stores
export const events: Writable<ReplayEvent[]> = writable([]);
export const metadata: Writable<RecordingMetadata | null> = writable(null);
export const currentTime: Writable<number> = writable(0);
export const playing: Writable<boolean> = writable(false);
export const expandedItems: Writable<Set<string>> = writable(new Set());
export const syncScrollPaused: Writable<boolean> = writable(false);
export const searchQuery: Writable<string> = writable('');

// Filter state
export const filters: Writable<InspectorFilters> = writable({
  network: true,
  console: true,
  markers: true,
  levels: {
    log: true,
    info: true,
    warn: true,
    error: true,
    debug: true,
  },
});

// =============================================================================
// Type Guards - Runtime validation for event data
// =============================================================================

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number';
}

// Custom event data (EventType.Custom = 5) with tag
interface CustomEventData {
  tag: string;
  payload?: unknown;
}

function isCustomEventData(data: unknown): data is CustomEventData {
  return isRecord(data) && isString(data.tag);
}

// Network event payloads
interface NetworkPayloadBase {
  id: string;
  url: string;
  method: string;
  type: 'fetch' | 'xhr';
}

function isNetworkPayloadBase(payload: unknown): payload is NetworkPayloadBase {
  return (
    isRecord(payload) &&
    isString(payload.id) &&
    isString(payload.url) &&
    isString(payload.method) &&
    (payload.type === 'fetch' || payload.type === 'xhr')
  );
}

function isNetworkRequestPayload(payload: unknown): payload is NetworkRequestPayload {
  // Check record first to safely access properties, then validate base
  if (!isRecord(payload)) return false;
  if (!isNumber(payload.timestamp)) return false;
  return isNetworkPayloadBase(payload);
}

function isNetworkResponsePayload(payload: unknown): payload is NetworkResponsePayload {
  // Check record first to safely access properties, then validate base
  if (!isRecord(payload)) return false;
  if (!isNumber(payload.status)) return false;
  if (!isNumber(payload.duration)) return false;
  return isNetworkPayloadBase(payload);
}

function isNetworkErrorPayload(payload: unknown): payload is NetworkErrorPayload {
  // Check record first to safely access properties, then validate base
  if (!isRecord(payload)) return false;
  if (!isString(payload.error)) return false;
  if (!isNumber(payload.duration)) return false;
  return isNetworkPayloadBase(payload);
}

// Console plugin data (type 6) - uses PLUGIN_NAME from @divmode/rrweb-plugin-console-record
// rrweb wraps plugin data as: { plugin: string, payload: T }
// For console plugin, T = { level, trace, payload }
interface ConsolePluginData {
  plugin: typeof PLUGIN_NAME;
  payload: {
    level?: string;
    trace?: unknown[];
    payload?: unknown;
  };
}

function isConsolePluginData(data: unknown): data is ConsolePluginData {
  return isRecord(data) && data.plugin === PLUGIN_NAME && isRecord(data.payload);
}

// =============================================================================
// Helper Functions
// =============================================================================

function stringifyPayload(payload: unknown): string {
  if (payload == null) return '';
  if (isString(payload)) return payload;
  if (Array.isArray(payload)) {
    return payload.map((p) => (isString(p) ? p : JSON.stringify(p))).join(' ');
  }
  return JSON.stringify(payload);
}

function extractStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isString);
}

// =============================================================================
// Derived Stores
// =============================================================================

// Parse network events into NetworkItem objects
export const networkItems: Readable<NetworkItem[]> = derived(events, ($events) => {
  const requestMap = new Map<string, NetworkItem>();

  for (const e of $events) {
    // Custom events (EventType.Custom = 5)
    if (e.type !== EventType.Custom) continue;

    if (!isCustomEventData(e.data)) continue;
    if (!e.data.tag.startsWith('network.')) continue;

    const payload = e.data.payload;
    if (!isRecord(payload) || !isString(payload.id)) continue;

    const id = payload.id;

    if (!requestMap.has(id)) {
      requestMap.set(id, {
        id,
        timestamp: e.timestamp,
        type: 'network',
      });
    }

    const entry = requestMap.get(id);
    if (!entry) continue;

    if (e.data.tag === 'network.request' && isNetworkRequestPayload(payload)) {
      entry.request = payload;
    } else if (e.data.tag === 'network.response' && isNetworkResponsePayload(payload)) {
      entry.response = payload;
    } else if (e.data.tag === 'network.error' && isNetworkErrorPayload(payload)) {
      entry.error = payload;
    }
  }

  return Array.from(requestMap.values()).sort((a, b) => a.timestamp - b.timestamp);
});

// Parse console events into ConsoleItem objects
export const consoleItems: Readable<ConsoleItem[]> = derived(events, ($events) => {
  const items: ConsoleItem[] = [];

  for (const e of $events) {
    // Plugin events (EventType.Plugin = 6)
    if (e.type !== EventType.Plugin) continue;

    if (!isConsolePluginData(e.data)) continue;

    const inner = e.data.payload;
    const level = isString(inner.level) ? inner.level : 'log';
    const message = stringifyPayload(inner.payload).slice(0, 500);
    const trace = extractStringArray(inner.trace);

    items.push({
      timestamp: e.timestamp,
      type: 'console',
      level,
      message,
      trace,
    });
  }

  return items;
});

// Parse marker events (custom events that are not network)
export const markerItems: Readable<MarkerItem[]> = derived(events, ($events) => {
  const items: MarkerItem[] = [];

  for (const e of $events) {
    // Custom events (EventType.Custom = 5)
    if (e.type !== EventType.Custom) continue;

    if (!isCustomEventData(e.data)) continue;
    if (e.data.tag.startsWith('network.')) continue;

    const payload = isRecord(e.data.payload) ? e.data.payload : {};

    items.push({
      timestamp: e.timestamp,
      type: 'marker',
      tag: e.data.tag,
      payload,
    });
  }

  return items;
});

// Combined and filtered items for the inspector list
export const filteredItems: Readable<InspectorItem[]> = derived(
  [networkItems, consoleItems, markerItems, filters, searchQuery],
  ([$networkItems, $consoleItems, $markerItems, $filters, $searchQuery]) => {
    const items: InspectorItem[] = [];
    const query = $searchQuery.toLowerCase();

    if ($filters.network) {
      for (const item of $networkItems) {
        if (query) {
          const url = item.request?.url || item.response?.url || '';
          if (!url.toLowerCase().includes(query)) continue;
        }
        items.push(item);
      }
    }

    if ($filters.console) {
      for (const item of $consoleItems) {
        // Filter by level - only skip if explicitly set to false (allows unknown levels through)
        const levelKey = item.level as keyof typeof $filters.levels;
        if (levelKey in $filters.levels && $filters.levels[levelKey] === false) continue;
        // Filter by search query
        if (query && !item.message.toLowerCase().includes(query)) continue;
        items.push(item);
      }
    }

    if ($filters.markers) {
      for (const item of $markerItems) {
        if (query && !item.tag.toLowerCase().includes(query)) continue;
        items.push(item);
      }
    }

    // Sort by timestamp
    return items.sort((a, b) => a.timestamp - b.timestamp);
  }
);

// Throttled currentTime for inspector (10Hz instead of 60Hz)
// Prevents cascading updates to all components on every frame
let lastThrottledTime = 0;
let lastThrottledValue = 0;
export const throttledCurrentTime: Readable<number> = derived(
  currentTime,
  ($currentTime, set) => {
    const now = Date.now();
    if (now - lastThrottledTime >= 100) {
      lastThrottledTime = now;
      lastThrottledValue = $currentTime;
      set($currentTime);
    } else {
      // Still set the last known value on first subscribe
      set(lastThrottledValue);
    }
  },
  0
);

// Find the index of the item closest to current playback time
// Uses binary search O(log n) instead of linear search O(n)
export const playbackIndicatorIndex: Readable<number> = derived(
  [filteredItems, throttledCurrentTime, metadata],
  ([$filteredItems, $throttledCurrentTime, $metadata]) => {
    if (!$metadata || $filteredItems.length === 0) return -1;

    const absoluteTime = $metadata.startedAt + $throttledCurrentTime;

    // Binary search for the largest timestamp <= absoluteTime
    let left = 0;
    let right = $filteredItems.length - 1;
    let result = 0;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      if ($filteredItems[mid].timestamp <= absoluteTime) {
        result = mid;
        left = mid + 1;
      } else {
        right = mid - 1;
      }
    }

    return result;
  }
);

// Current scrape phase based on phase.start markers
export const currentPhase: Readable<string | null> = derived(
  [markerItems, currentTime, metadata],
  ([$markerItems, $currentTime, $metadata]) => {
    if (!$metadata) return null;

    const absoluteTime = $metadata.startedAt + $currentTime;

    // Find all phase.start markers that occurred before current time
    const phaseMarkers = $markerItems
      .filter((m) => m.tag === 'phase.start')
      .filter((m) => m.timestamp <= absoluteTime);

    // Return the most recent phase
    const latest = phaseMarkers[phaseMarkers.length - 1];
    if (!latest) return null;

    const phase = latest.payload.phase;
    return isString(phase) ? phase : null;
  }
);

// =============================================================================
// Helper Functions (exported)
// =============================================================================

export function toggleExpanded(itemId: string): void {
  expandedItems.update((set) => {
    const newSet = new Set(set);
    if (newSet.has(itemId)) {
      newSet.delete(itemId);
    } else {
      newSet.add(itemId);
    }
    return newSet;
  });
}

export function formatTimeOffset(timestamp: number, startTime: number): string {
  const offset = Math.max(0, timestamp - startTime);
  const secs = Math.floor(offset / 1000);
  const mins = Math.floor(secs / 60);
  if (mins > 0) {
    return `${mins}:${String(secs % 60).padStart(2, '0')}`;
  }
  return `${secs}s`;
}

export function getHighlightClass(item: InspectorItem): string {
  if (item.type === 'console') {
    if (item.level === 'error') return 'highlight-danger';
    if (item.level === 'warn') return 'highlight-warning';
  }
  if (item.type === 'network') {
    const status = item.response?.status ?? item.error?.error;
    if (isNumber(status)) {
      if (status >= 500) return 'highlight-danger';
      if (status >= 400) return 'highlight-warning';
    }
    if (item.error) return 'highlight-danger';
  }
  return '';
}

export function getDurationClass(duration: number): string {
  if (duration >= 2000) return 'very-slow';
  if (duration >= 500) return 'slow';
  return '';
}

export function getStatusClass(status: number | undefined): string {
  if (!status) return '';
  if (status >= 500) return 'danger';
  if (status >= 400) return 'warning';
  return 'success';
}
