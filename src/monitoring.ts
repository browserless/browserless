import { Config, IResourceLoad, Logger } from '@browserless.io/browserless';
import { EventEmitter } from 'events';
import si from 'systeminformation';

export class Monitoring extends EventEmitter {
  protected log = new Logger('hardware');
  constructor(protected config: Config) {
    super();
  }

  public async getMachineStats(): Promise<IResourceLoad> {
    const [cpuLoad, memLoad] = await Promise.all([
      si.currentLoad(),
      si.mem(),
    ]).catch((err) => {
      this.log.error(`Error checking machine stats`, err);
      return [null, null];
    });

    const cpu = cpuLoad ? cpuLoad.currentLoadUser / 100 : null;
    const memory = memLoad ? memLoad.active / memLoad.total : null;

    return {
      cpu,
      memory,
    };
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

    this.log.info(
      `Checking overload status: CPU ${cpuInt}% Memory ${memoryInt}%`,
    );

    const cpuOverloaded = !!(cpuInt && cpuInt >= this.config.getCPULimit());
    const memoryOverloaded = !!(
      memoryInt && memoryInt >= this.config.getMemoryLimit()
    );
    return {
      cpuInt,
      cpuOverloaded,
      memoryInt,
      memoryOverloaded,
    };
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
