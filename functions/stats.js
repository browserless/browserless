const lighthouse = require('lighthouse');
const { URL } = require('url');
const { canLog } = require('./build/utils');

const DEFAULT_AUDIT_CONFIG = {
  extends: 'lighthouse:default'
}

module.exports = async ({ browser, context }) => {
  const { url, config = DEFAULT_AUDIT_CONFIG } = context;

  const { lhr } = await lighthouse(url, {
    port: (new URL(browser.wsEndpoint())).port,
    output: 'json',
    logLevel: canLog ? 'info' : 'silent',
  }, config);

  return {
    data: lhr,
    type: 'json',
  };
}
