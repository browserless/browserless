export const liveHeaders = {
  'x-response-code': {
    schema: {
      type: 'number',
    },
    description: "The underlying page's response code.",
  },
  'x-response-status': {
    schema: {
      type: 'string',
    },
    description: 'The underlying page\'s response status "ok"',
  },
  'x-response-url': {
    schema: {
      type: 'string',
    },
    description:
      "The underlying page's response URL. Might be different if the page was redirected.",
  },
  'x-response-ip': {
    schema: {
      type: 'string',
    },
    description:
      'The IP Address of the server that served the underlying page.',
  },
  'x-response-port': {
    schema: {
      type: 'number',
    },
    description: 'The port of the server that served the underlying page.',
  },
};
