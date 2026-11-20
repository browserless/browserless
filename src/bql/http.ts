import type {
  BQLBrowserAPIOptions,
  BrowserQL,
  Request,
} from '@browserless.io/browserless';
import { jsonChunks, prepareJSON } from './json.js';
import type { ServerResponse } from 'node:http';

// Internal to the SDK: a detached transfer holds normal limiter capacity.
export const pendingBQLDeliveries = new WeakMap<object, Promise<void>>();

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
  stallMs = 30_000,
): Promise<void> {
  if (res.destroyed || res.writableEnded) return;
  await transfer(res, prepareJSON(value, indentation), stallMs);
}

/** Hand off only after preparation and the first write succeed. The transfer
 * owns the snapshot, backpressure and late failures, not the browser or job. */
export function startBQLJSON(
  res: ServerResponse,
  value: unknown,
  logger: Pick<BQLBrowserAPIOptions['logger'], 'error'>,
  indentation?: number | string,
): Promise<void> {
  if (res.destroyed || res.writableEnded) return Promise.resolve();
  const prepared = prepareJSON(value, indentation);
  return new Promise<void>((resolve, reject) => {
    let started = false;
    const handoff = () => {
      started = true;
      resolve();
    };
    const delivery = transfer(res, prepared, 30_000, handoff)
      .finally(() => pendingBQLDeliveries.delete(res))
      .then(resolve, (error) => {
        if (!started) return reject(error);
        logger.error('BQL response transfer failed', error);
        res.destroy();
      });
    pendingBQLDeliveries.set(res, delivery);
  });
}

async function transfer(
  res: ServerResponse,
  prepared: ReturnType<typeof prepareJSON>,
  stallMs: number,
  handoff?: () => void,
): Promise<void> {
  const deadline = setTimeout(
    () => res.destroy(new Error('BQL response delivery deadline exceeded')),
    5 * 60_000,
  ).unref();
  try {
    await writeChunks(res, prepared, stallMs, handoff);
  } finally {
    clearTimeout(deadline);
  }
}

async function writeChunks(
  res: ServerResponse,
  prepared: ReturnType<typeof prepareJSON>,
  stallMs: number,
  handoff?: () => void,
): Promise<void> {
  const onStall = () => res.destroy(new Error('BQL response transfer stalled'));
  if (prepared !== undefined) {
    for (const chunk of jsonChunks(prepared)) {
      if (res.destroyed || res.writableEnded) return;
      const ready = res.write(chunk);
      handoff?.();
      handoff = undefined;
      if (!ready) {
        const drained = await new Promise<boolean>((resolve, reject) => {
          const timer = setTimeout(onStall, stallMs).unref();
          const cleanup = () => {
            clearTimeout(timer);
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
      const timer = setTimeout(onStall, stallMs).unref();
      const cleanup = () => {
        clearTimeout(timer);
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
        handoff?.();
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
  if (res.destroyed || res.writableFinished) return;
  const respond = (status: number, result: unknown) => {
    if (res.destroyed || res.headersSent) return;
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('X-BQL-Capabilities', bql.capabilities.join(','));
    return startBQLJSON(res, result, options.logger);
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
