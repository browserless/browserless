export const liveQueryParams = [
  {
    in: 'query',
    name: 'blockAds',
    required: false,
    description:
      'Whether or not the browser should block advertisement network traffic.',
    schema: {
      type: 'boolean',
    },
  },
  {
    in: 'query',
    name: 'headless',
    required: false,
    description:
      'Whether or not the browser should run in headless mode or not.',
    schema: {
      type: 'boolean | "new"',
    },
  },
  {
    in: 'query',
    name: 'ignoreHTTPSErrors',
    required: false,
    description:
      'Whether or not the browser should ignore HTTPS errors in pages and network calls.',
    schema: {
      type: 'boolean',
    },
  },
  {
    in: 'query',
    name: 'slowMo',
    required: false,
    description:
      'The number, in milliseconds, by which puppeteer will slow-down calls (IE: clicks and typing). Helpful when debugging or mimicking user-like actions.',
    schema: {
      type: 'number',
    },
  },
  {
    in: 'query',
    name: 'stealth',
    required: false,
    description:
      'Whether or not to run in stealth mode. Helpful in avoiding bot detection.',
    schema: {
      type: 'boolean',
    },
  },
  {
    in: 'query',
    name: 'userDataDir',
    required: false,
    description:
      'A path to get/set a previous sessions cookies, local-storage and more. Use with caution.',
    schema: {
      type: 'string',
    },
  },
  {
    in: 'query',
    name: 'pause',
    required: false,
    description:
      "Flag to pause chrome's runtime execution of the page. Useful for watching requests and loading devtools to find issues.",
    schema: {
      type: 'boolean',
    },
  },
  {
    in: 'query',
    name: 'trackingId',
    required: false,
    description:
      'An arbitrary tracking-ID to use for other APIs like /session and more.',
    schema: {
      type: 'string',
    },
  },
  {
    in: 'query',
    name: 'keepalive',
    required: false,
    description:
      'A value, in milliseconds, in which to keep the browser running after the session. Useful for re-connecting later or allowing the browser to run without keeping an open connection.',
    schema: {
      type: 'number',
    },
  },
  {
    in: 'query',
    name: 'token',
    required: false,
    description:
      'A string-based token that authorizes the session for the hosted service, as well as self-managed instances that have been started with a TOKEN parameter.',
    schema: {
      type: 'string',
    },
  },
  {
    in: 'query',
    name: 'flag(s)',
    style: 'form',
    explode: 'true',
    required: false,
    description:
      'Any parameter that starts with "--" is treated as a command-line flag and is passed directly to chrome when it starts. See https://peter.sh/experiments/chromium-command-line-switches/ for a list of possible parameters.',
  },
];
