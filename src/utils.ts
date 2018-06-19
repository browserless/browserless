import * as fs from 'fs';
import * as Joi from 'joi';
import * as util from 'util';

export const writeFile = util.promisify(fs.writeFile);

export const debug = require('debug')('browserless/chrome');

export const asyncMiddleware = (handler) => {
  return (req, socket, head) => {
    Promise.resolve(handler(req, socket, head))
      .catch((error) => {
        debug(`ERROR: ${error}`);
        socket.write(`HTTP/1.1 500 ${error.message}\r\n`);
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

    return next();
  };
};

export const generateChromeTarget = () => {
  let text = '';
  const possible = 'ABCDEF0123456789';

  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }

  return `/devtools/page/${text}`;
};
