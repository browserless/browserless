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
  mimeTypes,
} from '@browserless.io/browserless';
import { ServerResponse } from 'http';
import { createReadStream } from 'fs';
import path from 'path';

const pathMap: Map<
  string,
  {
    contentType: string | undefined;
    path: string;
  }
> = new Map();

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
    const fileCache = pathMap.get(pathname);

    if (fileCache) {
      return streamFile(logger, res, fileCache.path, fileCache.contentType);
    }

    const config = this.config();
    const sdkDir = this.staticSDKDir();
    const file = path.join(config.getStatic(), pathname);
    const indexFile = path.join(file, 'index.html');
    const locations = [file, indexFile];

    if (sdkDir) {
      const sdkPath = path.join(sdkDir, pathname);
      locations.push(...[sdkPath, path.join(sdkPath, 'index.html')]);
    }

    if (pathname.includes('/debugger/') && !(await config.hasDebugger())) {
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
    logger.info(`Found new file "${foundFilePath}", caching path and serving`);

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
