import * as Joi from 'joi';

export const screenshot = Joi.object().keys({
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
  url: Joi.string().required(),
});

export const content = Joi.object().keys({
  url: Joi.string().required(),
});

export const pdf = Joi.object().keys({
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
  url: Joi.string(),
}).xor('url', 'html');

export const fn = Joi.object().keys({
  code: Joi.string().required(),
  context: Joi.object(),
  detached: Joi.boolean(),
});
