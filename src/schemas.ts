import * as Joi from 'joi';

const gotoOptions = Joi.object().keys({
  timeout: Joi.number(),
  waitUntil: Joi.string()
    .valid('load', 'domcontentloaded', 'networkidle0', 'networkidle2'),
});

const rejectRequestPattern = Joi.array().items(Joi.string()).default([]);

export const screenshot = Joi.object().keys({
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
  url: Joi.string(),
}).xor('url', 'html');

export const content = Joi.object().keys({
  gotoOptions,
  rejectRequestPattern,
  url: Joi.string().required(),
});

export const pdf = Joi.object().keys({
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
