import * as _ from 'lodash';
import si = require('systeminformation');

interface IResourceLoad {
  cpu: number;
  memory: number;
}

export class ResourceMonitor {

  public async getMachineStats(): Promise<IResourceLoad> {
    const [
      cpuLoad,
      memLoad,
    ] = await Promise.all([
      si.currentLoad(),
      si.mem(),
    ]);

    const cpu = cpuLoad.currentload / 100;
    const memory = memLoad.active / memLoad.total;

    return {
      cpu,
      memory,
    };
  }
}
