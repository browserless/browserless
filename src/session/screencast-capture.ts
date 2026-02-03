import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

import { Logger } from '@browserless.io/browserless';

/**
 * CDP Screencast frame capture per session.
 *
 * Uses the existing raw WebSocket connection to the browser (same pattern as
 * replay-coordinator.ts) to capture pixel-perfect video frames.
 *
 * Per tab:
 * - Page.startScreencast sends PNG frames when the page visually changes
 * - Static page fallback: if no frame arrives in 2 seconds, fire
 *   Page.captureScreenshot (handles Turnstile "Just a moment..." pages)
 * - Frames saved as {timestamp_ms}.png in {replaysDir}/{sessionId}/frames/
 *
 * Frame acknowledgment (Page.screencastFrameAck) tells Chrome to send the
 * next frame. Without ack, Chrome stops sending frames.
 */

type SendCommand = (method: string, params: object, cdpSessionId?: string) => Promise<unknown>;

interface CaptureSession {
  sessionId: string;
  framesDir: string;
  frameCount: number;
  /** Timer for static page fallback screenshots */
  fallbackTimer: ReturnType<typeof setTimeout> | null;
  /** CDP session IDs we're capturing from */
  activeTargets: Set<string>;
  /** Reference to the WebSocket sendCommand for this session */
  sendCommand: SendCommand;
  stopped: boolean;
}

export class ScreencastCapture {
  private log = new Logger('screencast-capture');
  private sessions = new Map<string, CaptureSession>();

  /** Screencast resolution settings */
  private readonly maxWidth = 1280;
  private readonly maxHeight = 720;
  private readonly fallbackIntervalMs = 2000;

  /**
   * Initialize screencast capture for a session.
   *
   * Called by ReplayCoordinator when a replay session starts.
   * Creates the frames directory and stores the sendCommand reference.
   */
  async initSession(
    sessionId: string,
    sendCommand: SendCommand,
    replaysDir: string,
  ): Promise<void> {
    const framesDir = path.join(replaysDir, sessionId, 'frames');
    await mkdir(framesDir, { recursive: true });

    this.sessions.set(sessionId, {
      sessionId,
      framesDir,
      frameCount: 0,
      fallbackTimer: null,
      activeTargets: new Set(),
      sendCommand,
      stopped: false,
    });

    this.log.debug(`Screencast session initialized: ${sessionId}`);
  }

  /**
   * Add a target to an existing capture session and start screencast on it.
   *
   * Called by ReplayCoordinator when a new page target is auto-attached
   * (after rrweb injection and target resume).
   */
  async addTarget(
    sessionId: string,
    sendCommand: SendCommand,
    cdpSessionId: string,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || session.stopped) return;

    try {
      await sendCommand('Page.startScreencast', {
        format: 'png',
        maxWidth: this.maxWidth,
        maxHeight: this.maxHeight,
      }, cdpSessionId);

      session.activeTargets.add(cdpSessionId);
      this.resetFallbackTimer(session, cdpSessionId);

      this.log.debug(`Screencast started on target (session ${sessionId})`);
    } catch (e) {
      this.log.debug(`Failed to start screencast: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * Handle a screencast frame event from CDP.
   *
   * Called from the replay-coordinator's WebSocket message handler when
   * a Page.screencastFrame event arrives.
   *
   * Flow:
   * 1. Write PNG data to disk
   * 2. Acknowledge frame (tells Chrome to send next one)
   * 3. Reset fallback timer (page is active)
   */
  async handleFrame(
    sessionId: string,
    cdpSessionId: string,
    params: { data: string; metadata: { timestamp: number }; sessionId: number },
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || session.stopped) return;

    try {
      // Write frame to disk
      const timestamp = Math.round(params.metadata.timestamp * 1000);
      const framePath = path.join(session.framesDir, `${timestamp}.png`);
      await writeFile(framePath, Buffer.from(params.data, 'base64'));
      session.frameCount++;

      // Acknowledge frame so Chrome sends the next one
      await session.sendCommand('Page.screencastFrameAck', {
        sessionId: params.sessionId,
      }, cdpSessionId).catch(() => {});

      // Reset fallback timer — page is sending frames
      this.resetFallbackTimer(session, cdpSessionId);
    } catch (e) {
      this.log.debug(`Frame write failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * Reset the static page fallback timer.
   *
   * If no screencast frame arrives within fallbackIntervalMs, fire a
   * Page.captureScreenshot. This handles pages like Turnstile's
   * "Just a moment..." where nothing visually changes.
   */
  private resetFallbackTimer(session: CaptureSession, cdpSessionId: string): void {
    if (session.fallbackTimer) {
      clearTimeout(session.fallbackTimer);
    }

    session.fallbackTimer = setTimeout(async () => {
      if (session.stopped) return;

      try {
        const result = await session.sendCommand('Page.captureScreenshot', {
          format: 'png',
        }, cdpSessionId) as { data?: string } | undefined;

        if (result?.data) {
          const timestamp = Date.now();
          const framePath = path.join(session.framesDir, `${timestamp}.png`);
          await writeFile(framePath, Buffer.from(result.data, 'base64'));
          session.frameCount++;
          this.log.debug(`Fallback screenshot captured for session ${session.sessionId}`);
        }
      } catch {
        // Target may be closed or navigating
      }

      // Schedule next fallback if still active
      if (!session.stopped) {
        this.resetFallbackTimer(session, cdpSessionId);
      }
    }, this.fallbackIntervalMs);
  }

  /**
   * Stop screencast capture for a session.
   * Returns the frame count for metadata.
   */
  async stopCapture(sessionId: string): Promise<number> {
    const session = this.sessions.get(sessionId);
    if (!session) return 0;

    session.stopped = true;

    // Clear fallback timer
    if (session.fallbackTimer) {
      clearTimeout(session.fallbackTimer);
      session.fallbackTimer = null;
    }

    // Stop screencast on all active targets
    for (const cdpSessionId of session.activeTargets) {
      try {
        await session.sendCommand('Page.stopScreencast', {}, cdpSessionId);
      } catch {
        // Target may already be closed
      }
    }

    const frameCount = session.frameCount;
    this.sessions.delete(sessionId);

    this.log.info(`Screencast stopped for session ${sessionId}: ${frameCount} frames`);
    return frameCount;
  }

  /**
   * Handle target destroyed event — remove from active targets.
   */
  handleTargetDestroyed(sessionId: string, cdpSessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.activeTargets.delete(cdpSessionId);
    }
  }

  /**
   * Check if a session is being captured.
   */
  isCapturing(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    return !!session && !session.stopped;
  }

  /**
   * Get frame count for a session.
   */
  getFrameCount(sessionId: string): number {
    return this.sessions.get(sessionId)?.frameCount ?? 0;
  }
}
