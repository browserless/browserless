import si from 'systeminformation';

import { Config } from './config.js';
import { IResourceLoad } from './types.js';
import { createLogger } from './utils.js';

const log = createLogger('hardware');

export class Monitoring {
  constructor(private config: Config) {}

  public getMachineStats = async (): Promise<IResourceLoad> => {
    const [cpuLoad, memLoad] = await Promise.all([
      si.currentLoad(),
      si.mem(),
    ]).catch((err) => {
      log(`Error checking machine stats`, err);
      return [null, null];
    });

    const cpu = cpuLoad ? cpuLoad.currentLoadUser / 100 : null;
    const memory = memLoad ? memLoad.active / memLoad.total : null;

    return {
      cpu,
      memory,
    };
  };

  public overloaded = async (): Promise<{
    cpuInt: number | null;
    cpuOverloaded: boolean;
    memoryInt: number | null;
    memoryOverloaded: boolean;
  }> => {
    const { cpu, memory } = await this.getMachineStats();
    const cpuInt = cpu && Math.ceil(cpu * 100);
    const memoryInt = memory && Math.ceil(memory * 100);

    log(`Checking overload status: CPU ${cpuInt}% Memory ${memoryInt}%`);

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
  };
}
