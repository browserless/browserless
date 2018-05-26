import * as Joi from 'joi';

export const screenshot = Joi.object().keys({
  options: Joi.object().keys({
    type: Joi.string().valid('jpeg', 'png'),
    quality: Joi.number().min(0).max(100),
    fullPage: Joi.boolean(),
    omitBackground: Joi.boolean(),
    clip: Joi.object().keys({
      x: Joi.number().min(0),
      y: Joi.number().min(0),
      width: Joi.number().min(0),
      height: Joi.number().min(0),
    }),
  }),
  url: Joi.string().required(),
});

export const content = Joi.object().keys({
  url: Joi.string().required(),
});

export const pdf = Joi.object().keys({
  url: Joi.string(),
  html: Joi.string(),
  options: Joi.object().keys({
    scale: Joi.number().min(0),
    displayHeaderFooter: Joi.boolean(),
    headerTemplate: Joi.string(),
    footerTemplate: Joi.string(),
    printBackground: Joi.boolean(),
    landscape: Joi.boolean(),
    pageRanges: Joi.string()
      .valid('Letter', 'Legal', 'Tabloid', 'Ledger', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6'),
    width: Joi.any().optional(),
    height: Joi.any().optional(),
    margin: Joi.object().keys({
      top: Joi.string(),
      right: Joi.string(),
      bottom: Joi.string(),
      left: Joi.string(),
    })
  })
}).xor('url', 'html');

export const fn = Joi.object().keys({
  code: Joi.string().required(),
  context: Joi.object(),
});
