import { mkdir } from 'fs/promises';
import path from 'path';

import archiver from 'archiver';
import express, { Request, Response, Router } from 'express';
import _ from 'lodash';
import multer from 'multer';

import {
  after as downloadAfter,
  before as downloadBefore,
} from './apis/download';
import {
  after as screencastAfter,
  before as screenCastBefore,
} from './apis/screencast';
import * as chromeHelper from './chrome-helper';
import { MAX_PAYLOAD_SIZE } from './config';
import { Features } from './features';
import { PuppeteerProvider } from './puppeteer-provider';
import {
  content as contentSchema,
  fn as fnSchema,
  pdf as pdfSchema,
  scrape as scrapeSchema,
  screenshot as screenshotSchema,
  stats as statsSchema,
} from './schemas';
import swaggerDef from './swagger';
import { IBrowserlessOptions, IBrowserlessStats, Feature } from './types.d';

import {
  asyncWebHandler,
  bodyValidation,
  buildWorkspaceDir,
  exists,
  fnLoader,
  generateChromeTarget,
  lstat,
  queryValidation,
} from './utils';

const rimraf = require('rimraf');

// Browserless fn's
const screenshot = fnLoader('screenshot');
const content = fnLoader('content');
const scrape = fnLoader('scrape');
const pdf = fnLoader('pdf');
const stats = fnLoader('stats');

const jsonParser = express.json({
  limit: MAX_PAYLOAD_SIZE,
  type: ['application/json'],
});

const jsParser = express.text({
  limit: MAX_PAYLOAD_SIZE,
  type: ['text/plain', 'application/javascript'],
});

const htmlParser = express.text({
  limit: MAX_PAYLOAD_SIZE,
  type: ['text/plain', 'text/html'],
});

interface IGetRoutes {
  puppeteerProvider: PuppeteerProvider;
  getMetrics: () => IBrowserlessStats[];
  getConfig: () => IBrowserlessOptions;
  getPressure: () => any;
  workspaceDir: string;
  disabledFeatures: Feature[];
  enableAPIGet: boolean;
  enableHeapdump: boolean;
}

export const getRoutes = ({
  puppeteerProvider,
  getMetrics,
  getConfig,
  getPressure,
  workspaceDir,
  disabledFeatures,
  enableAPIGet,
  enableHeapdump,
}: IGetRoutes): Router => {
  const router = Router();
  const storage = multer.diskStorage({
    destination: async (req, _file, cb) => {
      const trackingId = (req.query.trackingId || '') as string;

      if (
        ['/', '.', '\\'].some((routeLike) => trackingId.includes(routeLike))
      ) {
        return cb(new Error(`trackingId must not include paths`), workspaceDir);
      }

      const finalDest = path.join(workspaceDir, trackingId);

      if (trackingId && !(await exists(finalDest))) {
        await mkdir(finalDest);
      }

      cb(null, finalDest);
    },
    filename: (_req, file, cb) => {
      cb(null, file.originalname);
    },
  });
  const upload = multer({ storage }).any();
  const config = getConfig();

  if (!disabledFeatures.includes(Features.API_DOCS_ENDPOINT)) {
    const swagger = require('swagger-ui-express');
    router.use(
      '/docs',
      swagger.serve,
      swagger.setup(swaggerDef, {
        customCss: '.swagger-ui .topbar { display: none }',
      }),
    );
  }

  if (!disabledFeatures.includes(Features.METRICS_ENDPOINT)) {
    router.get('/metrics', async (_req, res) => res.json(await getMetrics()));
    router.get('/metrics/total', async (_req, res) => {
      const metrics = await getMetrics();
      const totals = metrics.reduce(
        (accum, metric) => ({
          successful: accum.successful + metric.successful,
          error: accum.error + metric.error,
          queued: accum.queued + metric.queued,
          rejected: accum.rejected + metric.rejected,
          unhealthy: accum.unhealthy + metric.unhealthy,
          timedout: accum.timedout + metric.timedout,
          totalTime: accum.totalTime + metric.totalTime,
          meanTime: accum.meanTime + metric.meanTime,
          maxTime: Math.max(accum.maxTime, metric.maxTime),
          minTime: Math.min(accum.minTime, metric.minTime),
          maxConcurrent: Math.max(accum.maxConcurrent, metric.maxConcurrent),
          sessionTimes: [...accum.sessionTimes, ...metric.sessionTimes],
        }),
        {
          successful: 0,
          error: 0,
          queued: 0,
          rejected: 0,
          unhealthy: 0,
          totalTime: 0,
          meanTime: 0,
          maxTime: 0,
          minTime: 0,
          maxConcurrent: 0,
          timedout: 0,
          sessionTimes: [],
        },
      );
      totals.meanTime = totals.meanTime / metrics.length;
      return res.json(totals);
    });
  }

  if (!disabledFeatures.includes(Features.CONFIG_ENDPOINT)) {
    router.get('/config', (_req, res) => res.json(config));
  }

  if (!disabledFeatures.includes(Features.WORKSPACES)) {
    router.get('/workspace', async (_req, res) => {
      const downloads = await buildWorkspaceDir(workspaceDir);

      if (!downloads) {
        return res.json([]);
      }

      return res.json(downloads);
    });

    router.post('/workspace', async (req, res) => {
      return upload(req, res, (err?: any) => {
        if (err) {
          return res.status(400).send(err.message);
        }

        return res.json(req.files);
      });
    });

    router.get(/^\/workspace\/(.*)/, async (req, res) => {
      const file = req.params[0];

      if (!file) {
        return res.sendStatus(400);
      }

      const filePath = path.join(workspaceDir, file);
      const hasFile = await exists(filePath);

      if (!filePath.includes(workspaceDir)) {
        return res.sendStatus(404);
      }

      if (!hasFile) {
        return res.sendStatus(404);
      }

      const stats = await lstat(filePath);

      if (stats.isDirectory()) {
        const zipStream = archiver('zip');
        zipStream.pipe(res);
        return zipStream.directory(filePath, false).finalize();
      }

      return res.sendFile(filePath, { dotfiles: 'allow' });
    });

    router.delete(/^\/workspace\/(.*)/, async (req, res) => {
      const file = req.params[0];

      if (!file) {
        return res.sendStatus(400);
      }

      const filePath = path.join(workspaceDir, file);
      const hasFile = await exists(filePath);

      if (!filePath.includes(workspaceDir)) {
        return res.sendStatus(404);
      }

      if (!hasFile) {
        return res.sendStatus(404);
      }

      rimraf(filePath, _.noop);

      return res.sendStatus(204);
    });
  }

  if (!disabledFeatures.includes(Features.DOWNLOAD_ENDPOINT)) {
    router.post(
      '/download',
      jsonParser,
      jsParser,
      asyncWebHandler(async (req: Request, res: Response) => {
        const isJson = typeof req.body === 'object';
        const code = isJson ? req.body.code : req.body;
        const context = isJson ? req.body.context : {};

        return puppeteerProvider.runHTTP({
          after: downloadAfter,
          before: downloadBefore,
          code,
          context,
          req,
          res,
        });
      }),
    );
  }

  if (!disabledFeatures.includes(Features.PRESSURE_ENDPOINT)) {
    router.get('/pressure', async (_req, res) =>
      res.json({
        pressure: await getPressure(),
      }),
    );
  }

  if (!disabledFeatures.includes(Features.FUNCTION_ENDPOINT)) {
    router.post(
      '/function',
      jsonParser,
      jsParser,
      bodyValidation(fnSchema),
      asyncWebHandler(async (req: Request, res: Response) => {
        const isJson = typeof req.body === 'object';
        const code = isJson ? req.body.code : req.body;
        const context = isJson ? req.body.context : {};
        const detached = isJson ? !!req.body.detached : false;

        return puppeteerProvider.runHTTP({
          code,
          context,
          detached,
          req,
          res,
        });
      }),
    );
  }

  if (!disabledFeatures.includes(Features.KILL_ENDPOINT)) {
    router.get('/kill/all', async (_req, res) => {
      await chromeHelper.killAll();

      return res.sendStatus(204);
    });

    router.get('/kill/:id', async (req, res) => {
      await chromeHelper.kill(req.params.id);

      return res.sendStatus(204);
    });
  }

  if (!disabledFeatures.includes(Features.SCREENCAST_ENDPOINT)) {
    // Screen cast route -- we inject some fun stuff here so that it all works properly :)
    router.post(
      '/screencast',
      jsonParser,
      jsParser,
      asyncWebHandler(async (req: Request, res: Response) => {
        const isJson = typeof req.body === 'object';
        const code = isJson ? req.body.code : req.body;
        const context = isJson ? req.body.context : {};

        return puppeteerProvider.runHTTP({
          after: screencastAfter,
          before: screenCastBefore,
          code,
          context,
          req,
          res,
          ignoreDefaultArgs: ['--enable-automation'],
        });
      }),
    );
  }

  if (!disabledFeatures.includes(Features.SCREENSHOT_ENDPOINT)) {
    enableAPIGet &&
      router.get(
        '/screenshot',
        queryValidation(screenshotSchema),
        asyncWebHandler(async (req: Request, res: Response) =>
          puppeteerProvider.runHTTP({
            code: screenshot,
            context: req.body,
            req,
            res,
          }),
        ),
      );

    router.post(
      '/screenshot',
      jsonParser,
      htmlParser,
      bodyValidation(screenshotSchema),
      asyncWebHandler(async (req: Request, res: Response) => {
        const isJson = typeof req.body === 'object';
        const context = isJson ? req.body : { html: req.body };

        return puppeteerProvider.runHTTP({
          code: screenshot,
          context,
          req,
          res,
        });
      }),
    );
  }

  if (!disabledFeatures.includes(Features.CONTENT_ENDPOINT)) {
    enableAPIGet &&
      router.get(
        '/content',
        queryValidation(contentSchema),
        asyncWebHandler(async (req: Request, res: Response) =>
          puppeteerProvider.runHTTP({
            code: content,
            context: req.body,
            req,
            res,
          }),
        ),
      );

    router.post(
      '/content',
      jsonParser,
      htmlParser,
      bodyValidation(contentSchema),
      asyncWebHandler(async (req: Request, res: Response) => {
        const isJson = typeof req.body === 'object';
        const context = isJson ? req.body : { html: req.body };

        return puppeteerProvider.runHTTP({
          code: content,
          context,
          req,
          res,
        });
      }),
    );
  }

  if (!disabledFeatures.includes(Features.SCRAPE_ENDPOINT)) {
    enableAPIGet &&
      router.get(
        '/scrape',
        queryValidation(scrapeSchema),
        asyncWebHandler(async (req: Request, res: Response) =>
          puppeteerProvider.runHTTP({
            code: scrape,
            context: req.body,
            req,
            res,
          }),
        ),
      );

    router.post(
      '/scrape',
      jsonParser,
      bodyValidation(scrapeSchema),
      asyncWebHandler(async (req: Request, res: Response) => {
        const isJson = typeof req.body === 'object';
        const context = isJson ? req.body : {};

        return puppeteerProvider.runHTTP({
          code: scrape,
          context,
          req,
          res,
        });
      }),
    );
  }

  if (!disabledFeatures.includes(Features.PDF_ENDPOINT)) {
    enableAPIGet &&
      router.get(
        '/pdf',
        queryValidation(pdfSchema),
        asyncWebHandler(async (req: Request, res: Response) =>
          puppeteerProvider.runHTTP({
            code: pdf,
            context: req.body,
            req,
            res,
          }),
        ),
      );

    router.post(
      '/pdf',
      jsonParser,
      htmlParser,
      bodyValidation(pdfSchema),
      asyncWebHandler(async (req: Request, res: Response) => {
        const isJson = typeof req.body === 'object';
        const context = isJson ? req.body : { html: req.body };

        return puppeteerProvider.runHTTP({
          code: pdf,
          context,
          req,
          res,
        });
      }),
    );
  }

  if (!disabledFeatures.includes(Features.STATS_ENDPOINT)) {
    enableAPIGet &&
      router.get(
        '/stats',
        queryValidation(statsSchema),
        asyncWebHandler(async (req: Request, res: Response) =>
          puppeteerProvider.runHTTP({
            builtin: ['url', 'child_process', 'path'],
            code: stats,
            context: req.body,
            external: ['tree-kill'],
            req,
            res,
          }),
        ),
      );

    router.post(
      '/stats',
      jsonParser,
      bodyValidation(statsSchema),
      asyncWebHandler(async (req: Request, res: Response) =>
        puppeteerProvider.runHTTP({
          builtin: ['url', 'child_process', 'path'],
          code: stats,
          context: req.body,
          external: ['tree-kill'],
          req,
          res,
        }),
      ),
    );
  }

  if (!disabledFeatures.includes(Features.DEBUG_VIEWER)) {
    router.get('/json/protocol', async (_req, res) => {
      try {
        return res.json(await chromeHelper.getProtocolJSON());
      } catch (err) {
        return res.status(400).send(err.message);
      }
    });

    router.get(
      '/json/new',
      asyncWebHandler(async (req: Request, res: Response) => {
        const targetId = generateChromeTarget();
        const baseUrl = req.get('host');
        const protocol = req.protocol.includes('s') ? 'wss' : 'ws';

        res.json({
          description: '',
          devtoolsFrontendUrl: `/devtools/inspector.html?${protocol}=${baseUrl}${targetId}`,
          targetId,
          title: 'about:blank',
          type: 'page',
          url: 'about:blank',
          webSocketDebuggerUrl: `${protocol}://${baseUrl}${targetId}`,
        });
      }),
    );

    router.get('/json/version', async (req, res) => {
      const baseUrl = req.get('host');
      const protocol = req.protocol.includes('s') ? 'wss' : 'ws';

      try {
        return res.json({
          ...(await chromeHelper.getVersionJSON()),
          webSocketDebuggerUrl: `${protocol}://${baseUrl}`,
        });
      } catch (err) {
        return res.status(400).send(err.message);
      }
    });

    router.get(
      '/json*',
      asyncWebHandler(async (req: Request, res: Response) => {
        const targetId = generateChromeTarget();
        const baseUrl = req.get('host');
        const protocol = req.protocol.includes('s') ? 'wss' : 'ws';

        res.json([
          {
            description: '',
            devtoolsFrontendUrl: `/devtools/inspector.html?${protocol}=${baseUrl}${targetId}`,
            targetId,
            title: 'about:blank',
            type: 'page',
            url: 'about:blank',
            webSocketDebuggerUrl: `${protocol}://${baseUrl}${targetId}`,
          },
        ]);
      }),
    );
  }

  if (!disabledFeatures.includes(Features.DEBUG_VIEWER)) {
    router.get(
      '/sessions',
      asyncWebHandler(async (req: Request, res: Response) => {
        const trackingId = req.query.trackingId as string | undefined;
        const pages = await chromeHelper.getDebuggingPages(trackingId);

        return res.json(pages);
      }),
    );
  }

  if (enableHeapdump) {
    const heapdump = require('heapdump');
    router.get('/heapdump', (_req, res) => {
      const heapLocation = path.join(workspaceDir, `heap-${Date.now()}`);
      heapdump.writeSnapshot(heapLocation, (err: Error) => {
        if (err) {
          return res.status(500).send(err.message);
        }

        return res.sendFile(heapLocation, () => rimraf(heapLocation, _.noop));
      });
    });
  }

  return router;
};
