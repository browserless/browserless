const j2s = require('joi-to-swagger');
const { version } = require('../package.json');

import {
  pdf,
  content,
  scrape,
  screenshot,
  fn,
  stats,
} from './schemas';

const liveQueryParams = [{
  in: 'query',
  name: 'blockAds',
  required: false,
  description: 'Whether or not the browser should block advertisement network traffic.',
  schema: {
    type: 'boolean',
  },
}, {
  in: 'query',
  name: 'headless',
  required: false,
  description: 'Whether or not the browser should run in headless mode or not.',
  schema: {
    type: 'boolean',
  },
}, {
  in: 'query',
  name: 'ignoreHTTPSErrors',
  required: false,
  description: 'Whether or not the browser should ignore HTTPS errors in pages and network calls.',
  schema: {
    type: 'boolean',
  },
}, {
  in: 'query',
  name: 'slowMo',
  required: false,
  description: 'The number, in milliseconds, by which puppeteer will slow-down calls (IE: clicks and typing). Helpful when debugging or mimicking user-like actions.',
  schema: {
    type: 'number',
  },
}, {
  in: 'query',
  name: 'stealth',
  required: false,
  description: 'Whether or not to run in stealth mode. Helpful in avoiding bot detection.',
  schema: {
    type: 'boolean',
  },
}, {
  in: 'query',
  name: 'userDataDir',
  required: false,
  description: 'A path to get/set a previous sessions cookies, local-storage and more. Use with caution.',
  schema: {
    type: 'string',
  },
}, {
  in: 'query',
  name: 'pause',
  required: false,
  description: 'Flag to pause chrome\'s runtime execution of the page. Useful for watching requests and loading devtools to find issues.',
  schema: {
    type: 'boolean',
  },
}, {
  in: 'query',
  name: 'trackingId',
  required: false,
  description: 'An arbitrary tracking-ID to use for other APIs like /session and more.',
  schema: {
    type: 'string',
  },
}, {
  in: 'query',
  name: 'keepalive',
  required: false,
  description: 'A value, in milliseconds, in which to keep the browser running after the session. Useful for re-connecting later or allowing the browser to run without keeping an open connection.',
  schema: {
    type: 'number',
  },
}, {
  in: 'query',
  name: 'token',
  required: false,
  description: 'A string-based token that authorizes the session for the hosted service, as well as self-managed instances that have been started with a TOKEN parameter.',
  schema: {
    type: 'string',
  },
}, {
  in: 'query',
  name: 'flag(s)',
  style: 'form',
  explode: 'true',
  required: false,
  description: 'Any parameter that starts with "--" is treated as a command-line flag and is passed directly to chrome when it starts. See https://peter.sh/experiments/chromium-command-line-switches/ for a list of possible parameters.',
}];

const liveHeaders = {
  'x-response-code': {
    schema: {
      type: 'number',
    },
    description: 'The underlying page\'s response code.',
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
    description: 'The underlying page\'s response URL. Might be different if the page was redirected.',
  },
  'x-response-ip': {
    schema: {
      type: 'string',
    },
    description: 'The IP Address of the server that served the underlying page.',
  },
  'x-response-port': {
    schema: {
      type: 'number',
    },
    description: 'The port of the server that served the underlying page.',
  },
};

const standardResponses = {
  400: {
    description: 'A bad request. See the response for details on addressing the issue.',
  },
  403: {
    description: 'Forbidden: the authorization token is missing or invalid.',
  },
  404: {
    description: 'The resource you are trying to access was not found.',
  },
  429: {
    description: 'Too many concurrent requests are happening, and your session was terminated.',
  },
  503: {
    description: 'The worker or machine is under heavy load and cannot handle your request. Try again later.',
  },
  500: {
    description: 'Unexpected error, either in when starting chrome or internally.',
  },
};

export default {
  openapi: '3.0.0',
  info: {
    title: 'browserless/chrome API',
    version,
    description: 'The REST API for browserless',
  },
  servers: [{
    url: `https://chrome.browserless.io`,
    description: 'Demo server',
  }],
  paths: {
    '/pdf': {
      post: {
        tags: ['Browser API'],
        parameters: liveQueryParams,
        summary: 'Creates a new PDF document using the supplied JSON body for parameters, and returns the PDF document.',
        requestBody: {
          content: {
            'application/json': {
              schema: j2s(pdf).swagger,
            },
          },
        },
        responses: {
          ...standardResponses,
          200: {
            description: 'A PDF success response with the attached PDF file.',
            headers: liveHeaders,
            content: {
              'application/pdf': {
                schema: {
                  type: 'string',
                  format: 'binary',
                },
              },
            },
          },
        },
      },
    },
    '/screenshot': {
      post: {
        tags: ['Browser API'],
        parameters: liveQueryParams,
        summary: 'Creates a new PNG or JPEG image using the supplied JSON body for parameters, and returns the screenshot.',
        requestBody: {
          content: {
            'application/json': {
              schema: j2s(screenshot).swagger,
            },
          },
        },
        responses: {
          ...standardResponses,
          200: {
            description: 'A screenshot success response with the attached screenshot file. Depending on the "options.type" payload, this will respond with either a image/png or image/jpeg content type. Defaults to image/png.',
            headers: liveHeaders,
            content: {
              'image/png': {
                schema: {
                  type: 'string',
                  format: 'binary',
                },
              },
              'image/jpeg': {
                schema: {
                  type: 'string',
                  format: 'binary',
                },
              },
            },
          },
        },
      },
    },
    '/content': {
      post: {
        tags: ['Browser API'],
        parameters: liveQueryParams,
        summary: 'Returns the raw HTML of the requested page after processing and executing the browser JavaScript.',
        requestBody: {
          content: {
            'application/json': {
              schema: j2s(content).swagger,
            },
          },
        },
        responses: {
          ...standardResponses,
          200: {
            description: 'A successful response will return the plain HTML of the page after JavaScript parsing and execution.',
            headers: liveHeaders,
            content: {
              'text/html': {
                schema: {
                  type: 'string',
                },
              },
            },
          },
        },
      },
    },
    '/scrape': {
      post: {
        tags: ['Browser API'],
        parameters: liveQueryParams,
        summary: 'A JSON-based API to get text, attributes, and more from a page.',
        requestBody: {
          content: {
            'application/json': {
              schema: j2s(scrape).swagger,
            },
          },
        },
        responses: {
          ...standardResponses,
          200: {
            description: 'A successful response will return a JSON payload.',
            headers: liveHeaders,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    debug: {
                      description: `Meta-data about parts of the page, must specify which fields you want to see by add a "debug" object to your payload, who's values are the keys you wish to receive with a "true" value.`,
                      type: 'object',
                      properties: {
                        html: {
                          type: 'string',
                        },
                        screenshot: {
                          type: 'string',
                        },
                        console: {
                          type: 'array',
                          items: {
                            type: 'string',
                          },
                        },
                        network: {
                          type: 'object',
                          properties: {
                            outbound: {
                              type: 'array',
                              items: {
                                type: 'object',
                                properties: {
                                  url: {
                                    type: 'string',
                                  },
                                  method: {
                                    type: 'string',
                                  },
                                  headers: {
                                    type: 'object',
                                  },
                                },
                              },
                            },
                            inbound: {
                              type: 'array',
                              items: {
                                type: 'object',
                                properties: {
                                  url: {
                                    type: 'string',
                                  },
                                  method: {
                                    type: 'string',
                                  },
                                  headers: {
                                    type: 'object',
                                  },
                                },
                              },
                            },
                          },
                        },
                        cookies: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              name: {
                                type: 'string',
                              },
                              value: {
                                type: 'string',
                              },
                              domain: {
                                type: 'string',
                              },
                              path: {
                                type: 'string',
                              },
                              expires: {
                                type: 'number',
                              },
                              size: {
                                type: 'number',
                              },
                              httpOnly: {
                                type: 'boolean',
                              },
                              secure: {
                                type: 'boolean',
                              },
                              session: {
                                type: 'boolean',
                              },
                              sameParty: {
                                type: 'boolean',
                              },
                            },
                          },
                        },
                      },
                    },
                    data: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          selector: {
                            type: 'string'
                          },
                          results: {
                            type: 'array',
                            items: {
                              type: 'object',
                              properties: {
                                html: {
                                  type: 'string',
                                },
                                text: {
                                  type: 'string',
                                },
                                width: {
                                  type: 'number',
                                },
                                height: {
                                  type: 'number',
                                },
                                top: {
                                  type: 'number',
                                },
                                left: {
                                  type: 'number',
                                },
                                attributes: {
                                  type: 'array',
                                  items: {
                                    type: 'object',
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/stats': {
      post: {
        tags: ['Browser API'],
        parameters: liveQueryParams,
        summary: 'Get useful performance stats and other benchmarks a site or page.',
        requestBody: {
          content: {
            'application/json': {
              schema: j2s(stats).swagger,
            },
          },
        },
      },
    },
    '/function': {
      post: {
        tags: ['Browser API'],
        parameters: liveQueryParams,
        summary: 'Run arbitrary NodeJS code with access to a browser page, returning the result.',
        requestBody: {
          content: {
            'application/json': {
              schema: j2s(fn).swagger,
            },
          },
        },
      },
    },
  },
};
