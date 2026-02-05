import {
  BrowserInstance,
  BrowserlessSession,
  Logger,
  ReplayCompleteParams,
  exists,
  isReplayCapable,
} from '@browserless.io/browserless';
import { deleteAsync } from 'del';

import { ReplayCoordinator } from './replay-coordinator.js';
import { SessionRegistry } from './session-registry.js';

/**
 * SessionLifecycleManager handles browser session lifecycle.
 *
 * Responsibilities:
 * - TTL timers for keep-alive
 * - Session cleanup (close browser, delete temp dirs)
 * - Replay stop on session close
 *
 * This class is extracted from BrowserManager to reduce its complexity.
 */
export class SessionLifecycleManager {
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private log = new Logger('session-lifecycle');
  private baseUrl = process.env.BROWSERLESS_BASE_URL ?? '';

  constructor(
    private registry: SessionRegistry,
    private replayCoordinator?: ReplayCoordinator,
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
   * - Replay stop
   * - Browser close
   * - Temp directory cleanup
   */
  async close(
    browser: BrowserInstance,
    session: BrowserlessSession,
    force = false,
  ): Promise<ReplayCompleteParams | null> {
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

    let replayMetadata: ReplayCompleteParams | null = null;

    if (!keepOpen) {
      this.log.debug(`Closing browser session`);

      // Stop replay and save if replay was enabled
      // Uses ReplayCoordinator to ensure screencast frames are counted
      if (session.replay && this.replayCoordinator) {
        const result = await this.replayCoordinator.stopReplay(session.id, {
          browserType: browser.constructor.name,
          routePath: Array.isArray(session.routePath)
            ? session.routePath[0]
            : session.routePath,
          trackingId: session.trackingId,
        });

        if (result) {
          replayMetadata = {
            id: result.metadata.id,
            duration: result.metadata.duration,
            eventCount: result.metadata.eventCount,
            frameCount: result.metadata.frameCount,
            encodingStatus: result.metadata.encodingStatus,
            replayUrl: `${this.baseUrl}/replay/${result.metadata.id}`,
            ...(session.trackingId ? { trackingId: session.trackingId } : {}),
            ...(result.metadata.frameCount > 0 && {
              videoUrl: `${this.baseUrl}/video/${result.metadata.id}`,
            }),
          };

          // Send replay metadata via CDP event before browser closes
          // WebSocket TCP ordering guarantees client receives this before close
          if (isReplayCapable(browser)) {
            try {
              const sent = await browser.sendReplayComplete(replayMetadata);
              if (sent) {
                this.log.info(`Injected replay complete event for ${session.id}`);
              } else {
                this.log.warn(`Replay complete not sent for ${session.id} (no proxy)`);
              }
            } catch (e) {
              this.log.warn(`Failed to inject replay event: ${e instanceof Error ? e.message : String(e)}`);
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

    return replayMetadata;
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
  async killSessions(target: string): Promise<ReplayCompleteParams[]> {
    this.log.debug(`killSessions invoked target: "${target}"`);
    const sessions = this.registry.toArray();
    const results: ReplayCompleteParams[] = [];
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
        const metadata = await this.close(browser, session, true);
        if (metadata) results.push(metadata);
        closed++;
      }
    }

    if (closed === 0 && target !== 'all') {
      throw new Error(`Couldn't locate session for id: "${target}"`);
    }

    return results;
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
