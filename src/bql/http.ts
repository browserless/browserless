import type {
  BQLBrowserAPIOptions,
  BrowserQL,
  Request,
} from '@browserless.io/browserless';
import { jsonChunks, prepareJSON } from './json.js';
import type { ServerResponse } from 'node:http';

export interface BodySchema {
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
}

export interface ResponseSchema {
  data?: Record<string, unknown> | null;
  errors?: Array<{ message: string; [key: string]: unknown }>;
  extensions?: Record<string, unknown>;
}

/** Prepares before sending headers, then streams JSON with bounded buffering. */
export async function writeBQLJSON(
  res: ServerResponse,
  value: unknown,
  indentation?: number | string,
): Promise<void> {
  if (res.destroyed || res.writableEnded) return;
  const prepared = prepareJSON(value, indentation);
  if (prepared !== undefined) {
    for (const chunk of jsonChunks(prepared)) {
      if (res.destroyed || res.writableEnded) return;
      if (!res.write(chunk)) {
        const drained = await new Promise<boolean>((resolve, reject) => {
          const cleanup = () => {
            res.off('drain', onDrain);
            res.off('close', onClose);
            res.off('error', onError);
          };
          const onDrain = () => {
            cleanup();
            resolve(true);
          };
          const onClose = () => {
            cleanup();
            resolve(false);
          };
          const onError = (error: Error) => {
            cleanup();
            reject(error);
          };
          res.once('drain', onDrain);
          res.once('close', onClose);
          res.once('error', onError);
          if (res.destroyed || res.writableEnded) onClose();
        });
        if (!drained) return;
      }
    }
  }
  if (!res.destroyed && !res.writableEnded) {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        res.off('finish', onFinish);
        res.off('close', onFinish);
        res.off('error', onError);
      };
      const onFinish = () => {
        cleanup();
        resolve();
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      res.once('finish', onFinish);
      res.once('close', onFinish);
      res.once('error', onError);
      try {
        res.end();
      } catch (error) {
        onError(error as Error);
      }
    });
  }
}

/** Runs one HTTP operation and disposes its context, including on disconnect. */
export async function handleBQLHTTP(
  req: Request,
  res: ServerResponse,
  browser: BQLBrowserAPIOptions['browser'],
  bql: Pick<BrowserQL, 'createContext' | 'execute' | 'capabilities'>,
  options: Pick<BQLBrowserAPIOptions, 'config' | 'logger'>,
): Promise<void> {
  const respond = (status: number, result: unknown) => {
    if (res.destroyed || res.headersSent) return;
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('X-BQL-Capabilities', bql.capabilities.join(','));
    return writeBQLJSON(res, result);
  };
  const body = req.body as BodySchema | undefined;
  if (
    !body ||
    typeof body.query !== 'string' ||
    (body.operationName != null && typeof body.operationName !== 'string') ||
    (body.variables != null &&
      (typeof body.variables !== 'object' || Array.isArray(body.variables)))
  ) {
    await respond(400, {
      errors: [{ message: 'Invalid GraphQL request body' }],
    });
    return;
  }
  const context = bql.createContext({
    ...options,
    req,
    browser,
    blockConsentModals: false,
  });
  let closing: Promise<void> | undefined;
  const close = () => (closing ??= context.close());
  const onClose = () => {
    void close().catch((error) =>
      options.logger.error('Error closing BQL context', error),
    );
  };
  res.once('close', onClose);
  try {
    await respond(200, await bql.execute(body, context));
  } catch (error) {
    options.logger.error('BQL execution failed', error);
    if (res.headersSent) res.destroy();
    else await respond(500, { errors: [{ message: 'Internal server error' }] });
  } finally {
    res.off('close', onClose);
    await close();
  }
}
