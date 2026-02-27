/**
 * Service definitions for the CF solver Effect layer.
 *
 * Replaces setter injection (setSendViaProxy, setGetTabCount)
 * with typed services that are provided via Layer at construction time.
 *
 * Service scope restriction enforces safety rules at compile time:
 *   - firstClickAttempt only has CdpSender (no TokenChecker → no Runtime.evaluate)
 *   - retryClickAttempt has CdpSender + TokenChecker (safe after first click)
 */
import type { Effect } from 'effect';
import { ServiceMap } from 'effect';
import type { CdpSessionId, CloudflareResult } from '../../shared/cloudflare-detection.js';
import type { CdpSessionGone, CdpTimeout } from './cf-errors.js';
import type { ActiveDetection } from './cloudflare-event-emitter.js';

// ═══════════════════════════════════════════════════════════════════════
// CdpSender — send CDP commands to browser/page/OOPIF sessions
// ═══════════════════════════════════════════════════════════════════════

export const CdpSender = ServiceMap.Service<{
  /** Send a CDP command via the direct (page-level) WS. */
  readonly send: (
    method: string,
    params?: object,
    sessionId?: CdpSessionId,
    timeoutMs?: number,
  ) => Effect.Effect<any, CdpSessionGone | CdpTimeout>;

  /** Send via proxy WS (CDPProxy's browser WS). Falls back to direct send. */
  readonly sendViaProxy: (
    method: string,
    params?: object,
    sessionId?: CdpSessionId,
    timeoutMs?: number,
  ) => Effect.Effect<any, CdpSessionGone | CdpTimeout>;
}>('CdpSender');

// ═══════════════════════════════════════════════════════════════════════
// TokenChecker — getToken/isSolved via Runtime.evaluate
//
// NOT available in firstClickAttempt's R channel.
// Available in retryClickAttempt (safe after first click).
// ═══════════════════════════════════════════════════════════════════════

export const TokenChecker = ServiceMap.Service<{
  /** Get Turnstile token from page. Uses Runtime.evaluate — NEVER call before first click. */
  readonly getToken: (sessionId: CdpSessionId) => Effect.Effect<string | null, CdpSessionGone>;
  /** Check if Turnstile is solved. Uses Runtime.evaluate — NEVER call before first click. */
  readonly isSolved: (sessionId: CdpSessionId) => Effect.Effect<boolean, CdpSessionGone>;
  /** Check widget error state. */
  readonly isWidgetError: (sessionId: CdpSessionId) => Effect.Effect<{ type: string; has_token: boolean } | null, CdpSessionGone>;
  /** Re-run CF detection to check for false positives. */
  readonly isStillDetected: (sessionId: CdpSessionId) => Effect.Effect<boolean, CdpSessionGone>;
}>('TokenChecker');

// ═══════════════════════════════════════════════════════════════════════
// SolverEvents — emit detection/solve/fail events + recording markers
// ═══════════════════════════════════════════════════════════════════════

export const SolverEvents = ServiceMap.Service<{
  readonly emitDetected: (active: ActiveDetection) => Effect.Effect<void>;
  readonly emitProgress: (active: ActiveDetection, state: string, extra?: Record<string, any>) => Effect.Effect<void>;
  readonly emitSolved: (active: ActiveDetection, result: CloudflareResult) => Effect.Effect<void>;
  readonly emitFailed: (active: ActiveDetection, reason: string, duration: number, phaseLabel?: string) => Effect.Effect<void>;
  readonly marker: (sessionId: CdpSessionId, tag: string, payload?: object) => Effect.Effect<void>;
}>('SolverEvents');
