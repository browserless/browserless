import { Effect, Fiber, Layer, ManagedRuntime } from 'effect';
import type { CdpSessionId, TargetId, CloudflareConfig } from '../shared/cloudflare-detection.js';
import { CloudflareDetector } from './cf/cloudflare-detector.js';
import { CloudflareSolveStrategies } from './cf/cloudflare-solve-strategies.js';
import { CloudflareStateTracker } from './cf/cloudflare-state-tracker.js';
import { CloudflareEventEmitter } from './cf/cloudflare-event-emitter.js';
import type { EmitClientEvent, InjectMarker, ActiveDetection } from './cf/cloudflare-event-emitter.js';
import type { SendCommand } from './cf/cloudflare-state-tracker.js';
import { CdpSender, TokenChecker, SolverEvents } from './cf/cf-services.js';
import { CdpSessionGone } from './cf/cf-errors.js';
import { solveDetection as solveDetectionEffect } from './cf/cloudflare-solver.effect.js';
import type { SolveOutcome } from './cf/cloudflare-solve-strategies.js';
import { simulateHumanPresence } from '../shared/mouse-humanizer.js';
import { Logger } from '@browserless.io/browserless';

/**
 * Cloudflare detection and solving for a single browser session.
 *
 * Thin delegator — preserves the identical public interface that ReplaySession,
 * ReplayCoordinator, and BrowsersCDP depend on.
 *
 * Phase 1 change: solveDetection() now runs through Effect via ManagedRuntime.
 * The detector and strategies still use plain TypeScript. The Effect solver
 * calls back into strategies for complex CDP/WS plumbing (findAndClickViaCDP).
 */
export class CloudflareSolver {
  private detector: CloudflareDetector;
  private strategies: CloudflareSolveStrategies;
  private stateTracker: CloudflareStateTracker;
  private events: CloudflareEventEmitter;
  private sendCommand: SendCommand;
  private sendViaProxy: SendCommand | null = null;
  private _setRealEmit: (fn: EmitClientEvent) => void;
  private detectionFibers = new Map<TargetId, Fiber.Fiber<void>>();
  private log = new Logger('cf-solver');
  // Type safety is inside the Effect solver — the runtime is just a bridge.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private runtime: any = null;

  constructor(sendCommand: SendCommand, injectMarker: InjectMarker, chromePort?: string) {
    this.sendCommand = sendCommand;
    // Mutable closure: emitClientEvent is set after construction by replay-session.ts
    let realEmit: EmitClientEvent = async () => {};
    this.events = new CloudflareEventEmitter(injectMarker, (...args) => realEmit(...args));
    this._setRealEmit = (fn) => { realEmit = fn; };
    this.stateTracker = new CloudflareStateTracker(sendCommand, this.events);
    this.strategies = new CloudflareSolveStrategies(sendCommand, this.events, chromePort);
    this.detector = new CloudflareDetector(sendCommand, this.events, this.stateTracker, this.strategies);

    // Override strategies.solveDetection to route through Effect
    this.strategies.solveDetection = (active: ActiveDetection) => this.solveViaEffect(active);

    // Wire OOPIF state check — activity loop calls this to check iframe widget state via CDP DOM walk
    this.stateTracker.checkOOPIFState = (iframeCdpSessionId) =>
      this.strategies.checkOOPIFStateViaCDP(iframeCdpSessionId);

    // Wire fiber-based detection loop callback
    this.detector.setStartDetectionLoop(
      (targetId, cdpSessionId) => this.startDetectionFiber(targetId, cdpSessionId),
    );

    // Build the Effect runtime with service layers
    this.runtime = ManagedRuntime.make(this.buildLayer());
  }

  /**
   * Build the Layer that provides all services to the Effect solver.
   * Wraps existing imperative objects (sendCommand, stateTracker, events)
   * as Effect services — no behavior change, just typed wrapping.
   */
  private buildLayer() {
    const sendCommand = this.sendCommand;
    const stateTracker = this.stateTracker;
    const events = this.events;
    const self = this;

    const cdpSenderLayer = Layer.succeed(CdpSender, CdpSender.of({
      send: (method, params, sessionId, timeoutMs) =>
        Effect.tryPromise({
          try: () => sendCommand(method, params, sessionId, timeoutMs),
          catch: () => new CdpSessionGone({
            sessionId: sessionId ?? ('' as CdpSessionId),
            method,
          }),
        }),
      sendViaProxy: (method, params, sessionId, timeoutMs) =>
        Effect.tryPromise({
          try: () => (self.sendViaProxy || sendCommand)(method, params, sessionId, timeoutMs),
          catch: () => new CdpSessionGone({
            sessionId: sessionId ?? ('' as CdpSessionId),
            method,
          }),
        }),
    }));

    const tokenCheckerLayer = Layer.succeed(TokenChecker, TokenChecker.of({
      getToken: (sessionId) => stateTracker.getTokenEffect(sessionId),
      isSolved: (sessionId) => stateTracker.isSolvedEffect(sessionId),
      isWidgetError: (sessionId) => stateTracker.isWidgetErrorEffect(sessionId),
      isStillDetected: (sessionId) => stateTracker.isStillDetectedEffect(sessionId),
    }));

    const solverEventsLayer = Layer.succeed(SolverEvents, SolverEvents.of({
      emitDetected: (active) => Effect.sync(() => events.emitDetected(active)),
      emitProgress: (active, state, extra) => Effect.sync(() => events.emitProgress(active, state, extra)),
      emitSolved: (active, result) => Effect.sync(() => events.emitSolved(active, result)),
      emitFailed: (active, reason, duration, phaseLabel) =>
        Effect.sync(() => events.emitFailed(active, reason, duration, phaseLabel)),
      marker: (sessionId, tag, payload) => Effect.sync(() => events.marker(sessionId, tag, payload)),
    }));

    return Layer.mergeAll(cdpSenderLayer, tokenCheckerLayer, solverEventsLayer);
  }

  /**
   * Run Effect-based solveDetection via ManagedRuntime.
   * Returns the same Promise<SolveOutcome> the detector expects.
   */
  private async solveViaEffect(active: ActiveDetection): Promise<SolveOutcome> {
    if (!this.runtime) return 'aborted';

    const bridge = {
      findAndClickViaCDP: (a: ActiveDetection, attempt: number) =>
        this.strategies.findAndClickViaCDPDirect(a, attempt),
      resolveAutoSolved: (a: ActiveDetection, signal: string) =>
        this.stateTracker.resolveAutoSolved(a, signal),
      simulatePresence: async (a: ActiveDetection) => {
        await simulateHumanPresence(this.sendCommand, a.pageCdpSessionId, 2.0 + Math.random() * 2.0);
      },
    };

    return this.runtime.runPromise(solveDetectionEffect(active, bridge));
  }

  setEmitClientEvent(fn: EmitClientEvent): void {
    this._setRealEmit(fn);
  }

  /** Interrupt and stop the detection fiber for a target (e.g. on tab close). */
  stopTargetDetection(targetId: TargetId): void {
    this.stopDetectionFiber(targetId);
  }

  private startDetectionFiber(targetId: TargetId, cdpSessionId: CdpSessionId): void {
    if (!this.runtime) {
      this.log.warn(`startDetectionFiber: no runtime, target=${targetId}`);
      return;
    }
    const existing = this.detectionFibers.get(targetId);
    if (existing) {
      this.runtime.runPromise(Fiber.interrupt(existing)).catch(() => {});
    }
    // Use runFork (root fiber) — NOT runPromise(forkChild) which creates a scoped
    // fiber that gets interrupted when runPromise's scope closes.
    const fiber = this.runtime.runFork(
      this.detector.detectTurnstileWidgetEffect(targetId, cdpSessionId)
    );
    this.detectionFibers.set(targetId, fiber);
  }

  private stopDetectionFiber(targetId: TargetId): void {
    const fiber = this.detectionFibers.get(targetId);
    if (fiber) {
      this.detectionFibers.delete(targetId);
      if (this.runtime) {
        this.runtime.runPromise(Fiber.interrupt(fiber)).catch(() => {});
      }
    }
  }

  setSendViaProxy(fn: SendCommand): void {
    this.sendViaProxy = fn;
    this.strategies.setSendViaProxy(fn);
  }

  enable(config?: CloudflareConfig): void {
    this.detector.enable(config);
  }

  isEnabled(): boolean {
    return this.detector.isEnabled();
  }

  async onPageAttached(targetId: TargetId, cdpSessionId: CdpSessionId, url: string): Promise<void> {
    return this.detector.onPageAttached(targetId, cdpSessionId, url);
  }

  async onPageNavigated(targetId: TargetId, cdpSessionId: CdpSessionId, url: string): Promise<void> {
    return this.detector.onPageNavigated(targetId, cdpSessionId, url);
  }

  async onIframeAttached(
    iframeTargetId: TargetId, iframeCdpSessionId: CdpSessionId,
    url: string, parentCdpSessionId: CdpSessionId,
  ): Promise<void> {
    return this.detector.onIframeAttached(iframeTargetId, iframeCdpSessionId, url, parentCdpSessionId);
  }

  async onIframeNavigated(
    iframeTargetId: TargetId, iframeCdpSessionId: CdpSessionId, url: string,
  ): Promise<void> {
    return this.detector.onIframeNavigated(iframeTargetId, iframeCdpSessionId, url);
  }

  async onAutoSolveBinding(cdpSessionId: CdpSessionId): Promise<void> {
    return this.stateTracker.onAutoSolveBinding(cdpSessionId);
  }

  onBeaconSolved(targetId: TargetId, tokenLength: number): void {
    return this.stateTracker.onBeaconSolved(targetId, tokenLength);
  }

  emitUnresolvedDetections(): void {
    return this.stateTracker.emitUnresolvedDetections();
  }

  /** Destroy — disposes ManagedRuntime (interrupts all fibers including detection loops). */
  destroy(): void {
    this.detectionFibers.clear();
    this.stateTracker.destroy();
    if (this.runtime) {
      this.runtime.dispose();
      this.runtime = null;
    }
  }
}
