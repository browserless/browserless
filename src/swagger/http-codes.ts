export const httpCodes = {
  400: {
    description:
      'A bad request. See the response for details on addressing the issue.',
  },
  403: {
    description: 'Forbidden: the authorization token is missing or invalid.',
  },
  404: {
    description: 'The resource you are trying to access was not found.',
  },
  500: {
    description:
      'Unexpected error, either in when starting chrome or internally.',
  },
};

export const liveAPICodes = {
  ...httpCodes,
  429: {
    description:
      'Too many concurrent requests are happening, and your session was terminated.',
  },
  503: {
    description:
      'The worker or machine is under heavy load and cannot handle your request. Try again later.',
  },
};
