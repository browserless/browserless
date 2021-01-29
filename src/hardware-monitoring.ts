import _ from 'lodash';
import si from 'systeminformation';
import { getDebug } from './utils';
import { IResourceLoad } from './types';
import { MAX_CPU_PERCENT, MAX_MEMORY_PERCENT } from './config';

const log = getDebug('hardware');

export const getMachineStats = async (): Promise<IResourceLoad> => {
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

  const cpu = cpuLoad ? cpuLoad.currentLoadUser / 100 : null;
  const memory = memLoad ? memLoad.active / memLoad.total : null;

  return {
    cpu,
    memory,
  };
};

export const overloaded = async(): Promise<{
    cpuOverloaded: boolean;
    memoryOverloaded: boolean;
    cpuInt: number | null;
    memoryInt: number | null;
  }> => {
  const { cpu, memory } = await getMachineStats();
  const cpuInt = cpu && Math.ceil(cpu * 100);
  const memoryInt = memory && Math.ceil(memory * 100);

  log(`Checking overload status: CPU ${cpuInt}% Memory ${memoryInt}%`);

  const cpuOverloaded = !!(cpuInt && (cpuInt >= MAX_CPU_PERCENT));
  const memoryOverloaded = !!(memoryInt && (memoryInt >= MAX_MEMORY_PERCENT));

  return {
    cpuOverloaded,
    memoryOverloaded,
    cpuInt,
    memoryInt,
  };
}
