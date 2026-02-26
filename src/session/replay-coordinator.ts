import {
  BrowserInstance,
  Logger,
  SessionReplay,
  StopReplayResult,
  TabReplayCompleteParams,
} from '@browserless.io/browserless';

import type { CdpSessionId, TargetId } from '../shared/cloudflare-detection.js';
import { ScreencastCapture } from './screencast-capture.js';
import { CloudflareSolver } from './cloudflare-solver.js';
import { ReplaySession } from './replay-session.js';
import { VideoEncoder } from '../video/encoder.js';
import type { VideoManager } from '../video/video-manager.js';

/**
 * ReplayCoordinator manages rrweb replay capture across browser sessions.
 *
 * Responsibilities:
 * - Set up CDP protocol listeners for replay capture
 * - Inject rrweb script into pages
 * - Collect events from pages periodically
 * - Handle navigation and new tab events
 *
 * This class is decoupled from BrowserManager - it receives SessionReplay
 * via constructor and uses it for event storage.
 */
/**
 * Per-tab recording result returned by finalizeTab.
 */
export interface StopTabRecordingResult {
  replayId: string;
  duration: number;
  eventCount: number;
  replayUrl: string;
  frameCount: number;
  encodingStatus: string;
  videoUrl: string;
}

export class ReplayCoordinator {
  private log = new Logger('replay-coordinator');
  private screencastCapture = new ScreencastCapture();
  private videoEncoder: VideoEncoder;
  private cloudflareSolvers = new Map<string, CloudflareSolver>();
  private replaySessions = new Map<string, ReplaySession>();
  private baseUrl = process.env.BROWSERLESS_BASE_URL ?? '';
  constructor(private sessionReplay?: SessionReplay, private videoMgr?: VideoManager) {
    this.videoEncoder = new VideoEncoder(sessionReplay?.getStore() ?? null);
    // Expose encoder to VideoManager for on-demand encoding from routes
    videoMgr?.setVideoEncoder(this.videoEncoder);

    // SIGTERM handler: Docker sends SIGTERM before SIGKILL (10s grace).
    // Save all in-flight replay sessions before exit.
    if (sessionReplay) {
      process.once('SIGTERM', async () => {
        this.log.info('SIGTERM received, finalizing replay sessions...');
        try {
          await sessionReplay.stopAllReplays();
        } catch (e) {
          this.log.warn(`SIGTERM stopAllReplays failed: ${e instanceof Error ? e.message : String(e)}`);
        }
        process.exit(0);
      });
    }
  }

  /**
   * Check if replay is enabled.
   */
  isEnabled(): boolean {
    return this.sessionReplay?.isEnabled() ?? false;
  }

  /** Get solver for a session (used by browser-launcher to wire to CDPProxy). */
  getCloudflareSolver(sessionId: string): CloudflareSolver | undefined {
    return this.cloudflareSolvers.get(sessionId);
  }

  /** Route an HTTP beacon to the correct CloudflareSolver.
   *  Supports empty sessionId by broadcasting to all solvers (fallback for
   *  pydoll paths where getSessionInfo returned empty).
   */
  handleCfBeacon(sessionId: string, targetId: string, tokenLength: number): boolean {
    const brandedTargetId = targetId as TargetId;
    if (sessionId) {
      const solver = this.cloudflareSolvers.get(sessionId);
      if (solver) {
        solver.onBeaconSolved(brandedTargetId, tokenLength);
        return true;
      }
      return false;
    }
    // No sessionId — broadcast to all solvers. The solver checks targetId
    // against its own tracking, so only the correct one will act on it.
    let handled = false;
    for (const solver of this.cloudflareSolvers.values()) {
      solver.onBeaconSolved(brandedTargetId, tokenLength);
      handled = true;
    }
    return handled;
  }

  /**
   * Set up replay capture for ALL tabs using RAW CDP (no puppeteer).
   *
   * Creates a ReplaySession that manages the full lifecycle of rrweb capture
   * for this browser session. See replay-session.ts for implementation details.
   */
  async setupReplayForAllTabs(
    browser: BrowserInstance,
    sessionId: string,
    options?: { video?: boolean; onTabReplayComplete?: (metadata: TabReplayCompleteParams) => void },
  ): Promise<void> {
    if (!this.sessionReplay) {
      this.log.debug(`setupReplayForAllTabs: sessionReplay is undefined, returning early`);
      return;
    }

    const wsEndpoint = browser.wsEndpoint();
    if (!wsEndpoint) {
      this.log.debug(`setupReplayForAllTabs: wsEndpoint is null/undefined, returning early`);
      return;
    }

    // Use a mutable ref so the solver's callbacks can reference
    // the session without circular init (solver is created first).
    let sessionRef: ReplaySession | null = null;
    const sendViaSession = (method: string, params?: object, cdpSid?: CdpSessionId, timeoutMs?: number): Promise<any> =>
      sessionRef!.sendCommand(method, params ?? {}, cdpSid, timeoutMs);

    // Create solver for this session (disabled until client enables)
    // injectMarker uses server-side addTabEvents instead of Runtime.evaluate
    // because extension-based recording has no pollEvents() loop to drain
    // the page's events array — markers would only appear at finalization.
    const chromePort = new URL(wsEndpoint).port;
    const cloudflareSolver = new CloudflareSolver(
      sendViaSession,
      (cdpSid: CdpSessionId, tag: string, payload?: object) => {
        sessionRef?.injectMarkerServerSide(cdpSid, tag, payload);
      },
      chromePort,
    );
    this.cloudflareSolvers.set(sessionId, cloudflareSolver);

    const session: ReplaySession = new ReplaySession({
      sessionId,
      wsEndpoint,
      sessionReplay: this.sessionReplay,
      screencastCapture: this.screencastCapture,
      cloudflareSolver,
      baseUrl: this.baseUrl,
      video: options?.video,
      videosDir: this.videoMgr?.getVideosDir(),
      onTabReplayComplete: options?.onTabReplayComplete,
    });
    sessionRef = session;

    try {
      await session.initialize();
    } catch (e) {
      this.log.warn(`Failed to setup replay: ${e instanceof Error ? e.message : String(e)}`);
      this.cloudflareSolvers.delete(sessionId);
      await session.destroy('error').catch(() => {});
      return;
    }

    this.replaySessions.set(sessionId, session);

    this.sessionReplay.registerCleanupFn(sessionId, async () => {
      this.cloudflareSolvers.delete(sessionId);
      this.replaySessions.delete(sessionId);
      await session.destroy('cleanup');
    });
    this.sessionReplay.registerFinalCollector(sessionId, () => session.collectAllEvents());
  }

  /**
   * Start replay capture for a session.
   */
  startReplay(sessionId: string, trackingId?: string): void {
    this.sessionReplay?.startReplay(sessionId, trackingId);
    this.log.debug(`Started replay capture for session ${sessionId}`);
  }

  /**
   * Stop replay capture for a session.
   * Returns both filepath and metadata for CDP event injection.
   *
   * Stops both rrweb and screencast capture. If screencast captured frames,
   * queues background ffmpeg encoding (returns immediately).
   */
  async stopReplay(
    sessionId: string,
    metadata?: {
      browserType?: string;
      routePath?: string;
      trackingId?: string;
    }
  ): Promise<StopReplayResult | null> {
    if (!this.sessionReplay) return null;

    // Stop screencast capture and get frame count
    const frameCount = await this.screencastCapture.stopCapture(sessionId);

    // Stop rrweb replay capture (includes frame count in metadata)
    const result = await this.sessionReplay.stopReplay(sessionId, {
      ...metadata,
      frameCount,
    });

    return result;
  }

  /**
   * Get a callback that returns the current target count for a session.
   * Used by CDPProxy to enforce per-session tab limits.
   */
  getTabCountCallback(sessionId: string): (() => number) | undefined {
    const session = this.replaySessions.get(sessionId);
    if (!session) return undefined;
    return () => session.getTargetCount();
  }

  /**
   * Create a callback for Browserless.addReplayMarker CDP command.
   * Returns a function that injects markers by targetId, or undefined if no session.
   */
  getReplayMarkerCallback(sessionId: string): ((targetId: TargetId, tag: string, payload?: object) => void) | undefined {
    const session = this.replaySessions.get(sessionId);
    if (!session) return undefined;
    return (targetId, tag, payload) => session.injectMarkerByTargetId(targetId, tag, payload);
  }

  /**
   * Get the video encoder instance (for cleanup on startup).
   */
  getVideoEncoder(): VideoEncoder {
    return this.videoEncoder;
  }
}
