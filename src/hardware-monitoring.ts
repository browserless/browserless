import * as _ from 'lodash';
import si = require('systeminformation');
import { getDebug } from './utils';

const log = getDebug('hardware');

interface IResourceLoad {
  cpu: number | null;
  memory: number | null;
}

export class ResourceMonitor {

  public async getMachineStats(): Promise<IResourceLoad> {
    const [
      cpuLoad,
      memLoad,
    ] = await Promise.all([
      si.currentLoad(),
      si.mem(),
    ]).catch((err) => {
      log(`Error checking machine stats`, err);
      return [null, null];
    });

    const cpu = cpuLoad ? cpuLoad.currentload / 100 : null;
    const memory = memLoad ? memLoad.active / memLoad.total : null;

    return {
      cpu,
      memory,
    };
  }
}
