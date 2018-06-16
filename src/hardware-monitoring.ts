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

  constructor(maxCPU, maxMemory) {
    this.maxCPU = maxCPU;
    this.maxMemory = maxMemory;

    this.currentResources = {
      cpuUsage: 0,
      memoryUsage: 0,
    };

    setInterval(this.recordMachineStats.bind(this), halfSecond);
  }

  private async recordMachineStats() {
    this.currentResources = await this.getMachineStats();
  }

  get isMachinedConstrained() {
    return (
      this.currentResources.cpuUsage >= this.maxCPU ||
      this.currentResources.memoryUsage >= this.maxMemory
    )
  }

  get currentStats() {
    return this.currentResources;
  }

  getCPUIdleAndTotal(): ICPULoad {
    let totalIdle = 0;
    let totalTick = 0;

    const cpus = os.cpus();

    for (var i = 0, len = cpus.length; i < len; i++) {
      var cpu = cpus[i];

      for (const type in cpu.times) {
        totalTick += cpu.times[type];
      }

      // Total up the idle time of the core
      totalIdle += cpu.times.idle;
    }

    // Return the average Idle and Tick times
    return {
      idle: totalIdle / cpus.length,
      total: totalTick / cpus.length
    };
  }

  getMachineStats(): Promise<IResourceLoad> {
    return new Promise((resolve) => {
      const start = this.getCPUIdleAndTotal();

      setTimeout(() => {
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
}
