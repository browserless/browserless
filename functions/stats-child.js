const lighthouse = require('lighthouse');

const send = (msg) => process.send && process.send(msg);

const start = async ({ url, config, options }) => {
  try {
    const { lhr } = await lighthouse(url, options, config);

    send({
      event: 'complete',
      data: lhr,
    });
  } catch (err) {
    send({
      event: 'error',
      error: err.message,
    });
  }
};

process.on('message', (payload) => {
  const { event } = payload;

  if (event === 'start') {
    return start(payload);
  }

  return;
});
