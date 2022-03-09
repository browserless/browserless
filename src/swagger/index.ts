import { pdf, content, scrape, screenshot, fn, stats } from '../schemas';
import { dedent } from '../utils';

import { liveHeaders } from './headers';
import { httpCodes, liveAPICodes } from './http-codes';
import { liveQueryParams } from './query-params';

const j2s = require('joi-to-swagger');

const { version } = require('../../package.json');

const liveTags = ['Browser API'];
const managementTags = ['Management API'];

export default {
  openapi: '3.0.0',
  customSiteTitle: 'browserless Swagger documentation',
  info: {
    title: 'browserless/chrome API',
    version,
    description:
      'The REST API for browserless. Primarily composed of a "browser" API, which allows for interacting with the browser(s) themselves, and management APIs which reveal meta-data about the container, running-sessions and more. Some of these APIs are available for usage-based, but not all.',
  },
  servers: [
    {
      url: `https://chrome.browserless.io`,
      description: 'Demo server',
    },
  ],
  paths: {
    // Management and system APIs
    '/sessions': {
      get: {
        tags: managementTags,
        summary: `Returns information about the currently running sessions.`,
        responses: {
          ...httpCodes,
          200: {
            description: 'A JSON payload with an array of sessions.',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      description: {
                        type: 'string',
                      },
                      devtoolsFrontendUrl: {
                        type: 'string',
                      },
                      id: {
                        type: 'string',
                      },
                      title: {
                        type: 'string',
                      },
                      type: {
                        type: 'string',
                      },
                      url: {
                        type: 'string',
                      },
                      webSocketDebuggerUrl: {
                        type: 'string',
                      },
                      port: {
                        type: 'string',
                      },
                      trackingId: {
                        type: 'string',
                        format: 'nullable',
                      },
                      browserWSEndpoint: {
                        type: 'string',
                      },
                      browserId: {
                        type: 'string',
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
    '/pressure': {
      get: {
        tags: managementTags,
        summary: `Returns details about the current containers workload.`,
        responses: {
          ...httpCodes,
          200: {
            description:
              'A JSON payload with meta-data about the workers status.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    date: {
                      type: 'integer',
                    },
                    reason: {
                      type: 'string',
                    },
                    message: {
                      type: 'string',
                    },
                    isAvailable: {
                      type: 'boolean',
                    },
                    queued: {
                      type: 'integer',
                    },
                    recentlyRejected: {
                      type: 'integer',
                    },
                    running: {
                      type: 'integer',
                    },
                    maxConcurrent: {
                      type: 'integer',
                    },
                    maxQueued: {
                      type: 'integer',
                    },
                    cpu: {
                      type: 'number',
                    },
                    memory: {
                      type: 'number',
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
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
                      maxConcurrent: {
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
    '/metrics/total': {
      get: {
        tags: managementTags,
        summary: `Returns metrics about worker in 5-minute increments.`,
        responses: {
          ...httpCodes,
          200: {
            description:
              'A JSON payload with totals (either summed or averaged, depending) of all session statistics.',
            content: {
              'application/json': {
                schema: {
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
                    maxConcurrent: {
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
    '/workspace': {
      get: {
        tags: managementTags,
        summary: `Returns a list of downloaded and user-uploaded files in the workspace directory.`,
        responses: {
          ...httpCodes,
          200: {
            description: 'A JSON payload with an array of files.',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      created: {
                        type: 'string',
                      },
                      isDirectory: {
                        type: 'boolean',
                      },
                      name: {
                        type: 'string',
                      },
                      path: {
                        type: 'string',
                      },
                      size: {
                        type: 'integer',
                        format: 'int32',
                      },
                      workspaceId: {
                        type: 'string',
                        format: 'nullable',
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        tags: managementTags,
        summary: `Allows uploading of files into the workspace directory.`,
        parameters: [
          {
            in: 'query',
            name: 'trackingId',
            required: false,
            description:
              'An arbitrary tracking-id. Uploaded files will be nested in folder with the name as the tracking-id. Useful for associating files with a particular session or for management.',
            schema: {
              type: 'string',
            },
          },
        ],
        requestBody: {
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  filename: {
                    type: 'array',
                    items: {
                      type: 'string',
                      format: 'binary',
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          ...httpCodes,
          200: {
            description: 'A JSON payload with the array of files uploaded.',
            content: {
              'application/json': {
                schema: {
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
    '/workspace/{fileId}': {
      get: {
        tags: managementTags,
        summary: `Returns the specified file by the file-ID parameter, or a list of files when file-ID is a folder.`,
        parameters: [
          {
            in: 'path',
            name: 'fileId',
            schema: {
              type: 'string',
            },
            required: true,
            description:
              'The name of the file or list of files in cases when there is a folder.',
          },
        ],
        responses: {
          ...httpCodes,
          200: {
            description:
              'The file or files (zip) when found. Content-type is variable here depending on the file being returned',
          },
        },
      },
      delete: {
        tags: managementTags,
        summary: `Deletes a specified file by the file-ID parameter, or a list of files when file-ID is a folder.`,
        parameters: [
          {
            in: 'path',
            name: 'fileId',
            schema: {
              type: 'string',
            },
            required: true,
            description:
              'The name of the file or list of files in cases when there is a folder.',
          },
        ],
        responses: {
          ...httpCodes,
          204: {
            description:
              'A successful response will return a 204 status code with no body.',
          },
        },
      },
    },
    '/kill/all': {
      get: {
        tags: managementTags,
        summary: `A brute-force kill that closes ALL browser sessions.`,
        responses: {
          ...httpCodes,
          204: {
            description:
              'The kill call was executed successfully and all sessions are now closed.',
          },
        },
      },
    },
    '/kill/{id}': {
      get: {
        tags: managementTags,
        summary: `Kills a specific browser-session by the browser's ID or a tracking-ID. Use the /session API for retrieving the sessions.`,
        parameters: [
          {
            in: 'path',
            name: 'id',
            schema: {
              type: 'string',
            },
            required: true,
            description:
              'The browser ID or tracking-ID of the session you wish to close.',
          },
        ],
        responses: {
          ...httpCodes,
          204: {
            description:
              'The session was successfully closed, and a 204 response indicates success.',
          },
        },
      },
    },
    '/config': {
      get: {
        tags: managementTags,
        summary: `Returns the current configuration of the container.`,
        responses: {
          ...httpCodes,
          200: {
            description: 'A JSON payload with an array of stats.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    allowFileProtocol: {
                      type: 'boolean',
                    },
                    chromeRefreshTime: {
                      type: 'integer',
                      format: 'int32',
                    },
                    connectionTimeout: {
                      type: 'integer',
                      format: 'int32',
                    },
                    disabledFeatures: {
                      type: 'array',
                      items: {
                        type: 'string',
                      },
                    },
                    enableAPIGet: {
                      type: 'boolean',
                    },
                    enableCors: {
                      type: 'boolean',
                    },
                    enableHeapdump: {
                      type: 'boolean',
                    },
                    errorAlertURL: {
                      type: 'string',
                    },
                    exitOnHealthFailure: {
                      type: 'boolean',
                    },
                    functionBuiltIns: {
                      type: 'array',
                      items: {
                        type: 'string',
                      },
                    },
                    functionEnableIncognitoMode: {
                      type: 'boolean',
                    },
                    functionExternals: {
                      type: 'array',
                      items: {
                        type: 'string',
                      },
                    },
                    healthFailureURL: {
                      type: 'string',
                    },
                    sessionCheckFailURL: {
                      type: 'string',
                    },
                    keepAlive: {
                      type: 'boolean',
                    },
                    maxCPU: {
                      type: 'integer',
                      format: 'int32',
                    },
                    maxConcurrentSessions: {
                      type: 'integer',
                      format: 'int32',
                    },
                    maxMemory: {
                      type: 'integer',
                      format: 'int32',
                    },
                    maxQueueLength: {
                      type: 'integer',
                      format: 'int32',
                    },
                    metricsJSONPath: {
                      type: 'string',
                    },
                    port: {
                      type: 'integer',
                      format: 'int32',
                    },
                    prebootChrome: {
                      type: 'boolean',
                    },
                    queuedAlertURL: {
                      type: 'string',
                    },
                    rejectAlertURL: {
                      type: 'string',
                    },
                    singleRun: {
                      type: 'boolean',
                    },
                    timeoutAlertURL: {
                      type: 'string',
                    },
                    token: {
                      type: 'string',
                    },
                    workspaceDir: {
                      type: 'string',
                    },
                    socketBehavior: {
                      type: 'string',
                    },
                  },
                },
              },
            },
          },
        },
      },
    },

    // Browser-based APIs
    '/pdf': {
      post: {
        tags: liveTags,
        parameters: liveQueryParams,
        summary:
          'Creates a new PDF document using the supplied JSON body for parameters, and returns the PDF document.',
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
        summary:
          'Creates a new PNG or JPEG image using the supplied JSON body for parameters, and returns the screenshot.',
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
            description:
              'A screenshot success response with the attached screenshot file. Depending on the "options.type" payload, this will respond with either a image/png or image/jpeg content type. Defaults to image/png.',
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
              'text/plain': {
                schema: {
                  type: 'string',
                  format: 'base64',
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
        summary:
          'Returns the raw HTML of the requested page after processing and executing the browser JavaScript.',
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
            description:
              'A successful response will return the plain HTML of the page after JavaScript parsing and execution.',
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
        summary:
          'A JSON-based API to get text, attributes, and more from a page.',
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
                            type: 'string',
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
        summary:
          'Get useful performance stats and other benchmarks a site or page.',
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
                  description:
                    'The stats response returns a JSON-based payload, with many details about the performance of the site',
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
        summary:
          'Run arbitrary NodeJS code with access to a browser page, returning the result.',
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
            description:
              'A successful response will return a type based upon the supplied functions return. This is determined by the "type" parameter when your code returns.',
            headers: liveHeaders,
            content: {
              'application/json': {
                schema: {
                  description:
                    'Returning with a type: "json" will trigger a JSON response with the "data" parameter passing through the functions return.',
                  type: 'object',
                },
              },
              'application/pdf': {
                schema: {
                  description:
                    'Returning with a type: "pdf" will trigger a PDF content response.',
                  type: 'string',
                  format: 'binary',
                },
              },
              'image/png': {
                schema: {
                  description:
                    'Returning with a type: "png" will trigger a PNG content response.',
                  type: 'string',
                  format: 'binary',
                },
              },
              'image/jpeg': {
                schema: {
                  description:
                    'Returning with a type: "jpeg" will trigger a JPEG content response.',
                  type: 'string',
                  format: 'binary',
                },
              },
            },
          },
        },
      },
    },
    '/download': {
      post: {
        tags: liveTags,
        parameters: liveQueryParams,
        summary:
          'Run arbitrary NodeJS code with access to a browser page, triggering a download, returning the file that the browser downloads.',
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
                  await page.click("button[class='download']");
                };`),
              },
            },
          },
        },
        responses: {
          ...liveAPICodes,
          200: {
            description:
              'A successful download will return a response with the appropriate content-type of the file downloaded.',
            headers: liveHeaders,
          },
        },
      },
    },
    '/screencast': {
      post: {
        tags: liveTags,
        parameters: liveQueryParams,
        summary:
          'Run arbitrary NodeJS code with access to a browser page, returning a webm video file.',
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
                  await page.waitForTimeout(1500);
                };`),
              },
            },
          },
        },
        responses: {
          ...liveAPICodes,
          200: {
            description: 'A successful session will return a webm video file',
            headers: liveHeaders,
            content: {
              'video/webm': {
                schema: {
                  description: 'A webm video file',
                  type: 'string',
                  format: 'binary',
                },
              },
            },
          },
        },
      },
    },
    '/json/protocol': {
      get: {
        tags: liveTags,
        summary:
          'Returns a JSON payload that is similar to the embedded DevTools json-wire protocol',
        responses: {
          ...liveAPICodes,
          200: {
            description: 'A successful session will return a webm video file',
            content: {
              'application/json': {
                schema: {
                  description:
                    'Returns meta-data about the available protocols and their details',
                  type: 'object',
                },
              },
            },
          },
        },
      },
    },
    '/json/new': {
      get: {
        tags: liveTags,
        summary:
          'Returns a JSON payload that acts as a pass-through to the DevTools /json/new protocol in Chrome.',
        responses: {
          ...liveAPICodes,
          200: {
            description: 'A /json/new protocol response from the browser.',
            content: {
              'application/json': {
                schema: {
                  description:
                    'Returns meta-data about the available protocols and their details',
                  type: 'object',
                  properties: {
                    description: {
                      type: 'string',
                    },
                    devtoolsFrontendUrl: {
                      type: 'string',
                    },
                    targetId: {
                      type: 'string',
                    },
                    title: {
                      type: 'string',
                    },
                    type: {
                      type: 'string',
                    },
                    url: {
                      type: 'string',
                    },
                    webSocketDebuggerUrl: {
                      type: 'string',
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/json/version': {
      get: {
        tags: liveTags,
        summary:
          'Returns a JSON payload that acts as a pass-through to the DevTools /json/version protocol in Chrome.',
        responses: {
          ...liveAPICodes,
          200: {
            description:
              'A /json/version protocol response from the browser plus a webSocketDebuggerUrl param.',
            content: {
              'application/json': {
                schema: {
                  description: 'Returns meta-data about the browser version',
                  type: 'object',
                  properties: {
                    Browser: {
                      type: 'string',
                    },
                    'Protocol-Version': {
                      type: 'string',
                    },
                    'User-Agent': {
                      type: 'string',
                    },
                    'V8-Version': {
                      type: 'string',
                    },
                    'WebKit-Version': {
                      type: 'string',
                    },
                    'Debugger-Version': {
                      type: 'string',
                    },
                    'Puppeteer-Version': {
                      type: 'string',
                    },
                    webSocketDebuggerUrl: {
                      type: 'string',
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
};
