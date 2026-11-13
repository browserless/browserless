import type {
  BQLBrowserAPIOptions,
  BrowserQL,
  Request,
} from '@browserless.io/browserless';
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
    res.end(JSON.stringify(result));
  };
  const body = req.body as BodySchema | undefined;
  if (
    !body ||
    typeof body.query !== 'string' ||
    (body.operationName != null && typeof body.operationName !== 'string') ||
    (body.variables != null &&
      (typeof body.variables !== 'object' || Array.isArray(body.variables)))
  ) {
    respond(400, { errors: [{ message: 'Invalid GraphQL request body' }] });
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
    respond(200, await bql.execute(body, context));
  } catch (error) {
    options.logger.error('BQL execution failed', error);
    respond(500, { errors: [{ message: 'Internal server error' }] });
  } finally {
    res.off('close', onClose);
    await close();
  }
}
