import {
  Config,
  Logger,
  exists,
} from '@browserless.io/browserless';
import { EventEmitter } from 'events';
import { mkdir, readFile, readdir, rm, writeFile } from 'fs/promises';
import path from 'path';

// Bundled @rrweb/record script - no require.resolve() needed
import { RRWEB_RECORD_SCRIPT, RRWEB_CONSOLE_PLUGIN_SCRIPT } from './generated/rrweb-script.js';
import { RecordingStore } from './recording-store.js';
import type { IRecordingStore, RecordingMetadata } from './interfaces/recording-store.interface.js';
import type { VideoEncoder } from './video/encoder.js';

// Re-export RecordingMetadata for backwards compatibility
export type { RecordingMetadata } from './interfaces/recording-store.interface.js';

export interface ReplayEvent {
  data: unknown;
  timestamp: number;
  type: number;
}

export interface Recording {
  events: ReplayEvent[];
  metadata: RecordingMetadata;
}

/**
 * Result of stopping a recording.
 * Returns both the filepath and metadata for CDP event injection.
 */
export interface StopRecordingResult {
  filepath: string;
  metadata: RecordingMetadata;
}

export interface SessionRecordingState {
  events: ReplayEvent[];
  isRecording: boolean;
  sessionId: string;
  startedAt: number;
  trackingId?: string;
  /** Functions to call for final event collection before stopping */
  finalCollectors: Array<() => Promise<void>>;
  /** Cleanup functions to call after recording stops (e.g., disconnect puppeteer) */
  cleanupFns: Array<() => Promise<void>>;
}

/**
 * Get the network capture script for intercepting fetch/XHR requests.
 * Emits custom rrweb events (type 5) with tag 'network.request', 'network.response', 'network.error'.
 * Captures headers and bodies (truncated to 10KB) for debugging.
 */
function getNetworkCaptureScript(): string {
  return `
(function setupNetworkCapture() {
  if (window.__browserlessNetworkSetup) return;
  window.__browserlessNetworkSetup = true;

  var recording = window.__browserlessRecording;
  if (!recording) return;

  var MAX_BODY_SIZE = 10240; // 10KB max for request/response bodies

  function emitNetworkEvent(tag, payload) {
    recording.events.push({
      type: 5,
      timestamp: Date.now(),
      data: { tag: tag, payload: payload }
    });
  }

  // Safely truncate body content
  function truncateBody(body, maxSize) {
    if (!body) return null;
    if (typeof body !== 'string') {
      try {
        body = JSON.stringify(body);
      } catch (e) {
        body = String(body);
      }
    }
    if (body.length > maxSize) {
      return body.substring(0, maxSize) + '... [truncated]';
    }
    return body;
  }

  // Convert Headers object to plain object
  function headersToObject(headers) {
    if (!headers) return null;
    var obj = {};
    try {
      if (headers instanceof Headers) {
        headers.forEach(function(value, key) {
          obj[key] = value;
        });
      } else if (typeof headers === 'object') {
        // Plain object or array of [key, value] pairs
        if (Array.isArray(headers)) {
          headers.forEach(function(pair) {
            if (Array.isArray(pair) && pair.length >= 2) {
              obj[pair[0]] = pair[1];
            }
          });
        } else {
          Object.keys(headers).forEach(function(key) {
            obj[key] = headers[key];
          });
        }
      }
    } catch (e) {
      return null;
    }
    return Object.keys(obj).length > 0 ? obj : null;
  }

  // Check if content type suggests binary data
  function isBinaryContentType(contentType) {
    if (!contentType) return false;
    var binaryTypes = ['image/', 'audio/', 'video/', 'application/octet-stream', 'application/pdf', 'application/zip'];
    return binaryTypes.some(function(type) {
      return contentType.toLowerCase().indexOf(type) !== -1;
    });
  }

  // Parse XHR response headers string to object
  function parseXHRHeaders(headerStr) {
    if (!headerStr) return null;
    var headers = {};
    var pairs = headerStr.trim().split('\\r\\n');
    pairs.forEach(function(pair) {
      var idx = pair.indexOf(':');
      if (idx > 0) {
        var key = pair.substring(0, idx).trim().toLowerCase();
        var value = pair.substring(idx + 1).trim();
        headers[key] = value;
      }
    });
    return Object.keys(headers).length > 0 ? headers : null;
  }

  // Intercept fetch
  var originalFetch = window.fetch;
  window.fetch = function(input, init) {
    var startTime = Date.now();
    var url = typeof input === 'string' ? input : (input.url || String(input));
    var method = (init && init.method) || 'GET';
    var requestId = Math.random().toString(36).substr(2, 9);

    // Capture request headers
    var requestHeaders = null;
    try {
      if (init && init.headers) {
        requestHeaders = headersToObject(init.headers);
      } else if (input instanceof Request) {
        requestHeaders = headersToObject(input.headers);
      }
    } catch (e) {}

    // Capture request body
    var requestBody = null;
    try {
      if (init && init.body) {
        if (typeof init.body === 'string') {
          requestBody = truncateBody(init.body, MAX_BODY_SIZE);
        } else if (init.body instanceof FormData) {
          requestBody = '[FormData]';
        } else if (init.body instanceof Blob) {
          requestBody = '[Blob: ' + init.body.size + ' bytes]';
        } else if (init.body instanceof ArrayBuffer) {
          requestBody = '[ArrayBuffer: ' + init.body.byteLength + ' bytes]';
        } else {
          requestBody = truncateBody(init.body, MAX_BODY_SIZE);
        }
      }
    } catch (e) {}

    emitNetworkEvent('network.request', {
      id: requestId,
      url: url,
      method: method,
      type: 'fetch',
      timestamp: startTime,
      headers: requestHeaders,
      body: requestBody
    });

    return originalFetch.apply(this, arguments).then(function(response) {
      // Capture response headers
      var responseHeaders = null;
      try {
        responseHeaders = headersToObject(response.headers);
      } catch (e) {}

      // Check content type for binary detection
      var contentType = '';
      try {
        contentType = response.headers.get('content-type') || '';
      } catch (e) {}

      // Capture response body (clone to not consume the stream)
      var responseBodyPromise = Promise.resolve(null);
      if (!isBinaryContentType(contentType)) {
        try {
          responseBodyPromise = response.clone().text().then(function(text) {
            return truncateBody(text, MAX_BODY_SIZE);
          }).catch(function() {
            return null;
          });
        } catch (e) {}
      }

      responseBodyPromise.then(function(responseBody) {
        emitNetworkEvent('network.response', {
          id: requestId,
          url: url,
          method: method,
          status: response.status,
          statusText: response.statusText,
          duration: Date.now() - startTime,
          type: 'fetch',
          headers: responseHeaders,
          body: responseBody,
          contentType: contentType || null
        });
      });

      return response;
    }).catch(function(error) {
      emitNetworkEvent('network.error', {
        id: requestId,
        url: url,
        method: method,
        error: error.message || String(error),
        duration: Date.now() - startTime,
        type: 'fetch'
      });
      throw error;
    });
  };

  // Intercept XMLHttpRequest
  var originalXHROpen = XMLHttpRequest.prototype.open;
  var originalXHRSend = XMLHttpRequest.prototype.send;
  var originalXHRSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function(method, url) {
    this.__browserlessXHR = {
      method: method,
      url: url,
      id: Math.random().toString(36).substr(2, 9),
      requestHeaders: {}
    };
    return originalXHROpen.apply(this, arguments);
  };

  // Capture request headers by wrapping setRequestHeader
  XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
    if (this.__browserlessXHR) {
      this.__browserlessXHR.requestHeaders[name.toLowerCase()] = value;
    }
    return originalXHRSetRequestHeader.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function(body) {
    var xhr = this;
    var info = xhr.__browserlessXHR;
    if (!info) return originalXHRSend.apply(this, arguments);

    var startTime = Date.now();

    // Capture request body
    var requestBody = null;
    try {
      if (body) {
        if (typeof body === 'string') {
          requestBody = truncateBody(body, MAX_BODY_SIZE);
        } else if (body instanceof FormData) {
          requestBody = '[FormData]';
        } else if (body instanceof Blob) {
          requestBody = '[Blob: ' + body.size + ' bytes]';
        } else if (body instanceof ArrayBuffer) {
          requestBody = '[ArrayBuffer: ' + body.byteLength + ' bytes]';
        } else if (body instanceof Document) {
          requestBody = '[Document]';
        } else {
          requestBody = truncateBody(body, MAX_BODY_SIZE);
        }
      }
    } catch (e) {}

    emitNetworkEvent('network.request', {
      id: info.id,
      url: info.url,
      method: info.method,
      type: 'xhr',
      timestamp: startTime,
      headers: Object.keys(info.requestHeaders).length > 0 ? info.requestHeaders : null,
      body: requestBody
    });

    xhr.addEventListener('load', function() {
      // Capture response headers
      var responseHeaders = null;
      try {
        responseHeaders = parseXHRHeaders(xhr.getAllResponseHeaders());
      } catch (e) {}

      // Get content type
      var contentType = '';
      try {
        contentType = xhr.getResponseHeader('content-type') || '';
      } catch (e) {}

      // Capture response body (only for text responses)
      var responseBody = null;
      if (!isBinaryContentType(contentType)) {
        try {
          if (xhr.responseType === '' || xhr.responseType === 'text') {
            responseBody = truncateBody(xhr.responseText, MAX_BODY_SIZE);
          } else if (xhr.responseType === 'json') {
            responseBody = truncateBody(JSON.stringify(xhr.response), MAX_BODY_SIZE);
          } else if (xhr.responseType === 'document' && xhr.responseXML) {
            responseBody = '[XML Document]';
          } else {
            responseBody = '[' + xhr.responseType + ' response]';
          }
        } catch (e) {}
      }

      emitNetworkEvent('network.response', {
        id: info.id,
        url: info.url,
        method: info.method,
        status: xhr.status,
        statusText: xhr.statusText,
        duration: Date.now() - startTime,
        type: 'xhr',
        headers: responseHeaders,
        body: responseBody,
        contentType: contentType || null
      });
    });

    xhr.addEventListener('error', function() {
      emitNetworkEvent('network.error', {
        id: info.id,
        url: info.url,
        method: info.method,
        error: 'Network error',
        duration: Date.now() - startTime,
        type: 'xhr'
      });
    });

    xhr.addEventListener('abort', function() {
      emitNetworkEvent('network.error', {
        id: info.id,
        url: info.url,
        method: info.method,
        error: 'Request aborted',
        duration: Date.now() - startTime,
        type: 'xhr'
      });
    });

    return originalXHRSend.apply(this, arguments);
  };

  console.log('[browserless] Network capture enabled (with headers/body)');
})();`;
}

/**
 * Get a lightweight recording script for injection into cross-origin iframe targets via CDP.
 *
 * Only includes rrweb record — no console plugin, no network capture, no turnstile overlay.
 * Those main-frame features hook into globals (fetch, XHR, console) that can conflict with
 * cross-origin page JS (e.g., Cloudflare Turnstile).
 *
 * The emit callback is a no-op because rrweb auto-detects the cross-origin context
 * (try/catch on window.parent.document) and sends events via PostMessage to the parent.
 * The parent frame's rrweb instance (with recordCrossOriginIframes: true) receives
 * and merges these events into the main recording.
 *
 * __browserlessRecording is set to `true` (not an object) as a guard against
 * double-injection — no event array is needed since events flow via PostMessage.
 */
export function getIframeRecordingScript(): string {
  return `${RRWEB_RECORD_SCRIPT}
(function() {
  if (window.__browserlessRecording) return;
  window.__browserlessRecording = true;
  var recordFn = window.rrweb?.record;
  if (typeof recordFn !== 'function') return;
  recordFn({
    emit: function() {},
    recordCrossOriginIframes: true,
    recordCanvas: true,
    collectFonts: true,
    inlineImages: true,
    sampling: { mousemove: true, mouseInteraction: true, scroll: 150, media: 800, input: 'last', canvas: 2 },
    dataURLOptions: { type: 'image/webp', quality: 0.6, maxBase64ImageLength: 2097152 }
  });
})();`;
}

/**
 * Get the full recording script (rrweb + init) for injection via evaluateOnNewDocument.
 * Uses pre-bundled script from build time - no runtime file reading.
 *
 * This script is for the MAIN FRAME only. Events are collected into a local
 * array and polled periodically by the recording coordinator.
 */
export function getRecordingScript(sessionId: string): string {
  return `${RRWEB_RECORD_SCRIPT}
${RRWEB_CONSOLE_PLUGIN_SCRIPT}
(function() {
  if (window.__browserlessRecording) return;
  window.__browserlessRecording = { events: [], sessionId: '${sessionId}' };
  var recordFn = window.rrweb?.record;
  if (typeof recordFn !== 'function') {
    console.warn('[browserless] rrweb.record not found');
    return;
  }
  // Initialize console plugin
  var consolePlugin = window.rrwebConsolePlugin?.getRecordConsolePlugin?.({
    level: ['error', 'warn', 'info', 'log', 'debug'],
    lengthThreshold: 500
  });
  window.__browserlessStopRecording = recordFn({
    emit: function(event) { window.__browserlessRecording.events.push(event); },
    sampling: { mousemove: true, mouseInteraction: true, scroll: 150, media: 800, input: 'last', canvas: 2 },
    recordCanvas: true,
    collectFonts: true,
    recordCrossOriginIframes: true,
    inlineImages: true,
    dataURLOptions: { type: 'image/webp', quality: 0.6, maxBase64ImageLength: 2097152 },
    plugins: consolePlugin ? [consolePlugin] : []
  });
  console.log('[browserless] rrweb recording started, sessionId:', '${sessionId}');
})();
${getNetworkCaptureScript()}`;
}

/**
 * Get a simpler init script for injecting into already-loaded pages.
 * The rrweb library should already be loaded via evaluateOnNewDocument.
 */
export function getRecordingInitScript(sessionId: string): string {
  return `${RRWEB_RECORD_SCRIPT}
${RRWEB_CONSOLE_PLUGIN_SCRIPT}
(function() {
  if (window.__browserlessRecording) return 'already_recording';
  window.__browserlessRecording = { events: [], sessionId: '${sessionId}' };
  var recordFn = window.rrweb?.record;
  if (typeof recordFn !== 'function') return 'no_rrweb';
  // Initialize console plugin
  var consolePlugin = window.rrwebConsolePlugin?.getRecordConsolePlugin?.({
    level: ['error', 'warn', 'info', 'log', 'debug'],
    lengthThreshold: 500
  });
  window.__browserlessStopRecording = recordFn({
    emit: function(event) { window.__browserlessRecording.events.push(event); },
    sampling: { mousemove: true, mouseInteraction: true, scroll: 150, media: 800, input: 'last', canvas: 2 },
    recordCanvas: true,
    collectFonts: true,
    recordCrossOriginIframes: true,
    inlineImages: true,
    dataURLOptions: { type: 'image/webp', quality: 0.6, maxBase64ImageLength: 2097152 },
    plugins: consolePlugin ? [consolePlugin] : []
  });
  return 'started';
})();
${getNetworkCaptureScript()}`;
}

/**
 * SessionReplay manages browser session recording and playback.
 *
 * Supports dependency injection for the recording store:
 * - If a store is provided via constructor, it's used directly
 * - If no store is provided, one is created during initialize()
 *
 * This decoupling allows for easy mocking in tests.
 */
export class SessionReplay extends EventEmitter {
  protected recordings: Map<string, SessionRecordingState> = new Map();
  protected log = new Logger('session-replay');
  protected recordingsDir: string;
  protected enabled: boolean;
  protected maxRecordingSize: number;
  protected store: IRecordingStore | null = null;
  protected ownsStore = false; // Track if we created the store (for cleanup)
  private videoEncoder?: VideoEncoder;

  constructor(
    protected config: Config,
    injectedStore?: IRecordingStore
  ) {
    super();
    this.enabled = process.env.ENABLE_REPLAY !== 'false';
    this.recordingsDir = process.env.REPLAY_DIR || '/tmp/browserless-recordings';
    this.maxRecordingSize = +(process.env.REPLAY_MAX_SIZE || '52428800');

    // Use injected store if provided
    if (injectedStore) {
      this.store = injectedStore;
      this.ownsStore = false;
    }
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public getRecordingsDir(): string {
    return this.recordingsDir;
  }

  /**
   * Get the current recording store.
   * Useful for testing or advanced use cases.
   */
  public getStore(): IRecordingStore | null {
    return this.store;
  }

  /**
   * Set the video encoder reference (for on-demand encoding from routes).
   */
  public setVideoEncoder(encoder: VideoEncoder): void {
    this.videoEncoder = encoder;
  }

  /**
   * Get the video encoder (used by routes to trigger on-demand encoding).
   */
  public getVideoEncoder(): VideoEncoder | undefined {
    return this.videoEncoder;
  }

  public async initialize(): Promise<void> {
    if (!this.enabled) {
      this.log.info('Session replay is disabled');
      return;
    }

    // Verify bundled script is available (build-time bundled, no runtime loading)
    if (!RRWEB_RECORD_SCRIPT) {
      this.log.error('rrweb script not bundled - run npm run bundle:rrweb');
      this.enabled = false;
      return;
    }

    if (!(await exists(this.recordingsDir))) {
      await mkdir(this.recordingsDir, { recursive: true });
      this.log.info(`Created recordings directory: ${this.recordingsDir}`);
    }

    // Only create store if not injected
    if (!this.store) {
      this.store = new RecordingStore(this.recordingsDir);
      this.ownsStore = true;
    }

    // Migrate any existing JSON recordings to SQLite (one-time migration)
    await this.migrateExistingRecordings();

    this.log.info(`Session replay enabled (bundled rrweb), storing in: ${this.recordingsDir}`);
  }

  /**
   * One-time migration: read existing JSON files and populate SQLite metadata.
   * Safe to run multiple times - INSERT OR REPLACE handles duplicates.
   */
  private async migrateExistingRecordings(): Promise<void> {
    if (!this.store) return;

    try {
      const files = await readdir(this.recordingsDir);
      let migrated = 0;

      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const content = await readFile(path.join(this.recordingsDir, file), 'utf-8');
          const recording = JSON.parse(content);
          if (recording.metadata) {
            const result = this.store.insert(recording.metadata);
            if (result.ok) {
              migrated++;
            }
          }
        } catch {
          // Skip invalid files
        }
      }

      if (migrated > 0) {
        this.log.info(`Migrated ${migrated} existing recordings to SQLite`);
      }
    } catch {
      // Directory might not exist or be empty
    }
  }

  public startRecording(sessionId: string, trackingId?: string): void {
    if (!this.enabled || this.recordings.has(sessionId)) return;

    this.recordings.set(sessionId, {
      cleanupFns: [],
      events: [],
      finalCollectors: [],
      isRecording: true,
      sessionId,
      startedAt: Date.now(),
      trackingId,
    });
    this.log.debug(`Started recording for session ${sessionId}`);
  }

  public addEvent(sessionId: string, event: ReplayEvent): void {
    const state = this.recordings.get(sessionId);
    if (!state?.isRecording) return;

    const currentSize = JSON.stringify(state.events).length;
    if (currentSize > this.maxRecordingSize) {
      this.log.warn(`Recording ${sessionId} exceeded max size, stopping`);
      this.stopRecording(sessionId);
      return;
    }

    state.events.push(event);
  }

  public addEvents(sessionId: string, events: ReplayEvent[]): void {
    for (const event of events) {
      this.addEvent(sessionId, event);
    }
  }

  /**
   * Register a function to be called for final event collection before stopping.
   * This ensures we don't lose events between the last poll and session close.
   */
  public registerFinalCollector(sessionId: string, collector: () => Promise<void>): void {
    const state = this.recordings.get(sessionId);
    if (state) {
      state.finalCollectors.push(collector);
    }
  }

  /**
   * Register a cleanup function to be called after recording stops.
   * Use this for resources that need cleanup (e.g., disconnect puppeteer connections).
   */
  public registerCleanupFn(sessionId: string, cleanupFn: () => Promise<void>): void {
    const state = this.recordings.get(sessionId);
    if (state) {
      state.cleanupFns.push(cleanupFn);
    }
  }

  public async stopRecording(
    sessionId: string,
    metadata?: Partial<RecordingMetadata>
  ): Promise<StopRecordingResult | null> {
    const state = this.recordings.get(sessionId);
    if (!state) return null;

    // Run all final collectors to gather any pending events before saving
    // This prevents losing events between the last poll and session close
    for (const collector of state.finalCollectors) {
      try {
        await collector();
      } catch (e) {
        this.log.warn(`Final collector failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    state.isRecording = false;
    const endedAt = Date.now();

    const recordingMetadata: RecordingMetadata = {
      browserType: metadata?.browserType || 'unknown',
      duration: endedAt - state.startedAt,
      endedAt,
      eventCount: state.events.length,
      frameCount: metadata?.frameCount ?? 0,
      id: sessionId,
      routePath: metadata?.routePath || 'unknown',
      startedAt: state.startedAt,
      trackingId: state.trackingId,
      userAgent: metadata?.userAgent,
      encodingStatus: metadata?.frameCount ? 'deferred' : 'none',
    };

    const recording: Recording = {
      events: state.events,
      metadata: recordingMetadata,
    };

    const filepath = path.join(this.recordingsDir, `${sessionId}.json`);

    try {
      // Save full recording to JSON (events + metadata for playback)
      await writeFile(filepath, JSON.stringify(recording), 'utf-8');

      // Save metadata to SQLite for fast queries
      if (this.store) {
        const result = this.store.insert(recording.metadata);
        if (!result.ok) {
          this.log.warn(`Failed to save recording metadata to store: ${result.error.message}`);
        }
      }

      this.log.info(`Saved recording ${sessionId} with ${state.events.length} events`);
    } catch (err) {
      this.log.error(`Failed to save recording ${sessionId}: ${err}`);
    }

    this.recordings.delete(sessionId);

    // Run cleanup functions after saving (e.g., disconnect puppeteer)
    for (const cleanupFn of state.cleanupFns) {
      try {
        await cleanupFn();
      } catch (e) {
        this.log.warn(`Cleanup function failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return { filepath, metadata: recordingMetadata };
  }

  public isRecording(sessionId: string): boolean {
    return this.recordings.get(sessionId)?.isRecording || false;
  }

  public getRecordingState(sessionId: string): SessionRecordingState | undefined {
    return this.recordings.get(sessionId);
  }

  /**
   * List all recordings metadata.
   * Uses SQLite for O(1) query instead of O(n) file reads.
   */
  public async listRecordings(): Promise<RecordingMetadata[]> {
    // Fast path: use SQLite store
    if (this.store) {
      const result = this.store.list();
      if (result.ok) {
        return result.value;
      }
      this.log.warn(`Failed to list recordings from store: ${result.error.message}`);
      // Fall through to fallback
    }

    // Fallback: scan files (only if store not initialized or errored)
    if (!(await exists(this.recordingsDir))) return [];

    const files = await readdir(this.recordingsDir);
    const recordings: RecordingMetadata[] = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const content = await readFile(path.join(this.recordingsDir, file), 'utf-8');
        recordings.push(JSON.parse(content).metadata);
      } catch {
        // Skip invalid files
      }
    }

    return recordings.sort((a, b) => b.startedAt - a.startedAt);
  }

  public async getRecording(id: string): Promise<Recording | null> {
    const filepath = path.join(this.recordingsDir, `${id}.json`);
    if (!(await exists(filepath))) return null;

    try {
      return JSON.parse(await readFile(filepath, 'utf-8'));
    } catch {
      return null;
    }
  }

  public async deleteRecording(id: string): Promise<boolean> {
    const filepath = path.join(this.recordingsDir, `${id}.json`);
    if (!(await exists(filepath))) return false;

    try {
      await rm(filepath);
      // Also remove video file if it exists
      const videoPath = path.join(this.recordingsDir, `${id}.mp4`);
      if (await exists(videoPath)) {
        await rm(videoPath);
      }
      // Clean up frames directory if it exists (orphaned encoding)
      const framesDir = path.join(this.recordingsDir, id, 'frames');
      if (await exists(framesDir)) {
        await rm(path.join(this.recordingsDir, id), { recursive: true });
      }
      // Also remove from SQLite
      if (this.store) {
        const result = this.store.delete(id);
        if (!result.ok) {
          this.log.warn(`Failed to delete recording from store: ${result.error.message}`);
        }
      }
      this.log.info(`Deleted recording ${id}`);
      return true;
    } catch {
      return false;
    }
  }

  public async shutdown(): Promise<void> {
    this.log.info('Shutting down session replay...');
    for (const [sessionId] of this.recordings) {
      await this.stopRecording(sessionId);
    }
    // Only close SQLite connection if we own it
    if (this.ownsStore && this.store) {
      this.store.close();
    }
    this.store = null;
    this.stop();
  }

  public stop() {}
}
