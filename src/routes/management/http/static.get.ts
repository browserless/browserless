import {
  APITags,
  BrowserlessRoutes,
  HTTPManagementRoutes,
  HTTPRoute,
  Logger,
  Methods,
  NotFound,
  Request,
  contentTypes,
  fileExists,
  getTokenFromRequest,
  mimeTypes,
} from '@browserless.io/browserless';
import { createReadStream, promises as fs } from 'fs';
import { ServerResponse } from 'http';
import path from 'path';

const pathMap: Map<
  string,
  {
    contentType: string | undefined;
    path: string;
  }
> = new Map();

// The debugger UI ignores a fresh ?token= once a Browser URL is saved to
// localStorage (#5560); its repo is archived, so we patch the symptom here.
const DEBUGGER_INDEX_PATHS = new Set(['/debugger/', '/debugger/index.html']);
const DEBUGGER_TOKEN_RESET_SCRIPT =
  "<script>if(new URLSearchParams(location.search).has('token')){Object.keys(localStorage).filter((k)=>k.startsWith('browserless-debugger')).forEach((k)=>localStorage.removeItem(k));}</script>";

const injectDebuggerTokenResetScript = (
  html: string,
  logger: Logger,
): string => {
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(
      /<head[^>]*>/i,
      (tag) => `${tag}${DEBUGGER_TOKEN_RESET_SCRIPT}`,
    );
  }
  logger.warn(
    'Debugger index has no <head> tag; prepending the reset script instead',
  );
  return `${DEBUGGER_TOKEN_RESET_SCRIPT}${html}`;
};

const streamFile = (
  logger: Logger,
  res: ServerResponse,
  file: string,
  contentType?: string,
): Promise<void> =>
  new Promise((resolve, reject) => {
    if (contentType) {
      logger.debug(`Setting content-type ${contentType}`);
      res.setHeader('Content-Type', contentType);
    }

    return createReadStream(file)
      .on('error', (error) => {
        if (error) {
          logger.error(`Error finding file ${file}, sending 404`);
          pathMap.delete(file);
          return reject(
            new NotFound(`Request for file "${file}" was not found`),
          );
        }
      })
      .on('end', resolve)
      .pipe(res);
  });

export default class StaticGetRoute extends HTTPRoute {
  name = BrowserlessRoutes.StaticGetRoute;
  accepts = [contentTypes.any];
  auth = false;
  browser = null;
  concurrency = false;
  contentTypes = [contentTypes.any];
  description = `Serves static files inside of this "static" directory. Content-types will vary depending on the type =of file being returned.`;
  method = Methods.get;
  path = HTTPManagementRoutes.static;
  tags = [APITags.management];
  async handler(
    req: Request,
    res: ServerResponse,
    logger: Logger,
  ): Promise<unknown> {
    const { pathname } = req.parsed;
    const config = this.config();

    // `?token=` never reaches req.parsed — moveTokenToHeader() (src/shim.ts)
    // moves it to the Authorization header before routing. Compare against
    // the configured token(s) rather than just checking for any
    // Authorization header, since a proxy in front of browserless may set
    // that header unconditionally for unrelated reasons.
    const configuredToken = config.getToken();
    const requestToken = getTokenFromRequest(req);
    const resetDebuggerSettings =
      DEBUGGER_INDEX_PATHS.has(pathname) &&
      !!requestToken &&
      configuredToken !== null &&
      (Array.isArray(configuredToken)
        ? configuredToken
        : [configuredToken]
      ).includes(requestToken);
    const fileCache = pathMap.get(pathname);

    if (fileCache && !resetDebuggerSettings) {
      return streamFile(logger, res, fileCache.path, fileCache.contentType);
    }

    if (pathname === '/.well-known/appspecific/com.chrome.devtools.json') {
      const payload = JSON.stringify({
        workspace: {
          root: process.cwd(),
          uuid: 'browserless-devtools-workspace',
        },
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(payload);
      return;
    }

    const sdkDir = this.staticSDKDir();
    const file = path.join(config.getStatic(), pathname);
    const indexFile = path.join(file, 'index.html');
    const locations = [file, indexFile];

    if (sdkDir) {
      const sdkPath = path.join(sdkDir, pathname);
      locations.push(...[sdkPath, path.join(sdkPath, 'index.html')]);
    }

    if (
      (pathname === '/debugger' || pathname.startsWith('/debugger/')) &&
      !(await config.hasDebugger())
    ) {
      throw new NotFound(
        `No route or file found for resource ${req.method}: ${pathname}`,
      );
    }

    const foundFilePaths = (
      await Promise.all(
        locations.map((l) => fileExists(l).then((e) => (e ? l : undefined))),
      )
    ).filter((_) => !!_) as string[];

    if (!foundFilePaths.length) {
      throw new NotFound(
        `No route or file found for resource ${req.method}: ${pathname}`,
      );
    }

    if (foundFilePaths.length > 1) {
      logger.warn(
        `Multiple files found for request to "${pathname}". Only the first file is served, so please name your files uniquely.`,
      );
    }

    const [foundFilePath] = foundFilePaths;

    // If we resolved to a directory's index.html but the pathname lacks a
    // trailing slash, redirect so relative asset URLs resolve correctly.
    if (
      foundFilePath.endsWith('/index.html') &&
      !pathname.endsWith('/') &&
      !pathname.endsWith('/index.html')
    ) {
      const location = req.parsed.pathname + '/' + (req.parsed.search || '');
      res.writeHead(301, { Location: location });
      res.end();
      return;
    }

    if (resetDebuggerSettings) {
      logger.debug(
        `Serving debugger index with a localStorage reset script injected, since a valid token was provided`,
      );
      const html = await fs.readFile(foundFilePath, 'utf-8');
      res.setHeader('Content-Type', 'text/html');
      // The response content depends on the request's token, not just the
      // URL, so it must never be cached by a browser, CDN or proxy.
      res.setHeader('Cache-Control', 'no-store');
      res.end(injectDebuggerTokenResetScript(html, logger));
      return;
    }

    logger.debug(`Found new file "${foundFilePath}", caching path and serving`);

    const contentType = mimeTypes.get(path.extname(foundFilePath));

    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }

    // Cache the file as being found so we don't have to call 'stat'
    pathMap.set(pathname, {
      contentType,
      path: foundFilePath,
    });

    return streamFile(logger, res, foundFilePath, contentType);
  }
}
