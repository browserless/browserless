const j2s = require('joi-to-swagger');

import { dedent } from '../utils';
import { liveQueryParams } from './query-params';
import { liveHeaders } from './headers';
import { httpCodes, liveAPICodes } from './http-codes';

const { version } = require('../../package.json');

import {
  pdf,
  content,
  scrape,
  screenshot,
  fn,
  stats,
} from '../schemas';

const liveTags = ['Browser API'];
const managementTags = ['Management API'];

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
    '/metrics': {
      get: {
        tags: managementTags,
        summary: `Returns metrics about worker in 5-minute increments.`,
        responses: {
          ...httpCodes,
          200: {
            description: 'A JSON payload with an array of stats.',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      date: {
                        type: 'integer',
                      },
                      successful: {
                        type: 'integer',
                      },
                      queued: {
                        type: 'integer',
                      },
                      rejected: {
                        type: 'integer',
                      },
                      unhealthy: {
                        type: 'integer',
                      },
                      memory: {
                        type: 'number',
                      },
                      cpu: {
                        type: 'number',
                      },
                      timedout: {
                        type: 'integer',
                      },
                      totalTime: {
                        type: 'integer',
                      },
                      meanTime: {
                        type: 'number',
                      },
                      maxTime: {
                        type: 'number',
                      },
                      minTime: {
                        type: 'number',
                      },
                      sessionTimes: {
                        type: 'array',
                        items: {
                          type: 'integer',
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/pdf': {
      post: {
        tags: liveTags,
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
          ...liveAPICodes,
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
        tags: liveTags,
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
          ...liveAPICodes,
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
        tags: liveTags,
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
          ...liveAPICodes,
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
        tags: liveTags,
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
          ...liveAPICodes,
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
                                  },
                                },
                              },
                            },
                          },
                        },
                      },
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
        tags: liveTags,
        parameters: liveQueryParams,
        summary: 'Get useful performance stats and other benchmarks a site or page.',
        requestBody: {
          content: {
            'application/json': {
              schema: j2s(stats).swagger,
            },
          },
        },
        responses: {
          ...liveAPICodes,
          200: {
            description: 'A successful response will return a JSON payload.',
            headers: liveHeaders,
            content: {
              'application/json': {
                schema: {
                  description: 'The stats response returns a JSON-based payload, with many details about the performance of the site',
                  type: 'object',
                },
              },
            },
          },
        },
      },
    },
    '/function': {
      post: {
        tags: liveTags,
        parameters: liveQueryParams,
        summary: 'Run arbitrary NodeJS code with access to a browser page, returning the result.',
        requestBody: {
          content: {
            'application/json': {
              schema: j2s(fn).swagger,
            },
            'application/javascript': {
              schema: {
                type: 'string',
                example: dedent(`module.exports = async ({ page }) => {
                  await page.goto("https://example.com");
                  return {
                    type: "json",
                    data: await page.title()
                  };
                };`),
              },
            },
          },
        },
        responses: {
          ...liveAPICodes,
          200: {
            description: 'A successful response will return a type based upon the supplied functions return. This is determined by the "type" parameter when your code returns.',
            headers: liveHeaders,
            content: {
              'application/json': {
                schema: {
                  description: 'Returning with a type: "json" will trigger a JSON response with the "data" parameter passing through the functions return.',
                  type: 'object',
                },
              },
              'application/pdf': {
                schema: {
                  description: 'Returning with a type: "pdf" will trigger a PDF content response.',
                  type: 'string',
                  format: 'binary',
                },
              },
              'image/png': {
                schema: {
                  description: 'Returning with a type: "png" will trigger a PNG content response.',
                  type: 'string',
                  format: 'binary',
                },
              },
              'image/jpeg': {
                schema: {
                  description: 'Returning with a type: "jpeg" will trigger a JPEG content response.',
                  type: 'string',
                  format: 'binary',
                },
              },
            },
          },
        },
      },
    },
  },
};
