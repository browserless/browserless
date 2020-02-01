import * as cookie from 'cookie';
import * as express from 'express';
import * as fs from 'fs';
import { IncomingMessage, ServerResponse } from 'http';
import * as Joi from 'joi';
import * as _ from 'lodash';
import * as net from 'net';
import fetch from 'node-fetch';
import * as os from 'os';
import * as path from 'path';
import rmrf = require('rimraf');
import { PassThrough } from 'stream';
import * as url from 'url';
import * as util from 'util';

import { IWebdriverStartHTTP } from './browserless';
import { WORKSPACE_DIR } from './config';

const dbg = require('debug');
const { CHROME_BINARY_LOCATION } = require('../env');

const mkdtemp = util.promisify(fs.mkdtemp);

const characters = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export const jsonProtocolPrefix = 'BROWSERLESS';
export const exists = util.promisify(fs.exists);
export const lstat = util.promisify(fs.lstat);
export const readdir = util.promisify(fs.readdir);
export const writeFile = util.promisify(fs.writeFile);
export const mkdir = util.promisify(fs.mkdir);
export const rimraf = util.promisify(rmrf);
export const getDebug = (level: string) => dbg(`browserless:${level}`);

const webDriverPath = '/webdriver/session';
const webdriverSessionCloseReg = /^\/webdriver\/session\/((\w+$)|(\w+\/window))/;

const debug = getDebug('system');

type IUpgradeHandler = (req: IncomingMessage, socket: net.Socket, head: Buffer) => Promise<any>;
type IRequestHandler = (req: IncomingMessage, res: ServerResponse) => Promise<any>;

const legacyChromeOptions = 'chromeOptions';
const w3cChromeOptions = 'goog:chromeOptions';

export interface IHTTPRequest extends IncomingMessage {
  parsed: url.UrlWithParsedQuery;
}

export interface IHTTPRequestBody extends IncomingMessage {
  body: any;
}

export interface IWorkspaceItem {
  created: Date;
  isDirectory: boolean;
  name: string;
  path: string;
  size: number;
  workspaceId: string | null;
}

const readFilesRecursive = async (dir: string, results: IWorkspaceItem[] = []) => {
  const [, parentDir] = dir.split(WORKSPACE_DIR);
  const workspaceDir = _.chain(parentDir)
    .split(path.sep)
    .compact()
    .head()
    .value();

  const files = await readdir(dir);

  await Promise.all(files.map(async (file) => {
    const stats = await lstat(path.join(dir, file));

    if (stats.isDirectory()) {
      return readFilesRecursive(path.join(dir, file), results);
    }

    results.push({
      created: stats.birthtime,
      isDirectory: stats.isDirectory(),
      name: file,
      path: path.join('/workspace', parentDir, file),
      size: stats.size,
      workspaceId: workspaceDir || null,
    });

    return results;
  }));

  return results;
};

export const id = (prepend: string = '') =>
  prepend + Array.from({ length: prepend ? 32 - prepend.length : 32 }, () =>
    characters.charAt(Math.floor(Math.random() * characters.length)),
  ).join('');

export const buildWorkspaceDir = async (dir: string): Promise<IWorkspaceItem[] | null> => {
  const hasDownloads = await exists(dir);

  if (!hasDownloads) {
    return null;
  }

  return  await readFilesRecursive(dir);
};

export const getBasicAuthToken = (req: IncomingMessage): string => {
  const header = req.headers.authorization || '';
  const token = header.split(/\s+/).pop() || '';
  return Buffer.from(token, 'base64').toString().replace(':', '');
};

export const asyncWsHandler = (handler: IUpgradeHandler) => {
  return (req: IncomingMessage, socket: net.Socket, head: Buffer) => {
    Promise.resolve(handler(req, socket, head))
      .catch((error: Error) => {
        debug(`Error in WebSocket handler: ${error}`);
        socket.write([
          'HTTP/1.1 400 Bad Request',
          'Content-Type: text/plain; charset=UTF-8',
          'Content-Encoding: UTF-8',
          'Accept-Ranges: bytes',
          'Connection: keep-alive',
        ].join('\n') + '\n\n');
        socket.write('Bad Request, ', error.message);
        socket.end();
      });
  };
};

export const asyncWebHandler = (handler: IRequestHandler) => {
  return (req: express.Request, res: express.Response) => {
    Promise.resolve(handler(req, res))
      .catch((error) => {
        debug(`Error in route handler: ${error}`);
        res.status(400).send(error.message);
      });
  };
};

export const bodyValidation = (schema: Joi.Schema) => {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const header = req.header('content-type');
    if (header && !header.includes('json')) {
      return next();
    }

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

export const queryValidation = (schema: Joi.Schema) => {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    let inflated: string | null = null;

    try {
      inflated = JSON.parse(req.query.body);
    } catch {
      inflated = null;
    }

    if (!inflated) {
      return res.status(400).send(`The query-parameter "body" is required, and must be a URL-encoded JSON object.`);
    }

    const result = Joi.validate(inflated, schema);

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

export const isWebdriverAuthorized = (req: IncomingMessage, body: any, token: string) => {
  const authToken = (
    getBasicAuthToken(req) ||
    _.get(body, ['desiredCapabilities', 'browserless.token'], null)
  );

  if (authToken !== token) {
    return false;
  }

  return true;
};

export const isAuthorized = (req: IHTTPRequest, token: string) => {
  const cookies = cookie.parse(req.headers.cookie || '');
  const parsedUrl = req.parsed;
  const authToken = _.get(parsedUrl, 'query.token', null) ||
    getBasicAuthToken(req) ||
    cookies[tokenCookieName];

  if (authToken !== token) {
    return false;
  }

  return true;
};

export const fetchJson = (url: string, opts?: any) => fetch(url, opts)
  .then((res) => {
    if (!res.ok) { throw res; }
    return res.json();
  });

export const generateChromeTarget = () => {
  return `/devtools/page/${id(jsonProtocolPrefix)}`;
};

export const sleep = (time = 0) => {
  return new Promise((resolve) => {
    setTimeout(resolve, time);
  });
};

const safeParse = (maybeJson: any) => {
  try {
    return JSON.parse(maybeJson);
  } catch {
    return null;
  }
};

export const normalizeWebdriverStart = async (req: IncomingMessage): Promise<any> => {
  const body = await readRequestBody(req);
  const parsed = safeParse(body);

  // Make old selenium requests bw compatible
  if (_.has(parsed, ['desiredCapabilities', legacyChromeOptions])) {
    parsed.desiredCapabilities[w3cChromeOptions] = _.cloneDeep(parsed.desiredCapabilities[legacyChromeOptions]);
    delete parsed.desiredCapabilities[legacyChromeOptions];
  }

  if (_.has(parsed, ['capabilities', 'alwaysMatch'])) {
    parsed.capabilities.alwaysMatch[w3cChromeOptions] = _.cloneDeep(
      parsed.capabilities.alwaysMatch[legacyChromeOptions] ||
      parsed.desiredCapabilities[w3cChromeOptions],
    );
    delete parsed.capabilities.alwaysMatch[legacyChromeOptions];
  }

  if (
    _.has(parsed, ['capabilities', 'firstMatch']) &&
    _.some(parsed.capabilities.firstMatch, (opt) => opt[legacyChromeOptions])
  ) {
    _.each(parsed.capabilities.firstMatch, (opt) => {
      if (opt[legacyChromeOptions]) {
        opt[w3cChromeOptions] = _.cloneDeep(opt[legacyChromeOptions]);
        delete opt[legacyChromeOptions];
      }
    });
  }

  // Set binary path
  if (_.has(parsed, ['desiredCapabilities', w3cChromeOptions])) {
    parsed.desiredCapabilities[w3cChromeOptions].binary = CHROME_BINARY_LOCATION;
  }

  if (_.has(parsed, ['capabilities', 'alwaysMatch', w3cChromeOptions])) {
    parsed.capabilities.alwaysMatch[w3cChromeOptions].binary = CHROME_BINARY_LOCATION;
  }

  if (
    _.has(parsed, ['capabilities', 'firstMatch']) &&
    _.some(parsed.capabilities.firstMatch, (opt) => opt[w3cChromeOptions])
  ) {
    _.each(parsed.capabilities.firstMatch, (opt) => {
      if (opt[w3cChromeOptions]) {
        opt[w3cChromeOptions].binary = CHROME_BINARY_LOCATION;
      }
    });
  }

  const stringifiedBody = JSON.stringify(parsed, null, '');
  req.headers['content-length'] = stringifiedBody.length.toString();
  attachBodyToRequest(req, stringifiedBody);

  return parsed;
};

const attachBodyToRequest = (req: IncomingMessage, body: any) => {
  const bufferStream = new PassThrough();
  bufferStream.end(Buffer.from(body));

  Object.assign(req, bufferStream);
};

const readRequestBody = async (req: IncomingMessage): Promise<any> => {
  return new Promise((resolve) => {
    const body: Uint8Array[] = [];
    let hasResolved = false;

    const resolveNow = (results: any) => {
      if (hasResolved) {
        return;
      }
      hasResolved = true;
      attachBodyToRequest(req, results);
      resolve(results);
    };

    req
      .on('data', (chunk) => body.push(chunk))
      .on('end', () => {
        if (!req.complete || hasResolved) {
          resolveNow(null);
        }
        const final = Buffer.concat(body).toString();
        resolveNow(final);
      })
      .on('aborted', () => {
        resolveNow(null);
      })
      .on('error', () => {
        resolveNow(null);
      });
  });
};

export const fnLoader = (fnName: string) =>
  fs.readFileSync(path.join(__dirname, '..', 'functions', `${fnName}.js`), 'utf8');

const browserlessDataDirPrefix = 'browserless-data-dir-';

export const getUserDataDir = () => mkdtemp(path.join(os.tmpdir(), browserlessDataDirPrefix));

export const clearBrowserlessDataDirs = () => rimraf(path.join(os.tmpdir(), `${browserlessDataDirPrefix}*`));

export const parseRequest = (req: IncomingMessage): IHTTPRequest => {
  const ret: IHTTPRequest = req as IHTTPRequest;
  const parsed = url.parse(req.url || '', true);

  ret.parsed = parsed;

  return ret;
};

// Number = time in MS, undefined = no timeout, null = no timeout set and should use system-default
export const getTimeoutParam = (req: IHTTPRequest | IWebdriverStartHTTP): number | undefined | null => {
  const payloadTimer = (
    req.method === 'POST' &&
    req.url &&
    req.url.includes('webdriver') &&
    req.hasOwnProperty('body')
  ) ?
    _.get(req, ['body', 'desiredCapabilities', 'browserless.timeout'], null) :
    _.get(req, 'parsed.query.timeout', null);

  if (_.isArray(payloadTimer)) {
    return null;
  }

  const parsedTimer = _.parseInt(payloadTimer || '');

  if (_.isNaN(parsedTimer)) {
    return null;
  }

  if (parsedTimer === -1) {
    return undefined;
  }

  if (_.isNumber(parsedTimer)) {
    return parsedTimer;
  }

  return null;
};

export const isWebdriverStart = (req: IncomingMessage) => {
  return req.method?.toLowerCase() === 'post' && req.url === webDriverPath
};

export const isWebdriverClose = (req: IncomingMessage) => {
  return req.method?.toLowerCase() === 'delete' && webdriverSessionCloseReg.test(req.url || '')
};

export const isWebdriver = (req: IncomingMessage) => {
  return req.url?.includes(webDriverPath);
};
