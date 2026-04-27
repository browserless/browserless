import { Config, IResourceLoad, Logger } from '@browserless.io/browserless';
import { EventEmitter } from 'events';
import { readFile as fsReadFile } from 'fs/promises';
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
