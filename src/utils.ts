import * as cookie from 'cookie';
import * as express from 'express';
import * as fs from 'fs';
import { IncomingMessage } from 'http';
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

import { WORKSPACE_DIR } from './config';

import {
  IWebdriverStartHTTP,
  IWebdriverStartNormalized,
  IWorkspaceItem,
  IUpgradeHandler,
  IRequestHandler,
  IHTTPRequest,
  ILaunchOptions,
} from './types';

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

const legacyChromeOptionsKey = 'chromeOptions';
const w3cChromeOptionsKey = 'goog:chromeOptions';

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

  return await readFilesRecursive(dir);
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
        socket.write(Buffer.from('Bad Request, ' + error.message));
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

    if (typeof req.query.body !== 'string') {
      return res.status(400).send(`The query-parameter "body" is required, and must be a URL-encoded JSON object.`);
    }

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

export const normalizeWebdriverStart = async (req: IncomingMessage): Promise<IWebdriverStartNormalized> => {
  const body = await readRequestBody(req);
  const parsed = safeParse(body);
  let isUsingTempDataDir: boolean;

  // Make old selenium requests bw compatible
  if (_.has(parsed, ['desiredCapabilities', legacyChromeOptionsKey])) {
    parsed.desiredCapabilities[w3cChromeOptionsKey] = _.cloneDeep(parsed.desiredCapabilities[legacyChromeOptionsKey]);
    delete parsed.desiredCapabilities[legacyChromeOptionsKey];
  }

  if (_.has(parsed, ['capabilities', 'alwaysMatch', legacyChromeOptionsKey])) {
    parsed.capabilities.alwaysMatch[w3cChromeOptionsKey] = _.cloneDeep(
      parsed.capabilities.alwaysMatch[legacyChromeOptionsKey] ||
      parsed.desiredCapabilities[w3cChromeOptionsKey],
    );
    delete parsed.capabilities.alwaysMatch[legacyChromeOptionsKey];
  }

  if (
    _.has(parsed, ['capabilities', 'firstMatch']) &&
    _.some(parsed.capabilities.firstMatch, (opt) => opt[legacyChromeOptionsKey])
  ) {
    _.each(parsed.capabilities.firstMatch, (opt) => {
      if (opt[legacyChromeOptionsKey]) {
        opt[w3cChromeOptionsKey] = _.cloneDeep(opt[legacyChromeOptionsKey]);
        delete opt[legacyChromeOptionsKey];
      }
    });
  }

  const launchArgs = _.uniq([
    ..._.get(parsed, ['desiredCapabilities', w3cChromeOptionsKey, 'args'], []) as string[],
    ..._.get(parsed, ['capabilities', 'alwaysMatch', w3cChromeOptionsKey, 'args'], []) as string[],
    ..._.get(parsed, ['capabilities', 'firstMatch', '0', w3cChromeOptionsKey, 'args'], []) as string[],
  ]);

  // Set a temp data dir
  isUsingTempDataDir = !launchArgs.some((arg: string) => arg.startsWith('--user-data-dir'));

  const browserlessDataDir = isUsingTempDataDir ? await getUserDataDir() : null;

  // Set binary path and user-data-dir
  if (_.has(parsed, ['desiredCapabilities', w3cChromeOptionsKey])) {
    if (isUsingTempDataDir) {
      parsed.desiredCapabilities[w3cChromeOptionsKey].args = parsed.desiredCapabilities[w3cChromeOptionsKey].args || [];
      parsed.desiredCapabilities[w3cChromeOptionsKey].args.push(`--user-data-dir=${browserlessDataDir}`);
    }
    parsed.desiredCapabilities[w3cChromeOptionsKey].binary = CHROME_BINARY_LOCATION;
  }

  if (_.has(parsed, ['capabilities', 'alwaysMatch', w3cChromeOptionsKey])) {
    if (isUsingTempDataDir) {
      parsed.capabilities.alwaysMatch[w3cChromeOptionsKey].args = parsed.capabilities.alwaysMatch[w3cChromeOptionsKey].args || [];
      parsed.capabilities.alwaysMatch[w3cChromeOptionsKey].args.push(`--user-data-dir=${browserlessDataDir}`);
    }
    parsed.capabilities.alwaysMatch[w3cChromeOptionsKey].binary = CHROME_BINARY_LOCATION;
  }

  if (
    _.has(parsed, ['capabilities', 'firstMatch']) &&
    _.some(parsed.capabilities.firstMatch, (opt) => opt[w3cChromeOptionsKey])
  ) {
    _.each(parsed.capabilities.firstMatch, (opt) => {
      if (opt[w3cChromeOptionsKey]) {
        if (isUsingTempDataDir) {
          opt[w3cChromeOptionsKey].args = opt[w3cChromeOptionsKey].args || [];
          opt[w3cChromeOptionsKey].args.push(`--user-data-dir=${browserlessDataDir}`);
        }
        opt[w3cChromeOptionsKey].binary = CHROME_BINARY_LOCATION;
      }
    });
  }

  const stringifiedBody = JSON.stringify(parsed, null, '');

  req.headers['content-length'] = stringifiedBody.length.toString();
  attachBodyToRequest(req, stringifiedBody);

  const blockAds = !!parsed.desiredCapabilities['browserless.blockAds'];
  const trackingId = parsed.desiredCapabilities['browserless.trackingId'] || null;
  const pauseOnConnect = !!parsed.desiredCapabilities['browserless.pause'];
  const windowSizeArg = launchArgs.find((arg) => arg.includes('window-size='));
  const windowSizeParsed = windowSizeArg && windowSizeArg.split('=')[1].split(',');

  let windowSize;

  if (Array.isArray(windowSizeParsed)) {
    const [ width, height ] = windowSizeParsed;
    windowSize = {
      width: +width,
      height: +height,
    };
  }

  return {
    body: parsed,
    params: {
      blockAds,
      trackingId,
      pauseOnConnect,
      windowSize,
      isUsingTempDataDir,
      browserlessDataDir,
    }
  };
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
        const final = Buffer.concat(body).toString();
        if (hasResolved) {
          return;
        }
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

export const canPreboot = (incoming: ILaunchOptions, defaults: ILaunchOptions) => {
  if (!_.isUndefined(incoming.headless) && incoming.headless !== defaults.headless) {
    return false;
  }

  if (!_.isUndefined(incoming.args) && _.difference(incoming.args, defaults.args as string[]).length) {
    return false;
  }

  if (!_.isUndefined(incoming.ignoreDefaultArgs)) {
    if (typeof incoming.ignoreDefaultArgs !== typeof defaults.ignoreDefaultArgs) {
      return false;
    }

    if (Array.isArray(incoming.ignoreDefaultArgs) && Array.isArray(defaults.ignoreDefaultArgs)) {
      return !_.difference(incoming.ignoreDefaultArgs, defaults.ignoreDefaultArgs).length;
    }

    if (incoming.ignoreDefaultArgs !== defaults.ignoreDefaultArgs) {
      return false;
    }
  }

  if (!_.isUndefined(incoming.userDataDir) && incoming.userDataDir !== defaults.userDataDir) {
    return false;
  }

  return true;
};

export const dedent = (
  strings: string | string[],
  ...values: string[]
) => {
  const raw = Array.isArray(strings) ? strings : [strings];

  let result = '';

  for (let i = 0; i < raw.length; i++) {
    result += raw[i]
      // join lines when there is a suppressed newline
      .replace(/\\\n[ \t]*/g, '')
      // handle escaped backticks
      .replace(/\\`/g, '`');

    if (i < values.length) {
      result += values[i];
    }
  }

  // now strip indentation
  const lines = result.split('\n');
  let mIndent: number | null = null;
  lines.forEach(l => {
    const m = l.match(/^(\s+)\S+/);
    if (m) {
      const indent = m[1].length;
      if (!mIndent) {
        // this is the first indented line
        mIndent = indent;
      } else {
        mIndent = Math.min(mIndent, indent);
      }
    }
  });

  if (mIndent !== null) {
    const m = mIndent;
    result = lines.map(l => l[0] === ' ' ? l.slice(m) : l).join('\n');
  }

  return result
    // dedent eats leading and trailing whitespace too
    .trim()
    // handle escaped newlines at the end to ensure they don't get stripped too
    .replace(/\\n/g, '\n');
}
