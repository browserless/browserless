import * as Joi from 'joi';

const gotoOptions = Joi.object().keys({
  timeout: Joi.number(),
  waitUntil: Joi.string()
    .valid('load', 'domcontentloaded', 'networkidle0', 'networkidle2'),
});

const rejectRequestPattern = Joi.array().items(Joi.string()).default([]);

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

export const viewport = Joi.object().keys({
  deviceScaleFactor: Joi.number().min(1).max(100),
  hasTouch: Joi.boolean(),
  height: Joi.number().min(0).required(),
  isLandscape: Joi.boolean(),
  isMobile: Joi.boolean(),
  width: Joi.number().min(0).required(),
});

export const screenshot = Joi.object().keys({
  cookies,
  gotoOptions,
  html: Joi.string(),
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
  url: Joi.string(),
  viewport,
}).xor('url', 'html');

export const content = Joi.object().keys({
  cookies,
  gotoOptions,
  rejectRequestPattern,
  url: Joi.string().required(),
});

export const pdf = Joi.object().keys({
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
    printBackground: Joi.boolean(),
    scale: Joi.number().min(0),
    width: Joi.any().optional(),
  }),
  rejectRequestPattern,
  safeMode: Joi.boolean().default(
    false,
    'Whether to safely generate the PDF (renders pages one-at-a-time and merges it in-memory). ' +
    'Can prevent page crashes but is slower, consumes more memory, and returns a larger PDF.',
  ),
  url: Joi.string(),
}).xor('url', 'html');

export const fn = Joi.object().keys({
  code: Joi.string().required(),
  context: Joi.object(),
  detached: Joi.boolean(),
});

export const stats = Joi.object().keys({
  url: Joi.string().required(),
});
