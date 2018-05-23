import * as os from 'os';
import * as Joi from 'joi';

export interface ICPULoad {
  idle: number;
  total: number;
}

export interface IResourceLoad {
  cpuUsage: number;
  memoryUsage: number;
}

export const debug = require('debug')('browserless/chrome');

export const asyncMiddleware = (handler) => {
  return (req, socket, head) => {
    Promise.resolve(handler(req, socket, head))
      .catch((error) => {
        debug(`ERROR: ${error}`);
        socket.write(`HTTP/1.1 500 ${error.message}\r\n`);
        socket.end();
      });
  }
};

export const bodyValidation = (schema) => {
  return (req, res, next) => {
    const result = Joi.validate(req.body, schema);

    if (result.error) {
      debug(`Malformed incoming request: ${result.error}`);
      return res.status(400).send(result.error.details);
    }
  
    return next();
  }
};

export const generateChromeTarget = () => {
  var text = '';
  var possible = 'ABCDEF0123456789';

  for (var i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }

  return `/devtools/page/${text}`;
};

export const getCPUIdleAndTotal = ():ICPULoad => {
  let totalIdle = 0;
  let totalTick = 0;

  const cpus = os.cpus();

  for (var i = 0, len = cpus.length; i < len; i++) {
    var cpu = cpus[i];

    for (const type in cpu.times) {
      totalTick += cpu.times[type];
    }

    //Total up the idle time of the core
    totalIdle += cpu.times.idle;
  }

  //Return the average Idle and Tick times
  return {
    idle: totalIdle / cpus.length,
    total: totalTick / cpus.length
  };
}

export const getMachineStats = (): Promise<IResourceLoad> => {
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
