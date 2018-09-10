const lighthouse = require('lighthouse');
const { URL } = require('url');
const { canLog } = require('./build/utils');

module.exports = async ({ browser, context }) => {
  const { url } = context;

  const { lhr } = await lighthouse(url, {
    port: (new URL(browser.wsEndpoint())).port,
    output: 'json',
    logLevel: canLog ? 'info' : 'silent',
  });

  return {
    data: lhr,
    type: 'json',
  };
}
