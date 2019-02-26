import * as cookie from 'cookie';
import * as fs from 'fs';
import * as Joi from 'joi';
import * as _ from 'lodash';
import * as os from 'os';
import * as path from 'path';
import * as shortid from 'shortid';
import * as url from 'url';
import * as util from 'util';

const debug = require('debug');
const debuggerEnvVar = process.env.DEBUG;

export const exists = util.promisify(fs.exists);
export const lstat = util.promisify(fs.lstat);
export const readdir = util.promisify(fs.readdir);
export const writeFile = util.promisify(fs.writeFile);
export const mkdir = util.promisify(fs.mkdir);
export const getDebug = (level) => debug(`browserless:${level}`);
export const id = shortid.generate;
export const canLog = debuggerEnvVar && debuggerEnvVar.includes('browserless');
export const workspaceDir = process.env.WORKSPACE_DIR ? process.env.WORKSPACE_DIR : os.tmpdir();

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

export const tokenCookieName = 'browserless_token';
export const codeCookieName = 'browserless_code';

export const isAuthorized = (req, token) => {
  const cookies = cookie.parse(req.headers.cookie || '');
  const parsedUrl = url.parse(req.url as string, true);
  const authToken = _.get(parsedUrl, 'query.token', null) ||
    getBasicAuthToken(req) ||
    cookies[tokenCookieName];

  if (authToken !== token) {
    return false;
  }

  return true;
};

export const getTimeout = (urlParts: url.UrlWithParsedQuery) => {
  const timeoutString = +urlParts.query.timeout;
  return !isNaN(timeoutString) ? timeoutString : null;
};

export const generateChromeTarget = () => {
  return `/devtools/page/${id()}`;
};

export const sleep = (time = 0) => {
  return new Promise((resolve) => {
    setTimeout(resolve, time);
  });
};

export const eventAsync = (emitterLike, event: string) =>
  new Promise((resolve, reject) => {
    emitterLike.on(event, (err, ...data) => {
      if (err) {
        return reject(err);
      }
      return resolve(...data);
    });
  });

export const getBasicAuthToken = (req): string => {
  const header = req.headers.authorization || '';
  const token = header.split(/\s+/).pop() || '';
  return new Buffer(token, 'base64').toString();
};

export const fnLoader = (fnName: string) =>
  fs.readFileSync(path.join(__dirname, '..', 'functions', `${fnName}.js`), 'utf8');
