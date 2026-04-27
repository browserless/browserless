import { Config, IResourceLoad, Logger } from '@browserless.io/browserless';
import { EventEmitter } from 'events';
import { readFile as fsReadFile } from 'fs/promises';
import os from 'os';
import si from 'systeminformation';

const READ_TIMEOUT_MS = 200;

type ReadFileFn = (path: string, signal: AbortSignal) => Promise<string>;

const defaultReadFile: ReadFileFn = (path, signal) =>
  fsReadFile(path, { encoding: 'utf8', signal });

export async function readWithTimeout(
  path: string,
  readFile: ReadFileFn = defaultReadFile,
  timeoutMs: number = READ_TIMEOUT_MS,
): Promise<string> {
  const signal = AbortSignal.timeout(timeoutMs);
  return readFile(path, signal);
}

export function parseCpuMax(content: string): number | null {
  const trimmed = content.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/\s+/);
  if (parts.length !== 2) return null;
  const [quotaRaw, periodRaw] = parts;
  const period = Number(periodRaw);
  if (!Number.isFinite(period) || period <= 0) return null;
  if (quotaRaw === 'max') return os.cpus().length;
  const quota = Number(quotaRaw);
  if (!Number.isFinite(quota) || quota <= 0) return null;
  return quota / period;
}

export function parseCpuStatUsageUsec(content: string): number | null {
  for (const line of content.split('\n')) {
    const [key, value] = line.trim().split(/\s+/);
    if (key === 'usage_usec') {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

export function parseMemoryMax(content: string): number | null {
  const trimmed = content.trim();
  if (!trimmed) return null;
  if (trimmed === 'max') return os.totalmem();
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export interface MachineStatsSource {
  read(): Promise<IResourceLoad>;
  readonly name: string;
}

export class HostSource implements MachineStatsSource {
  public readonly name = 'host (systeminformation)';
  protected log = new Logger('hardware');

  public async read(): Promise<IResourceLoad> {
    const [cpuLoad, memLoad] = await Promise.all([
      si.currentLoad(),
      si.mem(),
    ]).catch((err) => {
      this.log.error(`Error checking machine stats`, err);
      return [null, null];
    });

    const cpu = cpuLoad ? cpuLoad.currentLoadUser / 100 : null;
    const memory = memLoad ? memLoad.active / memLoad.total : null;

    return { cpu, memory };
  }
}

type Sample = { usageUsec: number; timestamp: number };

interface CgroupSourceOpts {
  now?: () => number;
  readFile?: ReadFileFn;
}

export class CgroupV2Source implements MachineStatsSource {
  public readonly name = 'cgroup-v2';
  protected log = new Logger('hardware');
  protected lastSample: Sample | null = null;
  protected loggedFailure: Set<string> = new Set();

  protected now: () => number;
  protected readFile: ReadFileFn;

  constructor(opts: CgroupSourceOpts = {}) {
    this.now = opts.now ?? Date.now;
    this.readFile = opts.readFile ?? defaultReadFile;
  }

  public async read(): Promise<IResourceLoad> {
    const [cpu, memory] = await Promise.all([
      this.readCpu(),
      this.readMemory(),
    ]);
    return { cpu, memory };
  }

  protected async readCpu(): Promise<number | null> {
    let usageContent: string;
    let maxContent: string;
    try {
      [usageContent, maxContent] = await Promise.all([
        readWithTimeout('/sys/fs/cgroup/cpu.stat', this.readFile),
        readWithTimeout('/sys/fs/cgroup/cpu.max', this.readFile),
      ]);
    } catch (err) {
      this.logOnce('cpu-read', err);
      return null;
    }

    const usageUsec = parseCpuStatUsageUsec(usageContent);
    const cores = parseCpuMax(maxContent);
    if (usageUsec === null || cores === null || cores <= 0) {
      this.logOnce('cpu-parse', new Error('cgroup v2 cpu parse failed'));
      return null;
    }

    const timestamp = this.now();
    const previous = this.lastSample;
    this.lastSample = { timestamp, usageUsec };

    if (!previous) return null;

    const dWallMs = timestamp - previous.timestamp;
    if (dWallMs <= 0) return null;
    const dUsageUsec = usageUsec - previous.usageUsec;
    if (dUsageUsec < 0) return null;

    return dUsageUsec / (dWallMs * cores * 1000);
  }

  protected async readMemory(): Promise<number | null> {
    let currentContent: string;
    let maxContent: string;
    try {
      [currentContent, maxContent] = await Promise.all([
        readWithTimeout('/sys/fs/cgroup/memory.current', this.readFile),
        readWithTimeout('/sys/fs/cgroup/memory.max', this.readFile),
      ]);
    } catch (err) {
      this.logOnce('memory-read', err);
      return null;
    }

    const current = Number(currentContent.trim());
    const max = parseMemoryMax(maxContent);
    if (!Number.isFinite(current) || max === null || max <= 0) {
      this.logOnce('memory-parse', new Error('cgroup v2 memory parse failed'));
      return null;
    }
    return current / max;
  }

  protected logOnce(category: string, err: unknown) {
    if (this.loggedFailure.has(category)) return;
    this.loggedFailure.add(category);
    this.log.warn(
      `cgroup v2 ${category} failure (further occurrences silenced):`,
      err,
    );
  }
}

export function parseCpuV1Quota(
  quotaContent: string,
  periodContent: string,
): number | null {
  const period = Number(periodContent.trim());
  if (!Number.isFinite(period) || period <= 0) return null;
  const quota = Number(quotaContent.trim());
  if (!Number.isFinite(quota)) return null;
  if (quota <= 0) return os.cpus().length; // -1 means unbounded
  return quota / period;
}

export function parseMemoryV1Limit(content: string): number | null {
  const trimmed = content.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return null;
  // Kernel sentinel for "unlimited" is a huge number (e.g. 9223372036854771712).
  // Anything > 16 * host RAM is treated as unbounded.
  if (n > os.totalmem() * 16) return os.totalmem();
  return n;
}

export class CgroupV1Source implements MachineStatsSource {
  public readonly name = 'cgroup-v1';
  protected log = new Logger('hardware');
  protected lastSample: Sample | null = null;
  protected loggedFailure: Set<string> = new Set();

  protected readFile: ReadFileFn;
  protected now: () => number;

  constructor(opts: CgroupSourceOpts = {}) {
    this.readFile = opts.readFile ?? defaultReadFile;
    this.now = opts.now ?? Date.now;
  }

  public async read(): Promise<IResourceLoad> {
    const [cpu, memory] = await Promise.all([
      this.readCpu(),
      this.readMemory(),
    ]);
    return { cpu, memory };
  }

  protected async readCpu(): Promise<number | null> {
    let usageNsContent: string;
    let quotaContent: string;
    let periodContent: string;
    try {
      [usageNsContent, quotaContent, periodContent] = await Promise.all([
        readWithTimeout('/sys/fs/cgroup/cpu/cpuacct.usage', this.readFile),
        readWithTimeout('/sys/fs/cgroup/cpu/cpu.cfs_quota_us', this.readFile),
        readWithTimeout('/sys/fs/cgroup/cpu/cpu.cfs_period_us', this.readFile),
      ]);
    } catch (err) {
      this.logOnce('cpu-read', err);
      return null;
    }

    const usageNs = Number(usageNsContent.trim());
    const cores = parseCpuV1Quota(quotaContent, periodContent);
    if (!Number.isFinite(usageNs) || cores === null || cores <= 0) {
      this.logOnce('cpu-parse', new Error('cgroup v1 cpu parse failed'));
      return null;
    }

    const usageUsec = usageNs / 1000;
    const timestamp = this.now();
    const previous = this.lastSample;
    this.lastSample = { usageUsec, timestamp };
    if (!previous) return null;

    const dWallMs = timestamp - previous.timestamp;
    if (dWallMs <= 0) return null;
    const dUsageUsec = usageUsec - previous.usageUsec;
    if (dUsageUsec < 0) return null;

    return dUsageUsec / (dWallMs * cores * 1000);
  }

  protected async readMemory(): Promise<number | null> {
    let usageContent: string;
    let limitContent: string;
    try {
      [usageContent, limitContent] = await Promise.all([
        readWithTimeout(
          '/sys/fs/cgroup/memory/memory.usage_in_bytes',
          this.readFile,
        ),
        readWithTimeout(
          '/sys/fs/cgroup/memory/memory.limit_in_bytes',
          this.readFile,
        ),
      ]);
    } catch (err) {
      this.logOnce('memory-read', err);
      return null;
    }

    const usage = Number(usageContent.trim());
    const limit = parseMemoryV1Limit(limitContent);
    if (!Number.isFinite(usage) || limit === null || limit <= 0) {
      this.logOnce('memory-parse', new Error('cgroup v1 memory parse failed'));
      return null;
    }
    return usage / limit;
  }

  protected logOnce(category: string, err: unknown) {
    if (this.loggedFailure.has(category)) return;
    this.loggedFailure.add(category);
    this.log.warn(
      `cgroup v1 ${category} failure (further occurrences silenced):`,
      err,
    );
  }
}

export class Monitoring extends EventEmitter {
  protected log = new Logger('hardware');
  protected statsSource: MachineStatsSource;

  constructor(
    protected config: Config,
    statsSource?: MachineStatsSource,
  ) {
    super();
    this.statsSource = statsSource ?? new HostSource();
  }

  public async getMachineStats(): Promise<IResourceLoad> {
    return this.statsSource.read();
  }

  public async overloaded(): Promise<{
    cpuInt: number | null;
    cpuOverloaded: boolean;
    memoryInt: number | null;
    memoryOverloaded: boolean;
  }> {
    const { cpu, memory } = await this.getMachineStats();
    const cpuInt = cpu && Math.ceil(cpu * 100);
    const memoryInt = memory && Math.ceil(memory * 100);

    this.log.debug(
      `Checking overload status: CPU ${cpuInt}% Memory ${memoryInt}%`,
    );

    const cpuOverloaded = !!(cpuInt && cpuInt >= this.config.getCPULimit());
    const memoryOverloaded = !!(
      memoryInt && memoryInt >= this.config.getMemoryLimit()
    );
    return { cpuInt, cpuOverloaded, memoryInt, memoryOverloaded };
  }

  /**
   * Implement any browserless-core-specific shutdown logic here.
   * Calls the empty-SDK stop method for downstream implementations.
   */
  public async shutdown() {
    return await this.stop();
  }

  /**
   * Left blank for downstream SDK modules to optionally implement.
   */
  public stop() {}
}
