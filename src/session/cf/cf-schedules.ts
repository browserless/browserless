/**
 * Schedule definitions for CF solver polling and retry loops.
 *
 * Replaces 4 hand-rolled while-sleep loops with composable,
 * testable Schedule values.
 */
import { Schedule, pipe } from 'effect';

/** Token polling: 300ms fixed interval (post-click token check). */
export const tokenPollSchedule = Schedule.spaced('300 millis');

/** Click retry: 500ms between attempts, max 6 attempts. */
export const clickRetrySchedule = pipe(
  Schedule.spaced('500 millis'),
  Schedule.take(5), // 5 retries after first attempt = 6 total
);

/** Turnstile detection polling: 200ms interval (via Target.getTargets). */
export const detectionPollSchedule = Schedule.spaced('200 millis');

/** Auto-nav wait: 500ms polling while waiting for page navigation. */
export const autoNavWaitSchedule = Schedule.spaced('500 millis');

/** Checkbox polling inside OOPIF: 500ms interval, max 8 attempts. */
export const checkboxPollSchedule = pipe(
  Schedule.spaced('500 millis'),
  Schedule.take(7), // 7 retries after first = 8 total
);

/** Activity loop: 3-7s jittered interval, max 90s total. */
export const activityLoopSchedule = Schedule.both(
  Schedule.jittered(Schedule.spaced('3 seconds')),
  Schedule.during('90 seconds'),
);
