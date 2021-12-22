import fs from 'fs';

import { IncomingMessage } from 'http';

import net from 'net';

import os from 'os';

import path from 'path';

import url from 'url';

import util from 'util';

import cookie from 'cookie';
import dbg from 'debug';
import express from 'express';

import { Schema } from 'joi';
import _ from 'lodash';

import fetch from 'node-fetch';

import rmrf from 'rimraf';

import { DEFAULT_BLOCK_ADS, DEFAULT_STEALTH, WORKSPACE_DIR } from './config';
import { WEBDRIVER_ROUTE } from './constants';

import {
  IWebdriverStartHTTP,
  IWebdriverStartNormalized,
  IWorkspaceItem,
  IUpgradeHandler,
  IRequestHandler,
  IHTTPRequest,
  ILaunchOptions,
  IBrowser,
  IDevtoolsJSON,
  ISession,
} from './types.d';

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

const webdriverSessionCloseReg =
  /^\/webdriver\/session\/((\w+$)|(\w+\/window))/;

const debug = getDebug('system');

const legacyChromeOptionsKey = 'chromeOptions';
const w3cChromeOptionsKey = 'goog:chromeOptions';

const readFilesRecursive = async (
  dir: string,
  results: IWorkspaceItem[] = [],
) => {
  const [, parentDir] = dir.split(WORKSPACE_DIR);
  const workspaceDir = _.chain(parentDir)
    .split(path.sep)
    .compact()
    .head()
    .value();

  const files = await readdir(dir);

  await Promise.all(
    files.map(async (file) => {
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
    }),
  );

  return results;
};

export const id = (prepend = '') =>
  prepend +
  Array.from({ length: prepend ? 32 - prepend.length : 32 }, () =>
    characters.charAt(Math.floor(Math.random() * characters.length)),
  ).join('');

export const buildWorkspaceDir = async (
  dir: string,
): Promise<IWorkspaceItem[] | null> => {
  const hasDownloads = await exists(dir);

  if (!hasDownloads) {
    return null;
  }

  return await readFilesRecursive(dir);
};

export const getBasicAuthToken = (req: IncomingMessage): string | undefined => {
  const header = req.headers.authorization || '';
  const username = header.split(/\s+/).pop() || '';
  const token = Buffer.from(username, 'base64').toString().replace(':', '');

  return token.length ? token : undefined;
};

export const asyncWsHandler = (handler: IUpgradeHandler) => {
  return (req: IncomingMessage, socket: net.Socket, head: Buffer) => {
    Promise.resolve(handler(req, socket, head)).catch((error: Error) => {
      debug(`Error in WebSocket handler: ${error}`);
      socket.write(
        [
          'HTTP/1.1 400 Bad Request',
          'Content-Type: text/plain; charset=UTF-8',
          'Content-Encoding: UTF-8',
          'Accept-Ranges: bytes',
          'Connection: keep-alive',
        ].join('\n') + '\n\n',
      );
      socket.write(Buffer.from('Bad Request, ' + error.message));
      socket.end();
    });
  };
};

export const asyncWebHandler = (handler: IRequestHandler) => {
  return (req: express.Request, res: express.Response) => {
    Promise.resolve(handler(req, res)).catch((error) => {
      debug(`Error in route handler: ${error}`);
      res.status(400).send(error.message);
    });
  };
};

export const bodyValidation = (schema: Schema) => {
  return (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    const header = req.header('content-type');
    if (header && !header.includes('json')) {
      return next();
    }

    const result = schema.validate(req.body);

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

export const queryValidation = (schema: Schema) => {
  return (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    let inflated: string | null = null;

    if (typeof req.query.body !== 'string') {
      return res
        .status(400)
        .send(
          `The query-parameter "body" is required, and must be a URL-encoded JSON object.`,
        );
    }

    try {
      inflated = JSON.parse(req.query.body);
    } catch {
      inflated = null;
    }

    if (!inflated) {
      return res
        .status(400)
        .send(
          `The query-parameter "body" is required, and must be a URL-encoded JSON object.`,
        );
    }

    const result = schema.validate(inflated);

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

export const isAuthorized = (req: IHTTPRequest, token: string) => {
  const cookies = cookie.parse(req.headers.cookie || '');
  const parsedUrl = req.parsed;
  const authToken =
    _.get(parsedUrl, 'query.token', null) ||
    getBasicAuthToken(req) ||
    cookies[tokenCookieName];

  if (authToken !== token) {
    return false;
  }

  return true;
};

export const fetchJson = (url: string, opts?: any) =>
  fetch(url, opts).then((res) => {
    if (!res.ok) {
      throw res;
    }
    return res.json();
  });

export const generateChromeTarget = () => {
  return `/devtools/page/${id(jsonProtocolPrefix)}`;
};

export const sleep = function sleep(time = 0) {
  return new Promise((r) => {
    global.setTimeout(r, time);
  });
};

const safeParse = (maybeJson: any) => {
  try {
    return JSON.parse(maybeJson);
  } catch {
    return null;
  }
};

export const normalizeWebdriverStart = async (
  req: IncomingMessage,
): Promise<IWebdriverStartNormalized> => {
  const body = await readRequestBody(req);
  const parsed = safeParse(body);

  let browserlessDataDir: string | null = null;

  // First, convert legacy chrome options to W3C spec
  if (_.has(parsed, ['desiredCapabilities', legacyChromeOptionsKey])) {
    parsed.desiredCapabilities[w3cChromeOptionsKey] = _.cloneDeep(
      parsed.desiredCapabilities[legacyChromeOptionsKey],
    );
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

  const capabilities = _.merge(
    {},
    parsed?.capabilities?.firstMatch?.['0'],
    parsed?.capabilities?.alwaysMatch,
    parsed?.desiredCapabilities,
  );

  const launchArgs = _.get(
    capabilities,
    [w3cChromeOptionsKey, 'args'],
    [],
  ) as string[];

  // Set a temp data dir
  const isUsingTempDataDir = !launchArgs.some((arg: string) =>
    arg.startsWith('--user-data-dir'),
  );
  browserlessDataDir = isUsingTempDataDir ? await getUserDataDir() : null;

  // Set binary path and user-data-dir
  if (_.has(parsed, ['desiredCapabilities', w3cChromeOptionsKey])) {
    if (isUsingTempDataDir) {
      parsed.desiredCapabilities[w3cChromeOptionsKey].args =
        parsed.desiredCapabilities[w3cChromeOptionsKey].args || [];
      parsed.desiredCapabilities[w3cChromeOptionsKey].args.push(
        `--user-data-dir=${browserlessDataDir}`,
      );
    }
    parsed.desiredCapabilities[w3cChromeOptionsKey].binary =
      CHROME_BINARY_LOCATION;
  }

  if (_.has(parsed, ['capabilities', 'alwaysMatch', w3cChromeOptionsKey])) {
    if (isUsingTempDataDir) {
      parsed.capabilities.alwaysMatch[w3cChromeOptionsKey].args =
        parsed.capabilities.alwaysMatch[w3cChromeOptionsKey].args || [];
      parsed.capabilities.alwaysMatch[w3cChromeOptionsKey].args.push(
        `--user-data-dir=${browserlessDataDir}`,
      );
    }
    parsed.capabilities.alwaysMatch[w3cChromeOptionsKey].binary =
      CHROME_BINARY_LOCATION;
  }

  if (
    _.has(parsed, ['capabilities', 'firstMatch']) &&
    _.some(parsed.capabilities.firstMatch, (opt) => opt[w3cChromeOptionsKey])
  ) {
    _.each(parsed.capabilities.firstMatch, (opt) => {
      if (opt[w3cChromeOptionsKey]) {
        if (isUsingTempDataDir) {
          opt[w3cChromeOptionsKey].args = opt[w3cChromeOptionsKey].args || [];
          opt[w3cChromeOptionsKey].args.push(
            `--user-data-dir=${browserlessDataDir}`,
          );
        }
        opt[w3cChromeOptionsKey].binary = CHROME_BINARY_LOCATION;
      }
    });
  }

  const blockAds = !!(
    capabilities['browserless.blockAds'] ??
    capabilities['browserless:blockAds'] ??
    DEFAULT_BLOCK_ADS
  );

  const stealth = !!(
    capabilities['browserless.stealth'] ??
    capabilities['browserless:stealth'] ??
    DEFAULT_STEALTH
  );

  const token =
    capabilities['browserless.token'] ??
    capabilities['browserless:token'] ??
    getBasicAuthToken(req);

  const pauseOnConnect = !!(
    capabilities['browserless.pause'] ?? capabilities['browserless:pause']
  );

  const trackingId =
    capabilities['browserless.trackingId'] ??
    capabilities['browserless:trackingId'] ??
    null;

  const windowSizeArg = launchArgs.find((arg) => arg.includes('window-size='));
  const windowSizeParsed =
    windowSizeArg && windowSizeArg.split('=')[1].split(',');
  let windowSize;

  if (Array.isArray(windowSizeParsed)) {
    const [width, height] = windowSizeParsed;
    windowSize = {
      width: +width,
      height: +height,
    };
  }

  return {
    body: parsed,
    params: {
      token,
      stealth,
      blockAds,
      trackingId,
      pauseOnConnect,
      windowSize,
      isUsingTempDataDir,
      browserlessDataDir,
    },
  };
};

// NOTE, if proxying request elsewhere, you must re-stream the body again
const readRequestBody = async (req: IncomingMessage): Promise<any> => {
  return new Promise((resolve) => {
    const body: Uint8Array[] = [];
    let hasResolved = false;

    const resolveNow = (results: any) => {
      if (hasResolved) {
        return;
      }
      hasResolved = true;
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
  fs.readFileSync(
    path.join(__dirname, '..', 'functions', `${fnName}.js`),
    'utf8',
  );

const browserlessDataDirPrefix = 'browserless-data-dir-';

export const getUserDataDir = () =>
  mkdtemp(path.join(os.tmpdir(), browserlessDataDirPrefix));

export const clearBrowserlessDataDirs = () =>
  rimraf(path.join(os.tmpdir(), `${browserlessDataDirPrefix}*`));

export const parseRequest = (req: IncomingMessage): IHTTPRequest => {
  const ret: IHTTPRequest = req as IHTTPRequest;
  const parsed = url.parse(req.url || '', true);

  ret.parsed = parsed;

  return ret;
};

// Number = time in MS, undefined = no timeout, null = no timeout set and should use system-default
export const getTimeoutParam = (
  req: IHTTPRequest | IWebdriverStartHTTP,
): number | undefined | null => {
  const payloadTimer =
    req.method === 'POST' &&
    req.url &&
    req.url.includes('webdriver') &&
    Object.prototype.hasOwnProperty.call(req, 'body')
      ? _.get(req, ['body', 'desiredCapabilities', 'browserless.timeout'], null)
      : _.get(req, 'parsed.query.timeout', null);

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
  return req.method?.toLowerCase() === 'post' && req.url === WEBDRIVER_ROUTE;
};

export const isWebdriverClose = (req: IncomingMessage) => {
  return (
    req.method?.toLowerCase() === 'delete' &&
    webdriverSessionCloseReg.test(req.url || '')
  );
};

export const isWebdriver = (req: IncomingMessage) => {
  return req.url?.includes(WEBDRIVER_ROUTE);
};

export const canPreboot = (
  incoming: ILaunchOptions,
  defaults: ILaunchOptions,
) => {
  if (incoming.playwright) {
    return false;
  }

  if (
    !_.isUndefined(incoming.headless) &&
    incoming.headless !== defaults.headless
  ) {
    return false;
  }

  if (
    !_.isUndefined(incoming.args) &&
    _.difference(incoming.args, defaults.args as string[]).length
  ) {
    return false;
  }

  if (!_.isUndefined(incoming.ignoreDefaultArgs)) {
    if (
      typeof incoming.ignoreDefaultArgs !== typeof defaults.ignoreDefaultArgs
    ) {
      return false;
    }

    if (
      Array.isArray(incoming.ignoreDefaultArgs) &&
      Array.isArray(defaults.ignoreDefaultArgs)
    ) {
      return !_.difference(
        incoming.ignoreDefaultArgs,
        defaults.ignoreDefaultArgs,
      ).length;
    }

    if (incoming.ignoreDefaultArgs !== defaults.ignoreDefaultArgs) {
      return false;
    }
  }

  if (
    !_.isUndefined(incoming.userDataDir) &&
    incoming.userDataDir !== defaults.userDataDir
  ) {
    return false;
  }

  return true;
};

export const dedent = (strings: string | string[], ...values: string[]) => {
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
  lines.forEach((l) => {
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
    result = lines.map((l) => (l[0] === ' ' ? l.slice(m) : l)).join('\n');
  }

  return (
    result
      // dedent eats leading and trailing whitespace too
      .trim()
      // handle escaped newlines at the end to ensure they don't get stripped too
      .replace(/\\n/g, '\n')
  );
};

export const urlJoinPaths = (...paths: string[]) =>
  paths.map((s) => _.trim(s, '/')).join('/');

export const injectHostIntoSession = (
  host: URL,
  browser: IBrowser,
  session: IDevtoolsJSON,
): ISession => {
  const { port } = browser._parsed;
  const wsEndpoint = browser._wsEndpoint;
  const isSSL = host.protocol === 'https:';

  if (!port) {
    throw new Error(`No port found for browser devtools!`);
  }

  const parsedWebSocketDebuggerUrl = new URL(session.webSocketDebuggerUrl);
  const parsedWsEndpoint = new URL(wsEndpoint);
  const parsedDevtoolsFrontendURL = new URL(
    session.devtoolsFrontendUrl,
    host.href,
  );

  // Override the URL primitives to the base host or proxy
  parsedWebSocketDebuggerUrl.hostname = host.hostname;
  parsedWebSocketDebuggerUrl.port = host.port;
  parsedWebSocketDebuggerUrl.protocol = isSSL ? 'wss:' : 'ws:';

  parsedWsEndpoint.hostname = host.hostname;
  parsedWsEndpoint.port = host.port;
  parsedWsEndpoint.protocol = isSSL ? 'wss:' : 'ws:';

  // Prepend any base-path of the external URL's
  if (host.pathname !== '/') {
    parsedWebSocketDebuggerUrl.pathname = urlJoinPaths(
      host.pathname,
      parsedWebSocketDebuggerUrl.pathname,
    );
    parsedWsEndpoint.pathname = urlJoinPaths(
      host.pathname,
      parsedWsEndpoint.pathname,
    );
    parsedDevtoolsFrontendURL.pathname = urlJoinPaths(
      host.pathname,
      parsedDevtoolsFrontendURL.pathname,
    );
  }

  parsedDevtoolsFrontendURL.search = `?${isSSL ? 'wss' : 'ws'}=${host.host}${
    parsedWebSocketDebuggerUrl.pathname
  }`;

  const browserWSEndpoint = parsedWsEndpoint.href;
  const webSocketDebuggerUrl = parsedWebSocketDebuggerUrl.href;
  const devtoolsFrontendUrl =
    parsedDevtoolsFrontendURL.pathname + parsedDevtoolsFrontendURL.search;

  return {
    ...session,
    port,
    browserId: browser._id,
    trackingId: browser._trackingId,
    browserWSEndpoint,
    devtoolsFrontendUrl,
    webSocketDebuggerUrl,
  };
};
