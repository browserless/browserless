const lighthouse = require('lighthouse');
const { URL } = require('url');

module.exports = async ({ browser, context }) => {
  const { url } = context;

  const { lhr } = await lighthouse(url, {
    port: (new URL(browser.wsEndpoint())).port,
    output: 'json',
    logLevel: 'info',
  });

  return {
    data: lhr,
    type: 'json',
  };
}
