import {
  BrowserInstance,
  Logger,
  SessionReplay,
  StopRecordingResult,
  getCDPClient,
  getRecordingScript,
  getIframeRecordingScript,
} from '@browserless.io/browserless';
import { Page } from 'puppeteer-core';
import type { CDPSession } from 'playwright-core';

import { ScreencastCapture } from './screencast-capture.js';
import { VideoEncoder } from '../video/encoder.js';

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
  private screencastCapture = new ScreencastCapture();
  private videoEncoder: VideoEncoder;

  constructor(private sessionReplay?: SessionReplay) {
    this.videoEncoder = new VideoEncoder(sessionReplay?.getStore() ?? null);
    // Expose encoder to routes for on-demand encoding
    sessionReplay?.setVideoEncoder(this.videoEncoder);
  }

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
   * Uses Target.setAutoAttach with waitForDebuggerOnStart to guarantee rrweb
   * is injected BEFORE any page JS runs. This is essential for closed shadow DOM
   * recording — rrweb's patchAttachShadow must be installed before any element
   * calls attachShadow({ mode: 'closed' }).
   *
   * Flow:
   * 1. Target.setAutoAttach (flatten=true) pauses new targets before JS execution
   * 2. Target.attachedToTarget fires as a top-level WS message with a sessionId
   * 3. We inject rrweb via Page.addScriptToEvaluateOnNewDocument (persists across navigations)
   * 4. Runtime.runIfWaitingForDebugger resumes the target — page JS starts AFTER rrweb
   * 5. Poll for events periodically
   *
   * flatten=true creates dedicated CDP sessions per target. Commands are sent directly
   * with sessionId on the WebSocket message (no sendMessageToTarget wrapping).
   *
   * Cross-origin iframes (e.g., Cloudflare Turnstile) get a lightweight rrweb injection
   * without console/network/turnstile hooks. The child rrweb auto-detects cross-origin
   * and sends events via PostMessage to the parent, which merges them into the recording.
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
    const iframeScript = getIframeRecordingScript();

    try {
      // Connect raw WebSocket to browser CDP endpoint
      const ws = new WebSocket(wsEndpoint);

      // CRITICAL: Attach error handler synchronously before any async work.
      // If the browser dies during WebSocket handshake, the underlying TCP socket
      // emits 'error' (ECONNRESET). Without an immediate handler, this becomes
      // an uncaughtException that crashes the process (index.ts:12 calls process.exit(1)).
      ws.on('error', (err: Error) => {
        this.log.debug(`Recording WebSocket error: ${err.message}`);
      });

      let cmdId = 1;
      const pendingCommands = new Map<number, { resolve: Function; reject: Function }>();
      const trackedTargets = new Set<string>(); // targets we're collecting events from
      const injectedTargets = new Set<string>(); // targets we've injected rrweb into
      let closed = false;

      // Helper to send CDP command and wait for response.
      // With flatten=true, target commands include sessionId directly on the message.
      // No sendMessageToTarget wrapping needed.
      const sendCommand = (method: string, params: object = {}, cdpSessionId?: string): Promise<any> => {
        return new Promise((resolve, reject) => {
          const id = cmdId++;
          pendingCommands.set(id, { resolve, reject });

          const msg: any = { id, method, params };
          if (cdpSessionId) {
            msg.sessionId = cdpSessionId;
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

      // Map to track our CDP session IDs for each target
      const targetSessions = new Map<string, string>(); // targetId -> cdpSessionId

      /**
       * Re-inject rrweb into a target via Runtime.evaluate.
       * Used as a fallback/safety net — primary injection happens in
       * attachedToTarget via Page.addScriptToEvaluateOnNewDocument.
       */
      const injectRecording = async (targetId: string) => {
        if (injectedTargets.has(targetId)) return;

        const cdpSessionId = targetSessions.get(targetId);
        if (!cdpSessionId) {
          this.log.debug(`No session for target ${targetId}, skipping re-injection`);
          return;
        }

        try {
          injectedTargets.add(targetId);

          // Fallback: inject rrweb via Runtime.evaluate (runs in current document)
          await sendCommand('Runtime.evaluate', {
            expression: script,
            returnByValue: true,
          }, cdpSessionId);

          this.log.info(`Recording re-injected for target ${targetId} (session ${sessionId})`);
        } catch (e) {
          injectedTargets.delete(targetId);
          this.log.debug(`Re-injection failed for target ${targetId}: ${e instanceof Error ? e.message : String(e)}`);
        }
      };

      // Helper to collect events from a target (for main frame polling)
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

          // With flatten=true, target responses come as top-level messages with the
          // command id — they're handled by the id-based resolver above.

          // Handle auto-attached targets — target is PAUSED before any JS runs
          if (msg.method === 'Target.attachedToTarget') {
            const { sessionId: cdpSessionId, targetInfo, waitingForDebugger } = msg.params;

            if (targetInfo.type === 'page') {
              this.log.debug(`Target attached (paused=${waitingForDebugger}): ${targetInfo.targetId}`);
              trackedTargets.add(targetInfo.targetId);
              targetSessions.set(targetInfo.targetId, cdpSessionId);

              // Inject rrweb BEFORE page JS runs (target is paused)
              try {
                await sendCommand('Page.enable', {}, cdpSessionId);
                await sendCommand('Page.addScriptToEvaluateOnNewDocument', {
                  source: script,
                  runImmediately: true,
                }, cdpSessionId);
                injectedTargets.add(targetInfo.targetId);
                this.log.info(`Recording pre-injected for target ${targetInfo.targetId} (session ${sessionId})`);

                // Propagate auto-attach to this page's child targets (iframes).
                // Browser-level setAutoAttach only catches new pages/tabs.
                // Page-level setAutoAttach is needed so cross-origin iframes
                // (e.g., challenges.cloudflare.com) are auto-attached as well.
                await sendCommand('Target.setAutoAttach', {
                  autoAttach: true,
                  waitForDebuggerOnStart: true,
                  flatten: true,
                }, cdpSessionId);
              } catch (e) {
                this.log.debug(`Early injection failed for ${targetInfo.targetId}: ${e instanceof Error ? e.message : String(e)}`);
              }

              // Resume the target — page JS starts AFTER rrweb is installed
              if (waitingForDebugger) {
                await sendCommand('Runtime.runIfWaitingForDebugger', {}, cdpSessionId).catch(() => {});
              }

              // Start screencast on this target (pixel capture alongside rrweb)
              this.screencastCapture.addTarget(sessionId, sendCommand, cdpSessionId).catch(() => {});
            }

            // Cross-origin iframes (e.g., Cloudflare Turnstile challenges.cloudflare.com).
            // Inject lightweight rrweb — no console/network/turnstile hooks that conflict
            // with cross-origin page JS. Events flow via PostMessage to parent rrweb.
            // Not tracked for polling (PostMessage handles delivery to parent).
            if (targetInfo.type === 'iframe') {
              this.log.debug(`Iframe target attached (paused=${waitingForDebugger}): ${targetInfo.targetId} url=${targetInfo.url}`);

              try {
                await sendCommand('Page.enable', {}, cdpSessionId);
                await sendCommand('Page.addScriptToEvaluateOnNewDocument', {
                  source: iframeScript,
                  runImmediately: true,
                }, cdpSessionId);
                this.log.info(`rrweb injected into iframe ${targetInfo.targetId}`);
              } catch (e) {
                this.log.debug(`Iframe injection failed for ${targetInfo.targetId}: ${e instanceof Error ? e.message : String(e)}`);
              }

              // Resume iframe regardless of injection success
              if (waitingForDebugger) {
                await sendCommand('Runtime.runIfWaitingForDebugger', {}, cdpSessionId).catch(() => {});
              }

              // Fallback: explicitly inject iframe rrweb script via Runtime.evaluate.
              // Covers edge case where addScriptToEvaluateOnNewDocument + runImmediately
              // still misses the current document (e.g., context not yet created when paused).
              // The iframe script has a guard (if (window.__browserlessRecording) return;)
              // so double-execution is safe.
              setTimeout(async () => {
                try {
                  await sendCommand('Runtime.evaluate', {
                    expression: iframeScript,
                    returnByValue: true,
                  }, cdpSessionId);
                } catch {
                  // Iframe may have navigated or been destroyed
                }
              }, 50);
            }
          }

          // Handle target destroyed
          if (msg.method === 'Target.targetDestroyed') {
            const { targetId } = msg.params;
            trackedTargets.delete(targetId);
            injectedTargets.delete(targetId);
            // Clean up screencast target
            const cdpSid = targetSessions.get(targetId);
            if (cdpSid) {
              this.screencastCapture.handleTargetDestroyed(sessionId, cdpSid);
            }
          }

          // Handle screencast frames (pixel capture alongside rrweb)
          if (msg.method === 'Page.screencastFrame' && msg.sessionId) {
            this.screencastCapture.handleFrame(
              sessionId,
              msg.sessionId,
              msg.params,
            ).catch(() => {});
          }

          // Handle target info changed (URL navigation)
          // addScriptToEvaluateOnNewDocument persists across navigations on the same
          // session, so rrweb auto-re-injects. This is a safety net — if the persistent
          // script fails, Runtime.evaluate re-injection catches it.
          if (msg.method === 'Target.targetInfoChanged') {
            const { targetInfo } = msg.params;
            if (targetInfo.type === 'page' && trackedTargets.has(targetInfo.targetId)) {
              injectedTargets.delete(targetInfo.targetId);

              // Re-establish setAutoAttach for cross-origin iframes on the new page.
              // While CDP docs say it should persist, this ensures iframes created
              // after navigation (e.g., Turnstile on the Ahrefs page) are always detected.
              const cdpSessionId = targetSessions.get(targetInfo.targetId);
              if (cdpSessionId) {
                sendCommand('Target.setAutoAttach', {
                  autoAttach: true,
                  waitForDebuggerOnStart: true,
                  flatten: true,
                }, cdpSessionId).catch(() => {});
              }

              // Small delay to let the new document initialize before fallback injection
              setTimeout(() => injectRecording(targetInfo.targetId), 200);
            }
          }
        } catch (e) {
          this.log.debug(`Error processing CDP message: ${e}`);
        }
      });

      ws.on('open', async () => {
        try {
          // Use Target.setAutoAttach to pause new targets before any JS runs.
          // This guarantees rrweb's patchAttachShadow is installed before page code
          // calls attachShadow({ mode: 'closed' }).
          //
          // flatten=true: attachedToTarget events arrive as top-level WebSocket messages
          // with a sessionId we can use directly for commands. Required for
          // attachedToTarget to actually fire on our connection.
          //
          // waitForDebuggerOnStart=true: targets pause before JS execution, giving us a
          // window to inject rrweb via Page.addScriptToEvaluateOnNewDocument, then resume.
          await sendCommand('Target.setAutoAttach', {
            autoAttach: true,
            waitForDebuggerOnStart: true,
            flatten: true,
          });

          // Also enable discovery for targetInfoChanged/targetDestroyed events
          await sendCommand('Target.setDiscoverTargets', { discover: true });

          // Initialize screencast capture (parallel to rrweb)
          const recordingsDir = this.sessionReplay?.getRecordingsDir();
          if (recordingsDir) {
            await this.screencastCapture.initSession(sessionId, sendCommand, recordingsDir);
          }

          this.log.debug(`Recording auto-attach enabled for session ${sessionId}`);
        } catch (e) {
          this.log.warn(`Failed to set up recording: ${e}`);
        }
      });

      ws.on('close', () => {
        closed = true;
        pendingCommands.forEach(({ reject }) => reject(new Error('WebSocket closed')));
        pendingCommands.clear();
      });

      // Poll for events periodically (fallback for main frame)
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
   *
   * Stops both rrweb and screencast capture. If screencast captured frames,
   * queues background ffmpeg encoding (returns immediately).
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

    // Stop screencast capture and get frame count
    const frameCount = await this.screencastCapture.stopCapture(sessionId);

    // Stop rrweb recording (includes frame count in metadata)
    const result = await this.sessionReplay.stopRecording(sessionId, {
      ...metadata,
      frameCount,
    });

    return result;
  }

  /**
   * Get the video encoder instance (for cleanup on startup).
   */
  getVideoEncoder(): VideoEncoder {
    return this.videoEncoder;
  }
}
