/**
 * Schedule and delay constants for CF solver polling and retry loops.
 *
 * activityLoopSchedule — used with Effect.repeat in the activity loop.
 * Named delay constants — replace magic strings in solver for-loops
 * that can't use Effect.repeat (complex break conditions).
 */
import { Schedule } from 'effect';

// ── Schedule (used with Effect.repeat) ───────────────────────────────

/** Activity loop: jittered ~3s interval, max 90s total. */
export const activityLoopSchedule = Schedule.both(
  Schedule.jittered(Schedule.spaced('3 seconds')),
  Schedule.during('90 seconds'),
);

// ── Named delay constants (for imperative for-loops) ─────────────────

/** Click retry: delay between findAndClickViaCDP attempts. */
export const CLICK_RETRY_DELAY = '500 millis' as const;

/** Token polling: post-click token check interval. */
export const TOKEN_POLL_DELAY = '300 millis' as const;

/** Turnstile detection polling: Target.getTargets interval. */
export const DETECTION_POLL_DELAY = '200 millis' as const;

/** Auto-nav wait: polling interval while waiting for page navigation. */
export const AUTO_NAV_WAIT_DELAY = '500 millis' as const;

/** Auto-solve token polling: fallback no-click token check interval. */
export const AUTO_SOLVE_POLL_DELAY = '500 millis' as const;
