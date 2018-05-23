import * as Joi from 'joi';

export const screenshot = Joi.object().keys({
  options: Joi.object().keys({
    type: Joi.string().valid('jpg', 'png'),
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

export const fn = Joi.object().keys({
  code: Joi.string().required(),
  context: Joi.object(),
});
