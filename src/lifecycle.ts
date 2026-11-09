import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';

/**
 * Process-local worker admission and work accounting.
 *
 * - `running`: fresh launches are admitted.
 * - `withdrawn`: fresh launches are rejected; attaching to live browsers and
 *   work already holding a launch permit continue. Reversible via `resume`.
 * - `admissionClosed`: terminal. Reached through `tryCloseAdmission` when nothing is
 *   blocking closure; attaches and (via the Router) application routes are
 *   rejected too.
 * - `stopped`: an ordered shutdown (`Browserless.shutdownGracefully`) finished
 *   every step and nothing was outstanding or failed afterwards.
 *
 * Nothing here closes browsers or shortens retention.
 */
export type WorkerState =
  'running' | 'withdrawn' | 'admissionClosed' | 'stopped';

export interface LifecycleExpect {
  bootId: string;
  generation: number;
}

/**
 * Counted permission for one launch. Settle exactly when the launch has either
 * produced a browser that is otherwise counted (e.g. in the browser map) or
 * finished cleaning up after failure. Pass the error when that cleanup failed.
 * Idempotent: only the first settle counts.
 */
export interface LaunchPermit {
  readonly kind: string;
  readonly settled: boolean;
  settle(cleanupError?: unknown): void;
}

/**
 * Launch authority owned by one admitted job, including a multi-launch request.
 * Created only while `running`; while unsettled it is
 * outstanding work, and every `acquireLaunch(kind, { adopt: authority })`
 * returns a new, independently counted child permit that skips admission.
 * Settle it exactly once at the job's own end; settling never revokes or
 * uncounts children already started, and a settled authority adopts nothing.
 * It is an in-process object: never serialize it or hand it to another job.
 */
declare const jobLaunchAuthority: unique symbol;
export type JobLaunchAuthority = LaunchPermit & {
  readonly [jobLaunchAuthority]: true;
};

export interface LifecycleFailure {
  kind: string;
  message: string;
  at: number;
}

export interface LifecycleSnapshot {
  bootId: string;
  generation: number;
  state: WorkerState;
  launchPermits: Record<string, number>;
  tracked: Record<string, number>;
  sources: Record<string, number>;
  producers: Record<string, { enabled: boolean; covered: boolean }>;
  oldestOutstandingMs: number | null;
  /** Total failures; only the first 100 details are retained. */
  failureCount: number;
  failures: LifecycleFailure[];
  /**
   * True only in `admissionClosed`/`stopped` with no covered work outstanding,
   * failures or uncovered producers. Nonblocking arrivals/status work still
   * count at the shutdown idle barrier. This is not a safe-to-kill signal;
   * see `Browserless.shutdownGracefully` and its `shutdownComplete` report.
   */
  drainComplete: boolean;
  reasons: string[];
}

/** Retryable: this worker is not admitting new work. Served as HTTP 503. */
export class WorkerWithdrawn extends Error {
  constructor(message = 'worker_withdrawn') {
    super(message);
    this.name = 'WorkerWithdrawn';
  }
}

/** Control request named a stale boot or generation. */
export class LifecycleConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LifecycleConflict';
  }
}

interface Outstanding {
  kind: string;
  isRight: boolean;
  start: number;
  owner?: object;
  /** False for arrivals and work of owners admitted after close. */
  blocksClosure: boolean;
}

export class WorkerLifecycle extends EventEmitter {
  public readonly bootId = randomUUID();
  protected currentState: WorkerState = 'running';
  protected currentGeneration = 0;
  protected nextId = 0;
  protected outstanding = new Map<number, Outstanding>();
  protected failureCount = 0;
  protected failures: LifecycleFailure[] = [];
  protected sources = new Map<string, () => number>();
  protected producers = new Map<
    string,
    { enabled: boolean; covered: boolean }
  >();
  protected admissions = new WeakMap<object, number>();
  protected adoptable = new WeakSet<LaunchPermit>();
  protected authorities = new WeakSet<LaunchPermit>();
  // Owners and requests that have had an authority: one per owner, ever.
  protected authorityOwners = new WeakSet<object>();
  protected lastTransition: { op: string; fromGeneration: number } | null =
    null;
  protected idleWaiters: Array<{ except?: object; resolve: () => void }> = [];
  // Owners (a request the Router admitted as status/control work, an owned
  // producer) whose work, and work they spawn with `owner` set, may start
  // after closure and does not block it.
  protected admittedAfterClose = new WeakSet<object>();

  get state(): WorkerState {
    return this.currentState;
  }

  /** Terminal admission closure has happened (`admissionClosed` or `stopped`). */
  get isAdmissionClosed(): boolean {
    return (
      this.currentState === 'admissionClosed' || this.currentState === 'stopped'
    );
  }

  get generation(): number {
    return this.currentGeneration;
  }

  /**
   * Synchronously take a launch permit, before any async launch preparation.
   *
   * `adopt`: a permit taken earlier by an outer caller for this same launch.
   * It is honoured once, and only while unsettled; the returned child permit is
   * counted separately and skips admission. Anything else (no adopt, settled,
   * already adopted, foreign) goes through admission.
   *
   * `req`: rejects when the request was admitted under an older generation,
   * so queued work never resurrects after withdraw/resume.
   */
  public acquireLaunch(
    kind: string,
    opts: { req?: object; adopt?: LaunchPermit } = {},
  ): LaunchPermit {
    const { req, adopt } = opts;
    if (adopt && !adopt.settled && this.authorities.has(adopt)) {
      // Job authority: any number of children while the job is unsettled.
      return this.createLaunchPermit(kind);
    }
    if (adopt && !adopt.settled && this.adoptable.has(adopt)) {
      this.adoptable.delete(adopt);
      return this.createLaunchPermit(kind);
    }
    this.assertAdmitting(req);
    const right = this.createLaunchPermit(kind);
    this.adoptable.add(right);
    return right;
  }

  /**
   * Create the launch authority for one job at its acceptance point.
   * Synchronous; throws WorkerWithdrawn unless `running` (and, with `req`,
   * unless the request was admitted under the current generation). `owner`
   * is the job's own in-process object; each owner, and each `req`, can be
   * given at most one authority, even after it settled (LifecycleConflict).
   */
  public createJobLaunchAuthority(
    kind: string,
    opts: { owner: object; req?: object },
  ): JobLaunchAuthority {
    const { owner, req } = opts;
    if (
      this.authorityOwners.has(owner) ||
      (req && this.authorityOwners.has(req))
    ) {
      throw new LifecycleConflict(
        `Job authority "${kind}" already created for this owner or request`,
      );
    }
    this.assertAdmitting(req);
    const authority = this.createLaunchPermit(`job:${kind}`);
    this.authorityOwners.add(owner);
    if (req) this.authorityOwners.add(req);
    this.authorities.add(authority);
    return authority as JobLaunchAuthority;
  }

  public assertAdmitting(req?: object) {
    if (this.currentState !== 'running') {
      throw new WorkerWithdrawn(
        `worker_withdrawn: not admitting new browser launches (${this.currentState})`,
      );
    }
    const admittedAt = req ? this.admissions.get(req) : undefined;
    if (admittedAt !== undefined && admittedAt !== this.currentGeneration) {
      throw new WorkerWithdrawn(
        `worker_withdrawn: request admitted under generation ${admittedAt}, now ${this.currentGeneration}`,
      );
    }
  }

  /** Throws only when terminal; live attaches stay possible while withdrawn. */
  public assertAttachAllowed(): void {
    if (this.isAdmissionClosed) {
      throw new WorkerWithdrawn('worker_withdrawn: worker is closed');
    }
  }

  /**
   * Count `p` as outstanding work until it settles. With `required` (default)
   * a rejection is recorded as a failure that permanently blocks completion.
   * Returns `p` itself, so callers keep its timing and rejection.
   *
   * `owner` names what the work descends from (usually the request). Work of
   * an owner admitted with `admitAfterClose` does not block closure and may
   * start after it. Any other work that starts after terminal closure is
   * still counted and is also recorded as a failure: something produced work
   * the barrier had already declared finished.
   */
  public track<T>(
    kind: string,
    p: Promise<T>,
    opts: { required?: boolean; owner?: object } = {},
  ): Promise<T> {
    const admitted = !!opts.owner && this.admittedAfterClose.has(opts.owner);
    if (this.isAdmissionClosed && !admitted) {
      this.recordFailure(kind, new Error('work started after closed'));
    }
    return this.watch(kind, p, opts.required ?? true, opts.owner, !admitted);
  }

  /**
   * Count an inbound request from arrival until handled. Arrivals never block
   * closure (rejected or polling traffic cannot starve it) and may happen
   * after it, but they are awaited by `whenIdle`. Whatever the request does
   * beyond arriving is tracked separately and subject to the normal rules.
   */
  public trackArrival<T>(req: object, p: Promise<T>): Promise<T> {
    return this.watch('server-request', p, false, req, false);
  }

  /**
   * Admit `owner` (a status/control request, an owned producer) to produce
   * work after closure. Its work never blocks closure; it is still awaited by
   * `whenIdle` and the terminal stop.
   */
  public admitAfterClose(owner: object): void {
    this.admittedAfterClose.add(owner);
  }

  protected watch<T>(
    kind: string,
    p: Promise<T>,
    required: boolean,
    owner: object | undefined,
    blocksClosure: boolean,
  ): Promise<T> {
    const id = this.add(kind, false, owner, blocksClosure);
    p.then(
      () => this.remove(id),
      (err) => {
        if (required) this.recordFailure(kind, err);
        this.remove(id);
      },
    );
    return p;
  }

  /**
   * Resolves once no launch permit or tracked work is outstanding. No deadline:
   * it waits for the actual work. Sources are polled, not awaited; check
   * `snapshot()` afterwards.
   */
  public whenIdle(except?: object): Promise<void> {
    if (this.countOutstanding(except) === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push({ except, resolve }));
  }

  /** Record a failure that permanently blocks completion for this boot. */
  public recordFailure(kind: string, err: unknown) {
    this.failureCount++;
    if (this.failures.length >= 100) return;
    this.failures.push({
      kind,
      message: err instanceof Error ? err.message : String(err),
      at: Date.now(),
    });
  }

  /** Throws LifecycleConflict unless boot and generation match. */
  public checkExpect(expect: LifecycleExpect) {
    if (
      expect.bootId !== this.bootId ||
      expect.generation !== this.currentGeneration
    ) {
      throw new LifecycleConflict(
        `Expected boot ${expect.bootId} generation ${expect.generation}, worker is boot ${this.bootId} generation ${this.currentGeneration}`,
      );
    }
  }

  /**
   * admissionClosed -> stopped, only with nothing outstanding, failed or uncovered.
   * Called by the ordered terminal stop after its last step.
   */
  public markShutdownComplete(except?: object): boolean {
    if (
      this.currentState !== 'admissionClosed' ||
      this.reasons({ except }).length
    ) {
      return false;
    }
    this.currentState = 'stopped';
    this.emit('stopped');
    return true;
  }

  /** Live-resource counter polled by snapshot/tryCloseAdmission. */
  public registerSource(name: string, count: () => number): void {
    this.sources.set(name, count);
  }

  /** Enabled-but-uncovered producers block completion. */
  public registerProducer(
    name: string,
    p: { enabled: boolean; covered: boolean },
  ): void {
    this.producers.set(name, { enabled: p.enabled, covered: p.covered });
  }

  /** Record the generation a request was admitted (or queued) under. */
  public stampAdmission(req: object): void {
    this.admissions.set(req, this.currentGeneration);
  }

  public withdraw(expect: LifecycleExpect): LifecycleSnapshot {
    if (this.isRepeat('withdraw', expect)) return this.snapshot();
    this.checkExpect(expect);
    if (this.currentState !== 'running') {
      throw new LifecycleConflict(`Cannot withdraw from ${this.currentState}`);
    }
    this.transition('withdraw', 'withdrawn');
    return this.snapshot();
  }

  public resume(expect: LifecycleExpect): LifecycleSnapshot {
    if (this.isRepeat('resume', expect)) return this.snapshot();
    this.checkExpect(expect);
    if (this.currentState !== 'withdrawn') {
      throw new LifecycleConflict(`Cannot resume from ${this.currentState}`);
    }
    this.transition('resume', 'running');
    return this.snapshot();
  }

  /**
   * From `withdrawn`: if no covered work is outstanding and no producer is
   * uncovered, close admission (including attaches) synchronously.
   * Historical failures still prevent clean completion, not cleanup attempts.
   */
  public async tryCloseAdmission(
    expect: LifecycleExpect,
  ): Promise<LifecycleSnapshot> {
    this.checkExpect(expect);
    if (this.isAdmissionClosed) {
      return this.snapshot();
    }
    if (this.currentState !== 'withdrawn') {
      throw new LifecycleConflict(
        `Cannot close admission from ${this.currentState}`,
      );
    }
    if (
      this.reasons({ blockingOnly: true, ignoreFailures: true }).length === 0
    ) {
      this.currentState = 'admissionClosed';
      this.emit('admissionClosed');
    }
    return this.snapshot();
  }

  public snapshot(): LifecycleSnapshot {
    const rights: Record<string, number> = {};
    const tracked: Record<string, number> = {};
    let oldest: number | null = null;
    for (const { kind, isRight, start } of this.outstanding.values()) {
      const bucket = isRight ? rights : tracked;
      bucket[kind] = (bucket[kind] ?? 0) + 1;
      oldest = oldest === null ? start : Math.min(oldest, start);
    }
    const reasons = this.reasons();
    return {
      bootId: this.bootId,
      generation: this.currentGeneration,
      state: this.currentState,
      launchPermits: rights,
      tracked,
      sources: this.readSources(),
      producers: Object.fromEntries(this.producers),
      oldestOutstandingMs: oldest === null ? null : Date.now() - oldest,
      failureCount: this.failureCount,
      failures: [...this.failures],
      drainComplete:
        this.isAdmissionClosed &&
        this.reasons({ blockingOnly: true }).length === 0,
      reasons,
    };
  }

  protected reasons(
    opts: {
      blockingOnly?: boolean;
      except?: object;
      ignoreFailures?: boolean;
    } = {},
  ): string[] {
    const reasons: string[] = [];
    const counts: Record<string, number> = {};
    for (const {
      kind,
      isRight,
      owner,
      blocksClosure,
    } of this.outstanding.values()) {
      if (opts.blockingOnly && !blocksClosure) continue;
      if (opts.except && owner === opts.except) continue;
      const key = isRight ? `launch permit "${kind}"` : `work "${kind}"`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    for (const [key, n] of Object.entries(counts)) {
      reasons.push(`${n} outstanding ${key}`);
    }
    for (const [name, n] of Object.entries(this.readSources())) {
      if (n !== 0) reasons.push(`source "${name}" reports ${n}`);
    }
    if (!opts.ignoreFailures) {
      for (const f of this.failures) {
        reasons.push(`failed "${f.kind}": ${f.message}`);
      }
      if (this.failureCount > this.failures.length) {
        reasons.push(
          `${this.failureCount - this.failures.length} additional failures omitted`,
        );
      }
    }
    for (const [name, p] of this.producers) {
      if (p.enabled && !p.covered) {
        reasons.push(`producer "${name}" is enabled but not covered`);
      }
    }
    return reasons;
  }

  protected readSources(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [name, count] of this.sources) {
      try {
        out[name] = count();
      } catch {
        out[name] = NaN;
      }
    }
    return out;
  }

  protected createLaunchPermit(kind: string): LaunchPermit {
    const id = this.add(kind, true, undefined, true);
    let settled = false;
    return {
      kind,
      get settled() {
        return settled;
      },
      settle: (cleanupError?: unknown) => {
        if (settled) return;
        settled = true;
        if (cleanupError !== undefined) this.recordFailure(kind, cleanupError);
        this.remove(id);
      },
    };
  }

  protected add(
    kind: string,
    isRight: boolean,
    owner: object | undefined,
    blocksClosure: boolean,
  ): number {
    const id = this.nextId++;
    this.outstanding.set(id, {
      blocksClosure,
      isRight,
      kind,
      owner,
      start: Date.now(),
    });
    return id;
  }

  protected countOutstanding(except?: object): number {
    let n = 0;
    for (const { owner } of this.outstanding.values()) {
      if (!except || owner !== except) n++;
    }
    return n;
  }

  protected remove(id: number) {
    this.outstanding.delete(id);
    if (!this.idleWaiters.length) return;
    this.idleWaiters = this.idleWaiters.filter((w) => {
      if (this.countOutstanding(w.except)) return true;
      w.resolve();
      return false;
    });
  }

  protected isRepeat(op: string, expect: LifecycleExpect) {
    return (
      expect.bootId === this.bootId &&
      this.lastTransition?.op === op &&
      this.lastTransition.fromGeneration === expect.generation &&
      this.currentGeneration === expect.generation + 1
    );
  }

  protected transition(op: 'withdraw' | 'resume', to: WorkerState) {
    this.lastTransition = { op, fromGeneration: this.currentGeneration };
    this.currentState = to;
    this.currentGeneration++;
    this.emit(op);
  }
}
