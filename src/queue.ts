import { IJob, IQueue } from './models/queue.interface';
import { id } from './utils';

const q = require('queue');

export function queue(opts): IQueue<IJob> {
  const qInstance = q(opts);

  qInstance.remove = (job: IJob) => {
    const foundIndex = qInstance.indexOf(job);

    if (foundIndex !== -1) {
      qInstance.splice(foundIndex, 1);
    }
  };

  qInstance.add = (job: IJob) => {
    if (!job.id) {
      job.id = id();
    }

    qInstance.push(job);
  };

  qInstance.map = (...args) => Array.prototype.map.apply(qInstance.jobs, args);

  return qInstance;
}
