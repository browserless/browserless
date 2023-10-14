import { expect } from 'chai';

import { Browserless } from '../../../browserless.js';
import { Config } from '../../../config.js';
import { Metrics } from '../../../metrics.js';

describe('/screenshot API', function () {
  let browserless: Browserless;

  const start = ({
    config = new Config(),
    metrics = new Metrics(),
  }: { config?: Config; metrics?: Metrics } = {}) => {
    config.setToken('browserless');
    browserless = new Browserless({ config, metrics });
    return browserless.start();
  };

  afterEach(async () => {
    await browserless.stop();
  });

  it('allows requests', async () => {
    await start();
    const body = {
      url: 'https://example.com',
    };

    await fetch('http://localhost:3000/screenshot?token=browserless', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).then((res) => {
      expect(res.headers.get('content-type')).to.equal('image/png');
      expect(res.status).to.equal(200);
    });
  });

  it('404s GET requests', async () => {
    await start();

    await fetch('http://localhost:3000/screenshot?token=browserless').then(
      (res) => {
        expect(res.headers.get('content-type')).to.equal(
          'text/plain; charset=UTF-8',
        );
        expect(res.status).not.to.equal(200);
      },
    );
  });

  it('allows custom viewports', async () => {
    await start();
    const body = {
      url: 'https://example.com',
      viewport: {
        deviceScaleFactor: 3,
        height: 100,
        width: 100,
      },
    };

    await fetch('http://localhost:3000/screenshot?token=browserless', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).then((res) => {
      expect(res.headers.get('content-type')).to.equal('image/png');
      expect(res.status).to.equal(200);
    });
  });

  it('allows to specify selector', async () => {
    await start();
    const body = {
      selector: 'h1',
      url: 'https://example.com',
    };

    await fetch('http://localhost:3000/screenshot?token=browserless', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).then((res) => {
      expect(res.headers.get('content-type')).to.equal('image/png');
      expect(res.status).to.equal(200);
    });
  });

  it('allows setting HTML body', async () => {
    await start();
    const body = {
      html: '<h1>Hello!</h1>',
    };

    await fetch('http://localhost:3000/screenshot?token=browserless', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).then((res) => {
      expect(res.headers.get('content-type')).to.equal('image/png');
      expect(res.status).to.equal(200);
    });
  });

  it('allows for providing http response payloads', async () => {
    const config = new Config();
    const metrics = new Metrics();
    config.setConcurrent(10);
    config.setQueued(10);
    config.setTimeout(30000);

    await start({ config, metrics });
    const body = {
      requestInterceptors: [
        {
          pattern: '.*data.json',
          response: {
            body: '{"data": 123}',
            contentType: 'application/json',
            status: 200,
          },
        },
      ],
      url: 'https://example.com',
    };

    await fetch('http://localhost:3000/screenshot?token=browserless', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).then((res) => {
      expect(res.headers.get('content-type')).to.equal('image/png');
      expect(res.status).to.equal(200);
    });
  });

  it('handles `waitForFunction` properties', async () => {
    await start();
    const body = {
      url: 'https://example.com',
      waitForFunction: {
        fn: '() => 5 + 5',
      },
    };

    await fetch('http://localhost:3000/screenshot?token=browserless', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).then((res) => {
      expect(res.headers.get('content-type')).to.equal('image/png');
      expect(res.status).to.equal(200);
    });
  });

  it('handles async `waitForFunction` properties', async () => {
    await start();
    const body = {
      url: 'https://example.com',
      waitForFunction: {
        fn: 'async () => new Promise(resolve => resolve(5))',
      },
    };

    await fetch('http://localhost:3000/screenshot?token=browserless', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).then((res) => {
      expect(res.headers.get('content-type')).to.equal('image/png');
      expect(res.status).to.equal(200);
    });
  });

  it('handles `waitForSelector` properties', async () => {
    await start();
    const body = {
      url: 'https://example.com',
      waitForSelector: {
        selector: 'h1',
      },
    };

    await fetch('http://localhost:3000/screenshot?token=browserless', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).then((res) => {
      expect(res.headers.get('content-type')).to.equal('image/png');
      expect(res.status).to.equal(200);
    });
  });

  it('handles `waitForTimeout` properties', async () => {
    await start();
    const body = {
      url: 'https://example.com',
      waitForTimeout: 500,
    };

    await fetch('http://localhost:3000/screenshot?token=browserless', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).then((res) => {
      expect(res.headers.get('content-type')).to.equal('image/png');
      expect(res.status).to.equal(200);
    });
  });

  it('handles `waitForEvent` properties', async () => {
    await start();
    const body = {
      html: `<script type="text/javascript">
      const event = new Event("customEvent");
      setTimeout(() => document.dispatchEvent(event), 1500);
      </script>`,
      waitForEvent: {
        event: 'customEvent',
      },
    };

    await fetch('http://localhost:3000/screenshot?token=browserless', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).then((res) => {
      expect(res.headers.get('content-type')).to.equal('image/png');
      expect(res.status).to.equal(200);
    });
  });

  it('allows cookies', async () => {
    await start();
    const body = {
      cookies: [{ domain: 'example.com', name: 'foo', value: 'bar' }],
      url: 'https://example.com',
    };

    await fetch('http://localhost:3000/screenshot?token=browserless', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).then((res) => {
      expect(res.headers.get('content-type')).to.equal('image/png');
      expect(res.status).to.equal(200);
    });
  });

  it('times out requests', async () => {
    await start();
    const body = {
      url: 'https://example.com',
    };

    await fetch(
      'http://localhost:3000/screenshot?token=browserless&timeout=10',
      {
        body: JSON.stringify(body),
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      },
    ).then((res) => {
      expect(res.status).to.equal(408);
    });
  });

  it('rejects requests', async () => {
    const config = new Config();
    config.setConcurrent(0);
    config.setQueued(0);
    const metrics = new Metrics();
    await start({ config, metrics });

    const body = {
      url: 'https://example.com',
    };

    await fetch('http://localhost:3000/screenshot?token=browserless', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).then((res) => {
      expect(res.status).to.equal(429);
    });
  });

  it('allows goto options', async () => {
    await start();

    const body = {
      url: 'https://example.com',
    };

    await fetch('http://localhost:3000/screenshot?token=browserless', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
      },
      method: 'POST',
    }).then((res) => {
      expect(res.status).to.equal(200);
    });
  });
});
