const lighthouse = require('lighthouse');
const { URL } = require('url');
const { canLog } = require('./build/utils');

const DEFAULT_AUDIT_CONFIG = {
  extends: 'lighthouse:default'
}

module.exports = async ({ browser, context }) => {
  const { 
    url,
    config = DEFAULT_AUDIT_CONFIG,
    budgets 
  } = context;

  const options = {
    port: (new URL(browser.wsEndpoint())).port,
    output: 'json',
    logLevel: canLog ? 'info' : 'silent',
  };

  if (budgets) {
    options.budgets = budgets;
  }

  const { lhr } = await lighthouse(url, options, config);

  return {
    data: lhr,
    type: 'json',
  };
}
