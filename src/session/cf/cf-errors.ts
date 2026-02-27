/**
 * Typed error classes for Cloudflare solver.
 *
 * Each error has a `_tag` discriminant, enabling Effect.catchTag()
 * to handle specific failure modes at compile time. Replaces ~12
 * empty catches that silently swallow failures.
 */
import { Schema } from 'effect';
import { CdpSessionId, TargetId } from '../../shared/cloudflare-detection.js';

/** CDP session disappeared (page navigated, tab closed, OOPIF detached). */
export class CdpSessionGone extends Schema.TaggedErrorClass<CdpSessionGone>()(
  'CdpSessionGone', {
    sessionId: CdpSessionId,
    method: Schema.String,
  }
) {}

/** CDP command timed out (Chrome under load, renderer stalled). */
export class CdpTimeout extends Schema.TaggedErrorClass<CdpTimeout>()(
  'CdpTimeout', {
    method: Schema.String,
    timeoutMs: Schema.Number,
  }
) {}

/** Overall solve deadline exceeded (attemptTimeout from config). */
export class SolveDeadlineExceeded extends Schema.TaggedErrorClass<SolveDeadlineExceeded>()(
  'SolveDeadlineExceeded', {
    targetId: TargetId,
    elapsedMs: Schema.Number,
  }
) {}

/** Turnstile checkbox not found after all polling attempts. */
export class WidgetNotFound extends Schema.TaggedErrorClass<WidgetNotFound>()(
  'WidgetNotFound', {
    targetId: TargetId,
    pollCount: Schema.Number,
  }
) {}

/** CF re-served a challenge after our solve attempt. Always a failure. */
export class Rechallenge extends Schema.TaggedErrorClass<Rechallenge>()(
  'Rechallenge', {
    targetId: TargetId,
    attemptCount: Schema.Number,
    previousMethod: Schema.String,
  }
) {}
