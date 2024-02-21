import {
  APITags,
  HTTPManagementRoutes,
  HTTPRoute,
  Methods,
  NotFound,
  Request,
  contentTypes,
  createLogger,
  fileExists,
  mimeTypes,
} from '@browserless.io/browserless';
import { ServerResponse } from 'http';
import { createReadStream } from 'fs';
import path from 'path';

const debug = createLogger('http:static');
const verbose = createLogger('http:static:verbose');

const pathMap: Map<
  string,
  {
    contentType: string | undefined;
    path: string;
  }
> = new Map();

const streamFile = (res: ServerResponse, file: string, contentType?: string) =>
  new Promise((resolve, reject) => {
    if (contentType) {
      verbose(`Setting content-type ${contentType}`);
      res.setHeader('Content-Type', contentType);
    }

    return createReadStream(file)
      .on('error', (error) => {
        if (error) {
          debug(`Error finding file ${file}, sending 404`);
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
  accepts = [contentTypes.any];
  auth = false;
  browser = null;
  concurrency = false;
  contentTypes = [contentTypes.any];
  description = `Serves static files inside of this "static" directory. Content-types will vary depending on the type =of file being returned.`;
  method = Methods.get;
  path = HTTPManagementRoutes.static;
  tags = [APITags.management];
  handler = async (req: Request, res: ServerResponse): Promise<unknown> => {
    const { pathname } = req.parsed;
    const fileCache = pathMap.get(pathname);

    if (fileCache) {
      return streamFile(res, fileCache.path, fileCache.contentType);
    }

    const config = this.config();
    const file = path.join(config.getStatic(), pathname);
    const indexFile = path.join(file, 'index.html');

    const filePath = (
      await Promise.all([
        fileExists(file).then((exists) => (exists ? file : undefined)),
        fileExists(indexFile).then((exists) =>
          exists ? indexFile : undefined,
        ),
      ])
    ).find((_) => !!_);

    if (!filePath) {
      throw new NotFound(
        `No route or file found for resource ${req.method}: ${pathname}`,
      );
    }

    verbose(`Found new file "${filePath}", caching path and serving`);

    const contentType = mimeTypes.get(path.extname(filePath));

    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }

    // Cache the assets location so we don't have to
    // do stat checks again when requests come back
    pathMap.set(pathname, {
      contentType,
      path: filePath,
    });

    return streamFile(res, filePath, contentType);
  };
}
