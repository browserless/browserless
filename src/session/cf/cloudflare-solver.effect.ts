/**
 * Effect-based Cloudflare solve logic.
 *
 * Replaces the imperative while-sleep loops, empty catches, and mutable flag
 * cancellation in CloudflareSolveStrategies with typed Effect generators.
 *
 * This module exports pure Effect functions — no classes, no mutable state.
 * The CloudflareSolver bridge (cloudflare-solver.ts) provides the services
 * via ManagedRuntime and calls these via runtime.runPromise().
 */
import { Effect } from 'effect';
import type { SolveOutcome } from './cloudflare-solve-strategies.js';
import type { ActiveDetection } from './cloudflare-event-emitter.js';
import { TokenChecker, SolverEvents } from './cf-services.js';
import { CdpSessionGone } from './cf-errors.js';

// ═══════════════════════════════════════════════════════════════════════
// solveDetection — top-level dispatcher
// ═══════════════════════════════════════════════════════════════════════

/**
 * Dispatch to the appropriate solve strategy based on CF type.
 *
 * R channel includes TokenChecker + SolverEvents.
 * solveByClicking deliberately does NOT yield TokenChecker,
 * enforcing Rule 1: no Runtime.evaluate before first click.
 */
export const solveDetection = (
  active: ActiveDetection,
  strategies: SolveStrategiesBridge,
) =>
  Effect.fn('cf.solveDetection')(function*() {
    if (active.aborted) return 'aborted' as SolveOutcome;

    const events = yield* SolverEvents;

    switch (active.info.type) {
      case 'managed':
      case 'interstitial': {
        const presence = active.info.type === 'managed'
          ? 0.5 + Math.random() * 1.0
          : 1.5 + Math.random() * 1.5;
        const clicked = yield* solveByClicking(active, presence, strategies);
        if (active.aborted) return 'aborted' as SolveOutcome;
        if (clicked) return 'click_dispatched' as SolveOutcome;

        yield* events.marker(active.pageCdpSessionId, 'cf.waiting_auto_nav', {
          type: active.info.type,
          attempts_exhausted: true,
        });

        yield* waitForAutoNav(active);
        return (active.aborted ? 'aborted' : 'no_click') as SolveOutcome;
      }

      case 'turnstile': {
        const clicked = yield* solveTurnstile(active, strategies);
        return (active.aborted ? 'aborted' : clicked ? 'click_dispatched' : 'no_click') as SolveOutcome;
      }

      case 'non_interactive':
      case 'invisible': {
        yield* solveAutomatic(active, strategies);
        return (active.aborted ? 'aborted' : 'auto_handled') as SolveOutcome;
      }

      case 'block':
        return yield* Effect.die(new Error('block type should not reach solveDetection'));

      default: {
        const _exhaustive: never = active.info.type;
        return yield* Effect.die(new Error(`Unhandled CloudflareType: ${_exhaustive}`));
      }
    }
  })().pipe(
    Effect.catch(() =>
      Effect.gen(function*() {
        if (!active.aborted) {
          const events = yield* SolverEvents;
          yield* events.emitFailed(active, 'solve_exception', Date.now() - active.startTime);
          active.aborted = true;
        }
        return 'aborted' as SolveOutcome;
      }),
    ),
  );

// ═══════════════════════════════════════════════════════════════════════
// solveByClicking — click-based solve for managed/interstitial
//
// Does NOT yield TokenChecker — enforces Rule 1 at compile time:
// no Runtime.evaluate before first click.
// ═══════════════════════════════════════════════════════════════════════

const solveByClicking = (
  active: ActiveDetection,
  _presenceDuration: number,
  strategies: SolveStrategiesBridge,
) =>
  Effect.fn('cf.solveByClicking')(function*() {
    if (active.aborted) return false;

    const events = yield* SolverEvents;
    const maxAttempts = 6;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (active.aborted) return false;

      if (attempt > 0) yield* Effect.sleep('500 millis');

      const result = yield* Effect.tryPromise({
        try: () => strategies.findAndClickViaCDP(active, attempt),
        catch: () => new CdpSessionGone({
          sessionId: active.pageCdpSessionId,
          method: 'findAndClickViaCDP',
        }),
      });

      if (result) {
        yield* events.emitProgress(active, 'cdp_click_complete', { success: true, attempt });
        return true;
      }
    }

    yield* events.emitProgress(active, 'cdp_click_complete', { success: false, attempts: maxAttempts });
    return false;
  })().pipe(
    Effect.catchTag('CdpSessionGone', () => Effect.succeed(false)),
  );

// ═══════════════════════════════════════════════════════════════════════
// solveTurnstile — embedded Turnstile widget solve
//
// TokenChecker is yielded for retry attempts (safe after first click).
// First click attempt uses findAndClickViaCDP only (no Runtime.evaluate).
// ═══════════════════════════════════════════════════════════════════════

const solveTurnstile = (
  active: ActiveDetection,
  strategies: SolveStrategiesBridge,
) =>
  Effect.fn('cf.solveTurnstile')(function*() {
    if (active.aborted) return false;

    const { pageCdpSessionId } = active;
    const events = yield* SolverEvents;
    const tokens = yield* TokenChecker;
    const deadline = Date.now() + 30_000;

    const maxAttempts = 6;
    let clicked = false;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (active.aborted || Date.now() > deadline) return false;

      if (attempt > 0) {
        yield* Effect.sleep('500 millis');

        // Token check on retries only — NEVER on attempt 0.
        // getToken() uses Runtime.evaluate. On attempt 0, CF WASM is monitoring.
        const token = yield* tokens.getToken(pageCdpSessionId).pipe(
          Effect.catchTag('CdpSessionGone', () => Effect.succeed(null)),
        );
        if (token) {
          yield* events.marker(pageCdpSessionId, 'cf.token_polled', { token_length: token.length });
          yield* Effect.tryPromise({
            try: () => strategies.resolveAutoSolved(active, 'token_poll'),
            catch: () => new CdpSessionGone({ sessionId: pageCdpSessionId, method: 'resolveAutoSolved' }),
          }).pipe(Effect.catchTag('CdpSessionGone', () => Effect.void));
          return true;
        }
      }

      const result = yield* Effect.tryPromise({
        try: () => strategies.findAndClickViaCDP(active, attempt),
        catch: () => new CdpSessionGone({ sessionId: pageCdpSessionId, method: 'findAndClickViaCDP' }),
      }).pipe(Effect.catchTag('CdpSessionGone', () => Effect.succeed(false)));

      if (result) {
        yield* events.emitProgress(active, 'cdp_click_complete', { success: true, attempt });
        clicked = true;
        break;
      }
    }

    if (!clicked) {
      yield* events.emitProgress(active, 'cdp_click_complete', { success: false, attempts: maxAttempts });
      yield* events.marker(pageCdpSessionId, 'cf.cdp_no_checkbox');
    }

    if (clicked) {
      return yield* postClickWait(active, deadline, strategies);
    }

    return yield* pollForAutoSolveToken(active, deadline, strategies);
  })();

// ═══════════════════════════════════════════════════════════════════════
// postClickWait — wait for navigation (interstitial) or token (embedded)
// ═══════════════════════════════════════════════════════════════════════

const postClickWait = (
  active: ActiveDetection,
  deadline: number,
  strategies: SolveStrategiesBridge,
) =>
  Effect.fn('cf.postClickWait')(function*() {
    const { pageCdpSessionId } = active;
    const events = yield* SolverEvents;
    const tokens = yield* TokenChecker;

    const postClickDeadline = Math.min(active.startTime + 10_000, deadline);

    // Phase A: Wait up to 3s for page navigation
    const navWaitEnd = Math.min(Date.now() + 3_000, postClickDeadline);
    while (!active.aborted && Date.now() < navWaitEnd) {
      yield* Effect.sleep('200 millis');
    }

    if (active.aborted) return true;

    // Phase B: No navigation → embedded widget. Poll for token.
    while (!active.aborted && Date.now() < postClickDeadline) {
      const token = yield* tokens.getToken(pageCdpSessionId).pipe(
        Effect.catchTag('CdpSessionGone', () => Effect.succeed(null)),
      );
      if (token) {
        yield* events.marker(pageCdpSessionId, 'cf.token_polled', { token_length: token.length });
        yield* Effect.tryPromise({
          try: () => strategies.resolveAutoSolved(active, 'token_poll'),
          catch: () => new CdpSessionGone({ sessionId: pageCdpSessionId, method: 'resolveAutoSolved' }),
        }).pipe(Effect.catchTag('CdpSessionGone', () => Effect.void));
        return true;
      }
      yield* Effect.sleep('300 millis');
    }
    return true;
  })();

// ═══════════════════════════════════════════════════════════════════════
// pollForAutoSolveToken — no-click fallback for non-interactive widgets
// ═══════════════════════════════════════════════════════════════════════

const pollForAutoSolveToken = (
  active: ActiveDetection,
  deadline: number,
  strategies: SolveStrategiesBridge,
) =>
  Effect.fn('cf.pollForAutoSolveToken')(function*() {
    const { pageCdpSessionId } = active;
    const events = yield* SolverEvents;
    const tokens = yield* TokenChecker;

    while (!active.aborted && Date.now() < deadline) {
      yield* Effect.sleep('500 millis');
      if (active.aborted) return false;

      const token = yield* tokens.getToken(pageCdpSessionId).pipe(
        Effect.catchTag('CdpSessionGone', () => Effect.succeed(null)),
      );
      if (token) {
        yield* events.marker(pageCdpSessionId, 'cf.token_polled', { token_length: token.length });
        yield* Effect.tryPromise({
          try: () => strategies.resolveAutoSolved(active, 'token_poll'),
          catch: () => new CdpSessionGone({ sessionId: pageCdpSessionId, method: 'resolveAutoSolved' }),
        }).pipe(Effect.catchTag('CdpSessionGone', () => Effect.void));
        return true;
      }

      if (active.aborted) return false;
    }

    return false;
  })();

// ═══════════════════════════════════════════════════════════════════════
// waitForAutoNav — wait up to 30s for page navigation
// ═══════════════════════════════════════════════════════════════════════

const waitForAutoNav = (active: ActiveDetection) =>
  Effect.fn('cf.waitForAutoNav')(function*() {
    const autoNavDeadline = Date.now() + 30_000;
    while (!active.aborted && Date.now() < autoNavDeadline) {
      yield* Effect.sleep('500 millis');
    }
  })();

// ═══════════════════════════════════════════════════════════════════════
// solveAutomatic — non-interactive/invisible types
// ═══════════════════════════════════════════════════════════════════════

const solveAutomatic = (
  active: ActiveDetection,
  strategies: SolveStrategiesBridge,
) =>
  Effect.fn('cf.solveAutomatic')(function*() {
    if (active.aborted) return;
    const events = yield* SolverEvents;
    yield* events.marker(active.pageCdpSessionId, 'cf.presence_start', { type: active.info.type });
    yield* Effect.tryPromise({
      try: () => strategies.simulatePresence(active),
      catch: () => undefined,
    });
  })();

// ═══════════════════════════════════════════════════════════════════════
// Bridge type — methods that remain on CloudflareSolveStrategies
// ═══════════════════════════════════════════════════════════════════════

export interface SolveStrategiesBridge {
  findAndClickViaCDP(active: ActiveDetection, attempt: number): Promise<boolean>;
  resolveAutoSolved(active: ActiveDetection, signal: string): Promise<void>;
  simulatePresence(active: ActiveDetection): Promise<void>;
}
