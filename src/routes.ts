import archiver = require('archiver');
import * as bodyParser from 'body-parser';
import { Request, Response, Router } from 'express';
import * as _ from 'lodash';
import * as multer from 'multer';
import * as path from 'path';

import * as chromeHelper from './chrome-helper';
import { MAX_PAYLOAD_SIZE } from './config';
import { IBrowserlessOptions } from './models/options.interface';
import { PuppeteerProvider } from './puppeteer-provider';

import {
  asyncWebHandler,
  bodyValidation,
  buildWorkspaceDir,
  exists,
  fnLoader,
  generateChromeTarget,
  lstat,
} from './utils';

import {
  content as contentSchema,
  fn as fnSchema,
  pdf as pdfSchema,
  screenshot as screenshotSchema,
  stats as statsSchema,
} from './schemas';

import {
  after as downloadAfter,
  before as downloadBefore,
} from './apis/download';

import {
  after as screencastAfter,
  before as screenCastBefore,
} from './apis/screencast';

const version = require('../version.json');
const protocol = require('../protocol.json');
const hints = require('../hints.json');
const rimraf = require('rimraf');

// Browserless fn's
const screenshot = fnLoader('screenshot');
const content = fnLoader('content');
const pdf = fnLoader('pdf');
const stats = fnLoader('stats');

const jsonParser = bodyParser.json({
  limit: MAX_PAYLOAD_SIZE,
  type: ['application/json'],
});
const jsParser = bodyParser.text({
  limit: MAX_PAYLOAD_SIZE,
  type: ['text/plain', 'application/javascript'],
});
const htmlParser = bodyParser.text({
  limit: MAX_PAYLOAD_SIZE,
  type: ['text/plain', 'text/html'],
});

interface IGetRoutes {
  puppeteerProvider: PuppeteerProvider;
  getMetrics: () => IBrowserlessStats[];
  getConfig: () => IBrowserlessOptions;
  getPressure: () => any;
  workspaceDir: string;
}

export const getRoutes = ({
  puppeteerProvider,
  getMetrics,
  getConfig,
  getPressure,
  workspaceDir,
}: IGetRoutes): Router => {
  const router = Router();
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, workspaceDir);
    },
    filename: (_req, file, cb) => {
      cb(null, file.originalname);
    },
  });
  const upload = multer({ storage }).any();
  const config = getConfig();

  router.get('/introspection', (_req, res) => res.json(hints));
  router.get('/json/version', (_req, res) => res.json(version));
  router.get('/json/protocol', (_req, res) => res.json(protocol));
  router.get('/metrics', (_req, res) => res.json(getMetrics()));
  router.get('/config', (_req, res) => res.json(config));

  router.get('/workspace', async (_req, res) => {
    const downloads = await buildWorkspaceDir(workspaceDir);

    if (!downloads) {
      return res.json([]);
    }

    return res.json(downloads);
  });

  router.post('/workspace', async (req: any, res) => {
    upload(req, res, (err) => {
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

    if (!hasFile) {
      return res.sendStatus(404);
    }

    rimraf(filePath, _.noop);

    return res.sendStatus(204);
  });

  router.post('/download', jsonParser, jsParser, asyncWebHandler(async (req: Request, res: Response) => {
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
  }));

  router.get('/pressure', (_req, res) =>
    res.json({
      pressure: getPressure(),
    }),
  );

  // function route for executing puppeteer scripts, accepts a JSON body with
  // code and context
  router.post('/function',
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

  router.get('/kill/all', async (_req, res) => {
    await chromeHelper.killAll();

    return res.sendStatus(204);
  });

  // Screen cast route -- we inject some fun stuff here so that it all works properly :)
  router.post('/screencast', jsonParser, jsParser, asyncWebHandler(async (req: Request, res: Response) => {
    const isJson = typeof req.body === 'object';
    const code = isJson ? req.body.code : req.body;
    const context = isJson ? req.body.context : {};

    return puppeteerProvider.runHTTP({
      after: screencastAfter,
      before: screenCastBefore,
      code,
      context,
      flags: [
        '--enable-usermedia-screen-capturing',
        '--allow-http-screen-capture',
        '--auto-select-desktop-capture-source=browserless-screencast',
        '--load-extension=' + path.join(__dirname, '..', 'extensions', 'screencast'),
        '--disable-extensions-except=' + path.join(__dirname, '..', 'extensions', 'screencast'),
        '--disable-infobars',
      ],
      headless: false,
      req,
      res,
    });
  }));

  // Helper route for capturing screenshots, accepts a POST body containing a URL and
  // puppeteer's screenshot options (see the schema in schemas.ts);
  router.post('/screenshot',
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

  // Helper route for capturing content body, accepts a POST body containing a URL
  // (see the schema in schemas.ts);
  router.post('/content',
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

  // Helper route for capturing screenshots, accepts a POST body containing a URL and
  // puppeteer's screenshot options (see the schema in schemas.ts);
  router.post('/pdf',
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

  // Helper route for capturing stats, accepts a POST body containing a URL
  router.post('/stats', jsonParser, bodyValidation(statsSchema), asyncWebHandler(async (req: Request, res: Response) =>
    puppeteerProvider.runHTTP({
      code: stats,
      context: req.body,
      req,
      res,
    }),
  ));

  router.get('/json/new', asyncWebHandler(async (req: Request, res: Response) => {
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
  }));

  router.get('/json*', asyncWebHandler(async (req: Request, res: Response) => {
    const targetId = generateChromeTarget();
    const baseUrl = req.get('host');
    const protocol = req.protocol.includes('s') ? 'wss' : 'ws';

    res.json([{
      description: '',
      devtoolsFrontendUrl: `/devtools/inspector.html?${protocol}=${baseUrl}${targetId}`,
      targetId,
      title: 'about:blank',
      type: 'page',
      url: 'about:blank',
      webSocketDebuggerUrl: `${protocol}://${baseUrl}${targetId}`,
    }]);
  }));

  if (config.enableDebugViewer) {
    router.get('/sessions', asyncWebHandler(async (_req: Request, res: Response) => {
      const pages = await chromeHelper.getDebuggingPages();

      return res.json(pages);
    }));
  }

  return router;
};
