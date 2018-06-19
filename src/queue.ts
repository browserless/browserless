import { IJob, IQueue } from './models/browserless-queue.interface';
const q = require('queue');

export function queue(opts): IQueue<IJob> {
  const qInstance = q(opts);

  qInstance.remove = (job: IJob) => {
    const foundIndex = qInstance.indexOf(job);

    if (foundIndex !== -1) {
      qInstance.splice(foundIndex, 1);
    }
  };

  return qInstance;
}
