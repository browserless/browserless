import {
  Config,
  IResourceLoad,
  createLogger,
} from '@browserless.io/browserless';
import si from 'systeminformation';

export class Monitoring {
  private log = createLogger('hardware');
  constructor(private config: Config) {}

  public getMachineStats = async (): Promise<IResourceLoad> => {
    const [cpuLoad, memLoad] = await Promise.all([
      si.currentLoad(),
      si.mem(),
    ]).catch((err) => {
      this.log(`Error checking machine stats`, err);
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

    this.log(`Checking overload status: CPU ${cpuInt}% Memory ${memoryInt}%`);

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
