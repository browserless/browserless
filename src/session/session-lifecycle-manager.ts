import {
  BrowserInstance,
  BrowserlessSession,
  Logger,
  RecordingCompleteParams,
  exists,
} from '@browserless.io/browserless';
import { deleteAsync } from 'del';

import { RecordingCoordinator } from './recording-coordinator.js';
import { SessionRegistry } from './session-registry.js';

/**
 * SessionLifecycleManager handles browser session lifecycle.
 *
 * Responsibilities:
 * - TTL timers for keep-alive
 * - Session cleanup (close browser, delete temp dirs)
 * - Recording stop on session close
 *
 * This class is extracted from BrowserManager to reduce its complexity.
 */
export class SessionLifecycleManager {
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private log = new Logger('session-lifecycle');

  constructor(
    private registry: SessionRegistry,
    private recordingCoordinator?: RecordingCoordinator,
  ) {}

  /**
   * Remove a user data directory.
   */
  private async removeUserDataDir(userDataDir: string | null): Promise<void> {
    if (userDataDir && (await exists(userDataDir))) {
      this.log.debug(`Deleting data directory "${userDataDir}"`);
      await deleteAsync(userDataDir, { force: true }).catch((err) => {
        this.log.error(
          `Error cleaning up user-data-dir "${err}" at ${userDataDir}`,
        );
      });
    }
  }

  /**
   * Close a browser session.
   *
   * Handles:
   * - Keep-alive timers
   * - Connection counting
   * - Recording stop
   * - Browser close
   * - Temp directory cleanup
   */
  async close(
    browser: BrowserInstance,
    session: BrowserlessSession,
    force = false,
  ): Promise<void> {
    const now = Date.now();
    const keepUntil = browser.keepUntil();
    const connected = session.numbConnected;
    const hasKeepUntil = keepUntil > now;
    const keepOpen = (connected > 0 || hasKeepUntil) && !force;
    const cleanupActions: Array<() => Promise<void>> = [];
    const priorTimer = this.timers.get(session.id);

    if (priorTimer) {
      this.log.debug(`Deleting prior keep-until timer for "${session.id}"`);
      global.clearTimeout(priorTimer);
    }

    this.log.debug(
      `${session.numbConnected} Client(s) are currently connected, Keep-until: ${keepUntil}, force: ${force}`,
    );

    if (!force && hasKeepUntil) {
      const timeout = keepUntil - now;
      this.log.trace(
        `Setting timer ${timeout.toLocaleString()} for "${session.id}"`,
      );
      this.timers.set(
        session.id,
        global.setTimeout(() => {
          const currentSession = this.registry.get(browser);
          if (currentSession) {
            this.log.trace(`Timer hit for "${currentSession.id}"`);
            this.close(browser, currentSession);
          }
        }, timeout),
      );
    }

    if (!keepOpen) {
      this.log.debug(`Closing browser session`);

      // Stop recording and save if replay was enabled
      // Uses RecordingCoordinator to ensure screencast frames are counted
      if (session.replay && this.recordingCoordinator) {
        const result = await this.recordingCoordinator.stopRecording(session.id, {
          browserType: browser.constructor.name,
          routePath: Array.isArray(session.routePath)
            ? session.routePath[0]
            : session.routePath,
          trackingId: session.trackingId,
        });

        // Inject recording metadata via CDP event BEFORE closing
        // This allows clients (Pydoll) to receive the recording URL
        // without making an additional HTTP call after session close
        if (result && session.trackingId) {
          const recordingMetadata: RecordingCompleteParams = {
            id: result.metadata.id,
            trackingId: session.trackingId,
            duration: result.metadata.duration,
            eventCount: result.metadata.eventCount,
            frameCount: result.metadata.frameCount,
            encodingStatus: result.metadata.encodingStatus,
            // Use external URL for players
            playerUrl: `https://browserless.catchseo.com/recordings/${result.metadata.id}/player`,
            videoPlayerUrl: `https://browserless.catchseo.com/recordings/${result.metadata.id}/video/player`,
          };

          // Check if browser supports CDP event injection (duck typing)
          if ('sendRecordingComplete' in browser && typeof browser.sendRecordingComplete === 'function') {
            try {
              await (browser as { sendRecordingComplete: (m: RecordingCompleteParams) => Promise<void> })
                .sendRecordingComplete(recordingMetadata);
              this.log.info(`Injected recording complete event for ${session.id}`);
            } catch (e) {
              this.log.warn(`Failed to inject recording event: ${e instanceof Error ? e.message : String(e)}`);
            }
          }
        }
      }

      cleanupActions.push(() => browser.close());

      // Always delete session from registry
      this.registry.remove(browser);

      // Only delete temp user data directories
      if (session.isTempDataDir) {
        this.log.debug(
          `Deleting "${session.userDataDir}" temp user-data-dir`,
        );
        cleanupActions.push(() => this.removeUserDataDir(session.userDataDir));
      }

      await Promise.all(cleanupActions.map((a) => a()));
    }
  }

  /**
   * Complete a browser session (WebSocket disconnect).
   */
  async complete(browser: BrowserInstance): Promise<void> {
    const session = this.registry.get(browser);
    if (!session) {
      this.log.debug(
        `Couldn't locate session for browser, proceeding with close`,
      );
      return browser.close();
    }

    const { id, resolver } = session;

    if (id && resolver) {
      resolver(null);
    }

    --session.numbConnected;

    // CRITICAL: Must await close() to ensure session is removed from registry
    // before returning. This method is called when a WebSocket client disconnects.
    await this.close(browser, session);
  }

  /**
   * Kill sessions by ID, trackingId, or 'all'.
   */
  async killSessions(target: string): Promise<void> {
    this.log.debug(`killSessions invoked target: "${target}"`);
    const sessions = this.registry.toArray();
    let closed = 0;

    for (const [browser, session] of sessions) {
      if (
        session.trackingId === target ||
        session.id === target ||
        target === 'all'
      ) {
        this.log.debug(
          `Closing browser via killSessions BrowserId: "${session.id}", trackingId: "${session.trackingId}"`,
        );
        // CRITICAL: Must await close() to ensure session is fully cleaned up
        await this.close(browser, session, true);
        closed++;
      }
    }

    if (closed === 0 && target !== 'all') {
      throw new Error(`Couldn't locate session for id: "${target}"`);
    }
  }

  /**
   * Get the timers map.
   * Useful for testing.
   */
  getTimers(): Map<string, NodeJS.Timeout> {
    return this.timers;
  }

  /**
   * Clear all timers.
   */
  clearTimers(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  /**
   * Shutdown: close all browsers and clear timers.
   */
  async shutdown(): Promise<void> {
    this.log.info('Closing down browser sessions');

    // Close all browsers
    const sessions = this.registry.toArray();
    await Promise.all(sessions.map(([b]) => b.close()));

    // Clear all timers
    this.clearTimers();

    this.log.info('Session lifecycle shutdown complete');
  }
}
