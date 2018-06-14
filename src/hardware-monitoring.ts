import * as os from 'os';

export interface ICPULoad {
  idle: number;
  total: number;
}

export interface IResourceLoad {
  cpuUsage: number;
  memoryUsage: number;
}

export function getCPUIdleAndTotal(): ICPULoad {
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

export function getMachineStats(): Promise<IResourceLoad> {
  return new Promise((resolve) => {
    const start = getCPUIdleAndTotal();

    setTimeout(() => {
      const end = getCPUIdleAndTotal();
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

export function isMachineConstrained(machineResources: IResourceLoad, ) {
  return (
    machineResources.cpuUsage >= this.maxCPU ||
    machineResources.memoryUsage >= this.maxMemory
  );
}
