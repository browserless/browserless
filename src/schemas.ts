import * as Joi from 'joi';

const waitFor = [Joi.string(), Joi.number()];
const userAgent = Joi.string();

const gotoOptions = Joi.object().keys({
  timeout: Joi.number(),
  waitUntil: Joi.string()
    .valid('load', 'domcontentloaded', 'networkidle0', 'networkidle2'),
});

const authenticate = Joi.object().keys({
  password: Joi.string(),
  username: Joi.string(),
});

const setExtraHTTPHeaders = Joi.object().unknown();

const setJavaScriptEnabled = Joi.boolean();

const rejectRequestPattern = Joi.array().items(Joi.string()).default([]);

const addScriptTag = Joi.array().items(Joi.object().keys({
  url: Joi.string(),
  path: Joi.string(),
  content: Joi.string(),
  type: Joi.string(),
})).default([]);

const addStyleTag = Joi.array().items(Joi.object().keys({
  url: Joi.string(),
  path: Joi.string(),
  content: Joi.string(),
})).default([]);

const requestInterceptors = Joi.array().items(Joi.object().keys({
  pattern: Joi.string().required(),
  response: Joi.object().keys({
    body: Joi.alternatives([
      Joi.string(),
      Joi.binary(),
    ]).required(),
    contentType: Joi.string().required(),
    headers: Joi.object(),
    status: Joi.number().required(),
  }),
})).default([]);

const cookies = Joi.array().items(Joi.object({
  domain: Joi.string(),
  expires: Joi.number().min(0),
  httpOnly: Joi.boolean(),
  name: Joi.string().required(),
  path: Joi.string(),
  sameSite: Joi.string().valid('Strict', 'Lax'),
  secure: Joi.boolean(),
  url: Joi.string(),
  value: Joi.string().required(),
})).default([]);

const viewport = Joi.object().keys({
  deviceScaleFactor: Joi.number().min(0.01).max(100),
  hasTouch: Joi.boolean(),
  height: Joi.number().min(0).required(),
  isLandscape: Joi.boolean(),
  isMobile: Joi.boolean(),
  width: Joi.number().min(0).required(),
});

export const screenshot = Joi.object().keys({
  authenticate,
  addScriptTag,
  addStyleTag,
  cookies,
  gotoOptions,
  html: Joi.string(),
  manipulate: Joi.object().keys({
    resize: Joi.object().keys({
      width: Joi.number().integer().positive(),
      height: Joi.number().integer().positive(),
      fit: Joi.string()
        .valid('cover', 'contain', 'fill', 'inside', 'outside'),
      position: Joi.string()
        .valid('top', 'right top', 'right', 'right bottom', 'bottom', 'left bottom', 'left', 'left top')
    }),
    flip: Joi.boolean(),
    flop: Joi.boolean(),
    rotate: Joi.number(),
  }),
  options: Joi.object().keys({
    clip: Joi.object().keys({
      height: Joi.number().min(0),
      width: Joi.number().min(0),
      x: Joi.number().min(0),
      y: Joi.number().min(0),
    }),
    fullPage: Joi.boolean(),
    omitBackground: Joi.boolean(),
    quality: Joi.number().min(0).max(100),
    type: Joi.string().valid('jpeg', 'png'),
  }),
  rejectRequestPattern,
  requestInterceptors,
  setExtraHTTPHeaders,
  setJavaScriptEnabled,
  url: Joi.string(),
  userAgent,
  viewport,
  waitFor,
}).xor('url', 'html');

export const content = Joi.object().keys({
  authenticate,
  addScriptTag,
  addStyleTag,
  cookies,
  gotoOptions,
  rejectRequestPattern,
  requestInterceptors,
  setExtraHTTPHeaders,
  setJavaScriptEnabled,
  url: Joi.string().required(),
  userAgent,
  waitFor,
});

export const pdf = Joi.object().keys({
  authenticate,
  addScriptTag,
  addStyleTag,
  cookies,
  emulateMedia: Joi.string().valid('screen', 'print'),
  gotoOptions,
  html: Joi.string(),
  options: Joi.object().keys({
    displayHeaderFooter: Joi.boolean(),
    footerTemplate: Joi.string(),
    format: Joi.string()
      .valid('Letter', 'Legal', 'Tabloid', 'Ledger', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6'),
    headerTemplate: Joi.string(),
    height: Joi.any().optional(),
    landscape: Joi.boolean(),
    margin: Joi.object().keys({
      bottom: Joi.string(),
      left: Joi.string(),
      right: Joi.string(),
      top: Joi.string(),
    }),
    pageRanges: Joi.string(),
    preferCSSPageSize: Joi.boolean(),
    printBackground: Joi.boolean(),
    scale: Joi.number().min(0),
    width: Joi.any().optional(),
  }),
  rejectRequestPattern,
  requestInterceptors,
  rotate: Joi.number().valid(90, -90, 180),
  safeMode: Joi.boolean().default(
    false,
    'Whether to safely generate the PDF (renders pages one-at-a-time and merges it in-memory). ' +
    'Can prevent page crashes but is slower, consumes more memory, and returns a larger PDF.',
  ),
  setExtraHTTPHeaders,
  setJavaScriptEnabled,
  url: Joi.string(),
  userAgent,
  viewport,
  waitFor,
}).xor('url', 'html');

export const scrape = Joi.object().keys({
  authenticate,
  addScriptTag,
  addStyleTag,
  cookies,
  debug: Joi.object().keys({
    console: Joi.boolean().default(false),
    cookies: Joi.boolean().default(false),
    html: Joi.boolean().default(false),
    network: Joi.boolean().default(false),
    screenshot: Joi.boolean().default(false),
  }),
  elements: Joi.array().items(Joi.object({
    selector: Joi.string(),
    timeout: Joi.number(),
  })).required(),
  gotoOptions,
  rejectRequestPattern,
  requestInterceptors,
  setExtraHTTPHeaders,
  url: Joi.string().required(),
  userAgent,
  waitFor,
});

export const fn = Joi.object().keys({
  code: Joi.string().required(),
  context: Joi.object(),
  detached: Joi.boolean(),
});

export const stats = Joi.object().keys({
  budgets: Joi.array().items(Joi.object()).optional(),
  config: Joi.object(),
  url: Joi.string().required(),
});
