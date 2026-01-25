import {
  BrowserInstance,
  Logger,
  SessionReplay,
  StopRecordingResult,
  getCDPClient,
  getRecordingScript,
} from '@browserless.io/browserless';
import { Page } from 'puppeteer-core';
import type { CDPSession } from 'playwright-core';

/**
 * RecordingCoordinator manages rrweb recording across browser sessions.
 *
 * Responsibilities:
 * - Set up CDP protocol listeners for recording
 * - Inject rrweb script into pages
 * - Collect events from pages periodically
 * - Handle navigation and new tab events
 *
 * This class is decoupled from BrowserManager - it receives SessionReplay
 * via constructor and uses it for event storage.
 */
export class RecordingCoordinator {
  private log = new Logger('recording-coordinator');

  constructor(private sessionReplay?: SessionReplay) {}

  /**
   * Check if recording is enabled.
   */
  isEnabled(): boolean {
    return this.sessionReplay?.isEnabled() ?? false;
  }

  /**
   * Set up RRWeb recording for a page using raw CDP commands.
   * Works with ALL clients: puppeteer, playwright, raw CDP, pydoll, etc.
   *
   * Key insight from Puppeteer issues:
   * - Page.enable MUST be called before Page.addScriptToEvaluateOnNewDocument
   * - sessionattached event catches new tabs/iframes/popups
   * @see https://github.com/puppeteer/puppeteer/issues/10094
   * @see https://github.com/puppeteer/puppeteer/issues/12706
   */
  async setupPageRecording(page: Page, sessionId: string): Promise<void> {
    if (!this.sessionReplay) return;

    // Get raw CDP client - works regardless of how page was created
    const cdp = getCDPClient(page);
    if (!cdp) {
      this.log.warn(`No CDP client available for page, skipping recording`);
      return;
    }

    // Get the recording script early so it's available in collectEvents closure
    const script = getRecordingScript(sessionId);

    const collectEvents = async () => {
      try {
        if (page.isClosed()) return;

        // First, check if rrweb is loaded and actively recording
        // This handles cases where:
        // 1. addScriptToEvaluateOnNewDocument didn't fire
        // 2. rrweb loaded but failed to start recording
        const checkResult = await cdp.send('Runtime.evaluate', {
          expression: `JSON.stringify({
            hasRecording: !!window.__browserlessRecording,
            hasRrweb: !!window.rrweb,
            isRecording: typeof window.__browserlessStopRecording === 'function',
            url: window.location.href
          })`,
          returnByValue: true,
        }).catch(() => null);

        let needsInjection = false;
        if (checkResult?.result?.value) {
          try {
            const status = JSON.parse(checkResult.result.value);
            // Inject if we're on a real page AND (recording not set up OR rrweb not actually recording)
            if (status.url && !status.url.startsWith('about:') && !status.isRecording) {
              needsInjection = true;
              this.log.debug(`Recording not active on ${status.url} (hasRecording=${status.hasRecording}, hasRrweb=${status.hasRrweb}, isRecording=${status.isRecording}), injecting...`);
            }
          } catch {
            // ignore
          }
        }

        // Inject rrweb if needed (self-healing for when addScriptToEvaluateOnNewDocument doesn't work)
        if (needsInjection) {
          // Clear any partial state first so the script reinitializes fully
          await cdp.send('Runtime.evaluate', {
            expression: `delete window.__browserlessRecording; delete window.__browserlessStopRecording;`,
            returnByValue: true,
          }).catch(() => {});

          await cdp.send('Runtime.evaluate', {
            expression: script,
            returnByValue: true,
          }).catch((e) => {
            this.log.warn(`Failed to inject rrweb: ${e instanceof Error ? e.message : String(e)}`);
          });
        }

        // Now collect events
        const result = await cdp.send('Runtime.evaluate', {
          expression: `(function() {
            const recording = window.__browserlessRecording;
            const debug = {
              hasRecording: !!recording,
              hasRrweb: !!window.rrweb,
              url: window.location.href,
              eventCount: recording?.events?.length || 0
            };
            if (!recording?.events?.length) return JSON.stringify({ events: [], debug });
            const collected = [...recording.events];
            recording.events = [];
            return JSON.stringify({ events: collected, debug });
          })()`,
          returnByValue: true,
        }).catch((e) => {
          this.log.warn(`collectEvents CDP error: ${e instanceof Error ? e.message : String(e)}`);
          return null;
        });

        if (result?.result?.value) {
          try {
            const parsed = JSON.parse(result.result.value);
            const { events, debug } = parsed;

            // Log debug info periodically (every 10 polls or when events found)
            if (events?.length || Math.random() < 0.1) {
              this.log.debug(`collectEvents: url=${debug?.url}, hasRecording=${debug?.hasRecording}, hasRrweb=${debug?.hasRrweb}, eventCount=${events?.length || 0}`);
            }

            if (events?.length) {
              this.sessionReplay?.addEvents(sessionId, events);
            }
          } catch {
            // JSON parse error, ignore
          }
        }
      } catch {
        // Page closed or navigating
      }
    };

    try {
      // 1. Enable Page domain FIRST (REQUIRED by CDP protocol!)
      // Without this, addScriptToEvaluateOnNewDocument may silently fail
      await cdp.send('Page.enable');

      // 2. Inject for ALL future navigations via raw CDP
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
        source: script,
        runImmediately: true,
      });

      // 3. Handle new tabs/iframes/popups via sessionattached event
      // This catches contexts created after the initial page
      // Note: Using EventEmitter pattern since CDPSession extends it
      const emitter = cdp as unknown as NodeJS.EventEmitter;
      emitter.on('sessionattached', async (attachedSession: CDPSession) => {
        try {
          await attachedSession.send('Page.enable');
          await attachedSession.send('Page.addScriptToEvaluateOnNewDocument', {
            source: script,
            runImmediately: true,
          });
          this.log.debug(`rrweb injection: attached session for ${sessionId}`);
        } catch (e) {
          this.log.warn(`rrweb session attach failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      });

      // 4. Inject immediately on current page via raw CDP Runtime.evaluate
      let initStatus = 'success';
      try {
        await cdp.send('Runtime.evaluate', {
          expression: script,
          returnByValue: true,
        });
      } catch (e) {
        initStatus = `error: ${e instanceof Error ? e.message : String(e)}`;
      }

      this.log.debug(`rrweb injection: ${initStatus}`);

      // 5. FIX: Collect events BEFORE navigation starts (prevents event loss)
      // Page.frameStartedLoading fires when navigation begins, BEFORE old document unloads
      emitter.on('Page.frameStartedLoading', async () => {
        try {
          await collectEvents();
          this.log.debug(`Collected events before navigation for session ${sessionId}`);
        } catch {
          // Page might be in weird state during navigation
        }
      });

      // 6. FIX: Re-inject immediately after navigation completes
      // This handles CDP session isolation - addScriptToEvaluateOnNewDocument may not fire
      // for navigations triggered by other CDP sessions (like pydoll)
      const injectAfterNavigation = async (source: string) => {
        // Small delay to let the page initialize
        await new Promise((r) => setTimeout(r, 50));
        try {
          if (page.isClosed()) return;
          await cdp.send('Runtime.evaluate', {
            expression: script,
            returnByValue: true,
          });
          this.log.debug(`Re-injected rrweb (${source}) for session ${sessionId}`);
        } catch {
          // Page might not be ready yet, self-healing will catch it
        }
      };

      // Listen for multiple navigation events for redundancy
      emitter.on('Page.frameNavigated', () => injectAfterNavigation('frameNavigated'));
      emitter.on('Page.loadEventFired', () => injectAfterNavigation('loadEventFired'));
      emitter.on('Page.domContentEventFired', () => injectAfterNavigation('domContentEventFired'));

      // 7. FIX: Collect events more frequently (200ms instead of 1000ms)
      // Reduces maximum event loss window from 1 second to 200ms
      const intervalId = setInterval(collectEvents, 200);

      // 8. Register final collector so we don't lose events on session close
      // This is called by stopRecording BEFORE setting isRecording=false
      this.sessionReplay?.registerFinalCollector(sessionId, collectEvents);

      page.once('close', async () => {
        clearInterval(intervalId);
        // Note: collectEvents here might be redundant now, but kept for safety
        await collectEvents();
      });

      this.log.debug(`Recording enabled for session ${sessionId}`);
    } catch (err) {
      this.log.warn(`Failed to set up replay recording: ${err}`);
    }
  }

  /**
   * Set up recording for ALL tabs using RAW CDP (no puppeteer).
   *
   * CRITICAL: We must NOT use puppeteer.connect() because it creates a competing
   * CDP connection that blocks external clients (like pydoll) from sending commands.
   *
   * Instead, we use raw WebSocket CDP to:
   * 1. Listen for new targets via Target.targetCreated events
   * 2. Inject rrweb via Runtime.evaluate when pages are created
   * 3. Poll for events periodically
   *
   * This approach doesn't interfere with external CDP clients.
   */
  async setupRecordingForAllTabs(
    browser: BrowserInstance,
    sessionId: string,
  ): Promise<void> {
    if (!this.sessionReplay) return;

    const wsEndpoint = browser.wsEndpoint();
    if (!wsEndpoint) return;

    const WebSocket = (await import('ws')).default;
    const script = getRecordingScript(sessionId);

    try {
      // Connect raw WebSocket to browser CDP endpoint
      const ws = new WebSocket(wsEndpoint);
      let cmdId = 1;
      const pendingCommands = new Map<number, { resolve: Function; reject: Function }>();
      const trackedTargets = new Set<string>(); // targets we're collecting events from
      const injectedTargets = new Set<string>(); // targets we've injected rrweb into
      let closed = false;

      // Helper to send CDP command and wait for response
      // For browser-level commands (no sessionId), sends directly to browser
      // For target-level commands (with sessionId from flatten=false attachment),
      // wraps in Target.sendMessageToTarget
      const sendCommand = (method: string, params: object = {}, cdpSessionId?: string): Promise<any> => {
        return new Promise((resolve, reject) => {
          const id = cmdId++;
          pendingCommands.set(id, { resolve, reject });

          let msg: any;
          if (cdpSessionId) {
            // For flatten=false, must use Target.sendMessageToTarget
            // The inner command is JSON-stringified in the message param
            // Use the same ID for the inner command - the response comes via receivedMessageFromTarget
            const innerCommand = JSON.stringify({ id, method, params });
            const outerId = cmdId++; // Different ID for the outer sendMessageToTarget
            msg = {
              id: outerId,
              method: 'Target.sendMessageToTarget',
              params: {
                sessionId: cdpSessionId,
                message: innerCommand,
              },
            };
            // We ignore the outer response (just acknowledges sendMessageToTarget was received)
            // The actual result comes via Target.receivedMessageFromTarget with the inner id
          } else {
            // Browser-level command, send directly
            msg = { id, method, params };
          }

          ws.send(JSON.stringify(msg));

          // Timeout after 5 seconds
          setTimeout(() => {
            if (pendingCommands.has(id)) {
              pendingCommands.delete(id);
              reject(new Error(`CDP command ${method} timed out`));
            }
          }, 5000);
        });
      };

      // Map to track our CDP session IDs for each target (for flatten=false attachment)
      const targetSessions = new Map<string, string>(); // targetId -> cdpSessionId

      // Helper to attach to a target and inject rrweb
      // Uses flatten=false which is less invasive than flatten=true
      const injectRecording = async (targetId: string) => {
        if (injectedTargets.has(targetId)) return;

        try {
          // First attach to the target if we haven't already
          let cdpSessionId = targetSessions.get(targetId);
          if (!cdpSessionId) {
            const attachResult = await sendCommand('Target.attachToTarget', {
              targetId,
              flatten: false, // Less invasive - uses browser WebSocket, not dedicated session
            });
            cdpSessionId = attachResult?.sessionId;
            if (cdpSessionId) {
              targetSessions.set(targetId, cdpSessionId);
            }
          }

          if (!cdpSessionId) {
            this.log.debug(`Failed to get session for target ${targetId}`);
            return;
          }

          injectedTargets.add(targetId);

          // Inject rrweb via Runtime.evaluate using our session
          await sendCommand('Runtime.evaluate', {
            expression: script,
            returnByValue: true,
          }, cdpSessionId);

          this.log.debug(`Injected rrweb recording for target ${targetId}, session ${sessionId}`);
        } catch (e) {
          injectedTargets.delete(targetId);
          this.log.debug(`Failed to inject rrweb for target ${targetId}: ${e instanceof Error ? e.message : String(e)}`);
        }
      };

      // Helper to collect events from a target
      const collectEvents = async (targetId: string) => {
        if (closed) return;
        const cdpSessionId = targetSessions.get(targetId);
        if (!cdpSessionId) return;

        try {
          const result = await sendCommand('Runtime.evaluate', {
            expression: `(function() {
              const recording = window.__browserlessRecording;
              if (!recording?.events?.length) return JSON.stringify({ events: [] });
              const collected = [...recording.events];
              recording.events = [];
              return JSON.stringify({ events: collected });
            })()`,
            returnByValue: true,
          }, cdpSessionId);

          if (result?.result?.value) {
            const { events } = JSON.parse(result.result.value);
            if (events?.length) {
              this.sessionReplay?.addEvents(sessionId, events);
            }
          }
        } catch {
          // Target may be closed
        }
      };

      ws.on('message', async (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());

          // Handle command responses (direct responses from browser)
          if (msg.id && pendingCommands.has(msg.id)) {
            const { resolve, reject } = pendingCommands.get(msg.id)!;
            pendingCommands.delete(msg.id);
            if (msg.error) {
              reject(new Error(msg.error.message));
            } else {
              resolve(msg.result);
            }
            return;
          }

          // Handle responses from attached targets (flatten=false mode)
          // When using flatten=false, responses come as Target.receivedMessageFromTarget events
          // with the actual response JSON-encoded in msg.params.message
          if (msg.method === 'Target.receivedMessageFromTarget') {
            try {
              const innerMsg = JSON.parse(msg.params.message);
              if (innerMsg.id && pendingCommands.has(innerMsg.id)) {
                const { resolve, reject } = pendingCommands.get(innerMsg.id)!;
                pendingCommands.delete(innerMsg.id);
                if (innerMsg.error) {
                  reject(new Error(innerMsg.error.message));
                } else {
                  resolve(innerMsg.result);
                }
              }
            } catch {
              // Ignore parse errors
            }
            return;
          }

          // Handle new page targets - inject rrweb (no flatten needed!)
          if (msg.method === 'Target.targetCreated') {
            const { targetInfo } = msg.params;
            if (targetInfo.type === 'page') {
              this.log.debug(`New page target created: ${targetInfo.targetId}`);
              // Track target for event collection (no dedicated session needed)
              trackedTargets.add(targetInfo.targetId);
              // Small delay to let the page initialize before injection
              setTimeout(async () => {
                await injectRecording(targetInfo.targetId);
              }, 100);
            }
          }

          // Handle target destroyed
          if (msg.method === 'Target.targetDestroyed') {
            const { targetId } = msg.params;
            trackedTargets.delete(targetId);
            injectedTargets.delete(targetId);
          }

          // Handle target info changed (URL navigation) - re-inject rrweb
          if (msg.method === 'Target.targetInfoChanged') {
            const { targetInfo } = msg.params;
            if (targetInfo.type === 'page' && trackedTargets.has(targetInfo.targetId)) {
              // Clear injection flag so we can re-inject
              injectedTargets.delete(targetInfo.targetId);
              // Small delay to let the page initialize
              setTimeout(async () => {
                await injectRecording(targetInfo.targetId);
              }, 200);
            }
          }
        } catch (e) {
          this.log.debug(`Error processing CDP message: ${e}`);
        }
      });

      ws.on('open', async () => {
        try {
          // Enable target discovery to receive targetCreated/targetDestroyed/targetInfoChanged events
          // This is non-invasive - doesn't create dedicated sessions that conflict with pydoll
          await sendCommand('Target.setDiscoverTargets', { discover: true });

          // CRITICAL: Delay injection to give external client (pydoll) time to:
          // 1. Connect to the browser
          // 2. Enable its own CDP domains (Page, Runtime, etc.)
          // 3. Start initial operations
          // Without this delay, our sendMessageToTarget calls can race with pydoll
          const RECORDING_SETUP_DELAY = 2000; // 2 seconds

          // Find and inject into EXISTING targets after delay
          setTimeout(async () => {
            if (closed) return;
            try {
              const result = await sendCommand('Target.getTargets');
              for (const targetInfo of result?.targetInfos || []) {
                if (targetInfo.type === 'page') {
                  trackedTargets.add(targetInfo.targetId);
                  await injectRecording(targetInfo.targetId);
                }
              }
              this.log.debug(`Injected rrweb into ${trackedTargets.size} existing target(s) for session ${sessionId}`);
            } catch (e) {
              this.log.debug(`Delayed target injection failed: ${e}`);
            }
          }, RECORDING_SETUP_DELAY);

          this.log.debug(`Recording discovery enabled for session ${sessionId}`);
        } catch (e) {
          this.log.warn(`Failed to set up recording: ${e}`);
        }
      });

      ws.on('error', (err: Error) => {
        this.log.debug(`Recording WebSocket error: ${err.message}`);
      });

      ws.on('close', () => {
        closed = true;
        pendingCommands.forEach(({ reject }) => reject(new Error('WebSocket closed')));
        pendingCommands.clear();
      });

      // Poll for events periodically
      const pollInterval = setInterval(async () => {
        if (closed) {
          clearInterval(pollInterval);
          return;
        }
        for (const targetId of trackedTargets) {
          await collectEvents(targetId);
        }
      }, 500);

      // Register cleanup
      this.sessionReplay?.registerCleanupFn(sessionId, async () => {
        closed = true;
        clearInterval(pollInterval);

        // Collect final events before closing
        for (const targetId of trackedTargets) {
          await collectEvents(targetId);
        }

        try {
          ws.close();
          this.log.debug(`Closed recording WebSocket for session ${sessionId}`);
        } catch {
          // Ignore
        }
      });

      // Register final collector
      this.sessionReplay?.registerFinalCollector(sessionId, async () => {
        for (const targetId of trackedTargets) {
          await collectEvents(targetId);
        }
      });

    } catch (e) {
      this.log.warn(`Failed to setup recording: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * Start recording for a session.
   */
  startRecording(sessionId: string, trackingId?: string): void {
    this.sessionReplay?.startRecording(sessionId, trackingId);
    this.log.debug(`Started replay recording for session ${sessionId}`);
  }

  /**
   * Stop recording for a session.
   * Returns both filepath and metadata for CDP event injection.
   */
  async stopRecording(
    sessionId: string,
    metadata?: {
      browserType?: string;
      routePath?: string;
      trackingId?: string;
    }
  ): Promise<StopRecordingResult | null> {
    if (!this.sessionReplay) return null;
    return this.sessionReplay.stopRecording(sessionId, metadata);
  }
}
