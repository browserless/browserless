import * as fs from 'fs';
import * as Joi from 'joi';
import * as shortid from 'shortid';
import * as util from 'util';

const debug = require('debug');
const debuggerEnvVar = process.env.DEBUG;

export const writeFile = util.promisify(fs.writeFile);
export const getDebug = (level) => debug(`browserless:${level}`);
export const id = shortid.generate;
export const canLog = debuggerEnvVar && debuggerEnvVar.includes('browserless');

export const asyncMiddleware = (handler) => {
  return (req, socket, head) => {
    Promise.resolve(handler(req, socket, head))
      .catch((error) => {
        debug(`ERROR: ${error}`);
        socket.write(`HTTP/1.1 400 ${error.message}\r\n`);
        socket.end();
      });
  };
};

export const bodyValidation = (schema) => {
  return (req, res, next) => {
    const result = Joi.validate(req.body, schema);

    if (result.error) {
      debug(`Malformed incoming request: ${result.error}`);
      return res.status(400).send(result.error.details);
    }

    // Allow .defaults to work otherwise
    // Joi schemas default's won't apply
    req.body = result.value;

    return next();
  };
};

export const generateChromeTarget = () => {
  return `/devtools/page/${id()}`;
};

export const sleep = (time = 0) => {
  return new Promise((resolve) => {
    setTimeout(resolve, time);
  });
};

export const getBasicAuthToken = (req): string => {
  const header = req.headers.authorization || '';
  const token = header.split(/\s+/).pop() || '';
  return new Buffer(token, 'base64').toString();
};
