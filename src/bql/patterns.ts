import { BadRequest } from '@browserless.io/browserless';
import { RE2JS } from 're2js';
import { Worker } from 'node:worker_threads';
import micromatch from 'micromatch';

export function compileRE2(pattern: string, flags = 0): RE2JS {
  if (pattern.length > 200) throw new BadRequest('Regex is too long');
  try {
    return RE2JS.compile(pattern, flags);
  } catch {
    throw new BadRequest('Regex is invalid or unsupported');
  }
}

// Fixed worker code; patterns and URLs are data, never interpolated as code.
const workerSource = `
  const { parentPort } = require('node:worker_threads');
  parentPort.on('message', ({pattern, value, started}) => {
    const regex = new RegExp(pattern);
    Atomics.store(started, 0, 1);
    parentPort.postMessage(regex.test(value));
  });
`;
const regexSlots: Array<{ worker?: Worker; busy: boolean }> = [
  { busy: false },
  { busy: false },
];
const regexDeadlineMs = 1000;
export const interceptionBudget = (session: symbol) => ({
  session,
  deadline: performance.now() + regexDeadlineMs,
});
type RegexBudget = ReturnType<typeof interceptionBudget>;
type WorkerResult = boolean | 'timed-out' | undefined;
type RegexJob = {
  pattern: string;
  value: string;
  deadline: number;
  resolve: (result: WorkerResult) => void;
  timer: NodeJS.Timeout;
};
const pendingRegexJobs = new Map<symbol | undefined, RegexJob[]>();
let pendingCount = 0;

function dispatchRegexJobs() {
  for (const slot of regexSlots) {
    if (slot.busy) continue;
    const next = pendingRegexJobs.entries().next();
    if (next.done) return;
    const [session, queue] = next.value;
    const job = queue.shift()!;
    pendingCount--;
    // A busy session gets one turn before yielding to other queued sessions.
    pendingRegexJobs.delete(session);
    if (queue.length) pendingRegexJobs.set(session, queue);
    clearTimeout(job.timer);
    slot.busy = true;
    void runRegexJob(slot, job).finally(() => {
      slot.busy = false;
      dispatchRegexJobs();
    });
  }
}

async function runRegexJob(slot: (typeof regexSlots)[number], job: RegexJob) {
  const remaining = job.deadline - performance.now();
  if (remaining <= 0) return job.resolve(undefined);
  const started = new Int32Array(new SharedArrayBuffer(4));
  let timer: NodeJS.Timeout | undefined;
  let result: WorkerResult;
  try {
    const worker = (slot.worker ??= new Worker(workerSource, {
      eval: true,
      execArgv: [],
      resourceLimits: {
        maxOldGenerationSizeMb: 60,
        maxYoungGenerationSizeMb: 4,
        stackSizeMb: 4,
      },
    }));
    if (!worker.listenerCount('exit')) {
      worker.on('error', () => {});
      worker.once('exit', () => {
        if (slot.worker === worker) slot.worker = undefined;
      });
    }
    worker.ref();
    let stopped: () => void = () => {};
    try {
      result = await new Promise<WorkerResult>((resolve) => {
        stopped = () => resolve(undefined);
        worker.once('message', resolve);
        worker.once('exit', stopped);
        timer = setTimeout(
          () => resolve(Atomics.load(started, 0) ? 'timed-out' : undefined),
          Math.max(0, Math.ceil(job.deadline - performance.now())),
        );
        worker.postMessage({ pattern: job.pattern, value: job.value, started });
      });
    } finally {
      worker.off('exit', stopped);
    }
  } catch {
    // A startup or worker failure is not a syntax error or a match.
  } finally {
    clearTimeout(timer);
    job.resolve(result);
    const worker = slot.worker;
    if (typeof result === 'boolean') {
      worker?.unref();
    } else {
      slot.worker = undefined;
      // Do not reuse the slot until the old worker actually stops.
      await worker?.terminate().catch(() => {});
    }
  }
}

function testInWorker(pattern: string, value: string, budget?: RegexBudget) {
  const session = budget?.session;
  const deadline = budget?.deadline ?? performance.now() + regexDeadlineMs;
  const remaining = deadline - performance.now();
  const queue = pendingRegexJobs.get(session) ?? [];
  if (
    remaining <= 0 ||
    pendingCount >= 1024 ||
    queue.length >= (budget ? 384 : 128)
  )
    return Promise.resolve(undefined);
  return new Promise<WorkerResult>((resolve) => {
    const job: RegexJob = {
      pattern,
      value,
      deadline,
      resolve,
      timer: setTimeout(() => {
        const index = queue.indexOf(job);
        if (index < 0) return;
        queue.splice(index, 1);
        pendingCount--;
        if (!queue.length) pendingRegexJobs.delete(session);
        resolve(undefined);
      }, Math.ceil(remaining)),
    };
    queue.push(job);
    pendingCount++;
    pendingRegexJobs.set(session, queue);
    dispatchRegexJobs();
  });
}

export type NetworkRegex = {
  test(
    value: string,
    budget?: RegexBudget,
  ): boolean | undefined | Promise<boolean | undefined>;
  cachedTest?(value: string): boolean;
};

export function compileRegex(pattern: string): NetworkRegex {
  if (pattern.length > 200) throw new BadRequest('Regex is too long');
  try {
    return RE2JS.compile(pattern);
  } catch {
    // Syntax validation only. Never execute native regexes on the main thread.
    try {
      new RegExp(pattern);
    } catch {
      throw new BadRequest('Regex is invalid or unsupported');
    }
  }
  const results = new Map<string, boolean>();
  let retryAt = 0;
  return {
    cachedTest: (value) => results.get(value) ?? false,
    test(value, budget) {
      const unavailable = budget ? undefined : false;
      if (value.length > 65_536) return unavailable;
      const cached = results.get(value);
      if (cached !== undefined) return cached;
      if (performance.now() < retryAt) return unavailable;
      return testInWorker(pattern, value, budget).then((result) => {
        if (result === 'timed-out')
          retryAt = performance.now() + regexDeadlineMs;
        if (typeof result !== 'boolean') return unavailable;
        if (results.size >= 128) results.delete(results.keys().next().value!);
        results.set(value, result);
        return result;
      });
    },
  };
}

const globs = new Map<
  string,
  { regex: RE2JS; negate: boolean; excludeDotSegments: boolean }
>();

// RE2 counts code points; legacy globs count UTF-16 code units. Represent each
// surrogate separately in a reserved BMP range, preserving code-unit ordering.
function encodeSurrogates(value: string): string {
  return value.replace(/[\uD800-\uDFFF]/g, (unit) =>
    String.fromCharCode(unit.charCodeAt(0) + 0x800),
  );
}

/** Compile legacy globs to RE2; reject syntax requiring unsupported assertions. */
export function matchesGlob(value: string, pattern: string): boolean {
  if (pattern.length > 200) throw new BadRequest('Glob is too long');
  if (/[\uE000-\uE7FF]/.test(pattern) || /[\uE000-\uE7FF]/.test(value))
    throw new BadRequest(
      'Glob is invalid or unsupported: reserved private-use characters',
    );
  let compiled = globs.get(pattern);
  if (!compiled) {
    try {
      const negations = /^!+(?!\()/.exec(pattern)?.[0].length ?? 0;
      const positive = encodeSurrogates(pattern.slice(negations));
      // Keep unsupported normalization explicit rather than matching literally.
      if (/[\\"]/.test(pattern) || pattern.startsWith('./')) throw new Error();
      let source = micromatch.makeRe(positive, {
        bash: true,
        strictBrackets: true,
        fastpaths: negations === 0,
      }).source;
      // micromatch uses this sentinel when its generated regex is invalid.
      // Negating it would otherwise turn an invalid range into match-all.
      if (source === '$^') throw new Error();
      // Non-ASCII identity escapes are literals in JavaScript but invalid in
      // RE2. Leave ASCII escapes (including regex metacharacters) untouched.
      source = source.replace(/\\([\u0080-\uFFFF])/g, '$1');
      const dotSegments = '(?:(?:(?!(?:^|\\/)\\.).)*?)';
      // A leading **/ consumes zero or more non-hidden (possibly empty)
      // segments. Picomatch emits a different prefix for its extension fastpath.
      const directories = '(?:(?:[^./][^/]*)?/)*';
      if (positive.startsWith('**/')) {
        source = source
          .replace(`^(?:(?:^|\\/|${dotSegments}\\/)`, `^(?:${directories}`)
          .replace(`^(?:(?:(?!\\.)${dotSegments}\\/)?`, `^(?:${directories}`)
          // The mandatory extension dot satisfies the nonempty assertion.
          .replace(`${directories}\\.(?=.).*?\\.`, `${directories}\\..*?\\.`);
      }
      // After the explicit slash in a trailing /**, the first character may
      // be a dot: the assertion checks slash-dot pairs *inside* the globstar.
      if (positive.endsWith('/**')) {
        const tail = '/[^/]*(?:/(?:[^./][^/]*)?)*';
        source = source
          .replace(`(?:\\/${dotSegments}|$))$`, `(?:${tail})?)$`)
          .replace(`\\/${dotSegments})$`, `${tail})$`);
      }
      // The literal-prefix fastpath has no literal slash, so its remaining
      // dot-segment assertions can use a linear whole-value check.
      const excludeDotSegments = source.includes(dotSegments);
      if (excludeDotSegments) {
        if (/(^[*!?]|[/()[\]{}"\\]|\*\*)/.test(positive)) throw new Error();
        source = source.replaceAll(dotSegments, '.*?');
      }
      source = source.replaceAll('(?=.)(?!\\.)', '(?!\\.)(?=.)');
      source = source.replaceAll('(?!\\.)(?=.).*?', '[^.].*?');
      // A final star with a nonempty assertion (as in *.*) must consume
      // something, including a trailing slash that micromatch permits.
      source = source.replace('(?=.).*?\\/?)$', '.+?\\/?)$');
      source = source.replaceAll('(?!\\.).*?', (assertion, offset) => {
        const next = source.slice(offset + assertion.length);
        // A star at a segment boundary cannot consume a leading dot. If the
        // next literal is itself a dot, the star must consume at least one
        // character. Otherwise its empty branch is safe only for these tokens.
        if (next.startsWith('\\.')) return '[^.].*?';
        if (/^(?:\\[^\w]|[^\[().*+?^|\\])/.test(next)) return '(?:[^.].*?)?';
        throw new Error();
      });
      compiled = {
        regex: RE2JS.compile(source),
        negate: negations % 2 === 1,
        excludeDotSegments,
      };
    } catch {
      throw new BadRequest('Glob is invalid or unsupported');
    }
    if (globs.size >= 128) globs.delete(globs.keys().next().value!);
    globs.set(pattern, compiled);
  }
  if (value === '') return false;
  if (value === pattern) return true;
  if (/[\n\r\u2028\u2029]/.test(value))
    throw new BadRequest('Glob is invalid or unsupported for this value');
  const matched =
    !(compiled.excludeDotSegments && value.includes('/.')) &&
    compiled.regex.test(encodeSurrogates(value));
  return compiled.negate ? !matched : matched;
}
