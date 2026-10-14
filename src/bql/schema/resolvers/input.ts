import type { Resolver } from '../../module.js';

export const input: Record<string, Resolver> = {
  click: async (_source, args, context) =>
    (await context.getBrowser()).click(args),
  checkbox: async (_source, args, context) =>
    (await context.getBrowser()).checkbox({
      ...args,
      selector: args.selector,
      checked: args.checked,
    }),
  hover: async (_source, args, context) =>
    (await context.getBrowser()).hover(args),
  type: async (_source, args, context) =>
    (await context.getBrowser()).type({
      ...args,
      selector: args.selector,
      text: args.text,
    }),
  select: async (_source, args, context) =>
    (await context.getBrowser()).select({
      ...args,
      selector: args.selector,
      value: args.value,
    }),
  scroll: async (_source, args, context) =>
    (await context.getBrowser()).scroll(args),
};
