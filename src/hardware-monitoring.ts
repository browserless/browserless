import * as os from 'os';

export interface ICPULoad {
  idle: number;
  total: number;
}

export interface IResourceLoad {
  cpuUsage: number;
  memoryUsage: number;
}

const halfSecond = 500;

export class ResourceMonitor {
  private maxCPU: number;
  private maxMemory: number;
  private currentResources: IResourceLoad;
  private metricsInterval: NodeJS.Timeout;
  private metricsTimeout: NodeJS.Timeout;

  constructor(maxCPU, maxMemory) {
    this.maxCPU = maxCPU;
    this.maxMemory = maxMemory;

    this.currentResources = {
      cpuUsage: 0,
      memoryUsage: 0,
    };

    this.metricsInterval = setInterval(this.recordMachineStats.bind(this), halfSecond);
  }

  public getCPUIdleAndTotal(): ICPULoad {
    let totalIdle = 0;
    let totalTick = 0;

    const cpus = os.cpus();

    for (let i = 0, len = cpus.length; i < len; i++) {
      const cpu = cpus[i];

      for (const type in cpu.times) {
        if (cpu.times[type]) {
          totalTick += cpu.times[type];
        }
      }

      // Total up the idle time of the core
      totalIdle += cpu.times.idle;
    }

    // Return the average Idle and Tick times
    return {
      idle: totalIdle / cpus.length,
      total: totalTick / cpus.length,
    };
  }

  public getMachineStats(): Promise<IResourceLoad> {
    return new Promise((resolve) => {
      const start = this.getCPUIdleAndTotal();

      this.metricsTimeout = setTimeout(() => {
        const end = this.getCPUIdleAndTotal();
        const idleDifference = end.idle - start.idle;
        const totalDifference = end.total - start.total;

        const cpuUsage = 1 - (idleDifference / totalDifference);
        const memoryUsage = 1 - (os.freemem() / os.totalmem());

        return resolve({
          cpuUsage,
          memoryUsage,
        });
      }, 100);
    });
  }

  public close() {
    if (this.metricsTimeout) {
      clearTimeout(this.metricsTimeout);
    }

    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }
  }

  private async recordMachineStats() {
    this.currentResources = await this.getMachineStats();
  }

  get isMachinedConstrained() {
    return (
      this.currentResources.cpuUsage >= this.maxCPU ||
      this.currentResources.memoryUsage >= this.maxMemory
    );
  }

  get currentStats() {
    return this.currentResources;
  }
}
