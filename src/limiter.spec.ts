/* eslint-disable no-unused-expressions */
import {
  Config,
  Hooks,
  Limiter,
  Metrics,
  Monitoring,
  WebHooks,
  sleep,
} from '@browserless.io/browserless';
import Sinon, { spy } from 'sinon';
import { expect } from 'chai';

const asyncNoop = () => Promise.resolve(undefined);
const noop = () => undefined;
const webHooks = Sinon.createStubInstance(WebHooks);
const hooks = Sinon.createStubInstance(Hooks);

describe(`Limiter`, () => {
  afterEach(() => {
    webHooks.callFailedHealthURL.resetHistory();
    webHooks.callQueueAlertURL.resetHistory();
    webHooks.callRejectAlertURL.resetHistory();
    webHooks.callTimeoutAlertURL.resetHistory();
    webHooks.callErrorAlertURL.resetHistory();

    hooks.before.resetHistory();
    hooks.after.resetHistory();
    hooks.browser.resetHistory();
    hooks.page.resetHistory();
  });

  it('limits and queues function calls, calls hooks, and calls queue alert urls', async () => {
    return new Promise((resolve, reject) => {
      const config = new Config();
      config.setQueueAlertURL('https://one.one.one.one');

      const monitoring = new Monitoring(config);
      const metrics = new Metrics();

      config.setConcurrent(1);
      config.setQueued(1);
      config.setTimeout(-1);

      const limiter = new Limiter(config, metrics, monitoring, webHooks, hooks);
      const handler = spy();
      const job = limiter.limit(handler, asyncNoop, asyncNoop, noop);

      job();
      job();

      expect(handler.calledOnce).to.be.true;

      limiter.addEventListener('end', () => {
        try {
          expect(hooks.after.called).to.be.true;
          expect(handler.calledTwice).to.be.true;
          expect(webHooks.callQueueAlertURL.calledOnce).to.be.true;
          expect(metrics.get().queued).to.equal(1);
          expect(metrics.get().maxConcurrent).to.equal(1);
          expect(metrics.get().successful).to.equal(2);
        } catch (e) {
          return reject(e);
        }
        resolve(undefined);
      });
    });
  });

  it('passes through arguments', () =>
    new Promise((resolve, reject) => {
      const args = ['one', 'two', 'three'];
      const config = new Config();
      const metrics = new Metrics();
      const monitoring = new Monitoring(config);
      config.setConcurrent(1);
      config.setQueued(0);
      config.setTimeout(-1);

      const limiter = new Limiter(config, metrics, monitoring, webHooks, hooks);
      const handler = spy();
      const job = limiter.limit(handler, asyncNoop, asyncNoop, noop);
      // @ts-ignore will fix later
      job(...args);
      expect(handler.args[0]).to.eql(args);

      limiter.addEventListener('end', () => {
        try {
          expect(hooks.after.args[0][0]).to.have.property('start');
          expect(hooks.after.args[0][0]).to.have.property(
            'status',
            'successful',
          );
        } catch (e) {
          return reject(e);
        }
        resolve(undefined);
      });
    }));

  it('waits to run jobs until the first are done', async () => {
    const config = new Config();
    const monitoring = new Monitoring(config);
    const metrics = new Metrics();
    config.setConcurrent(1);
    config.setQueued(1);
    config.setTimeout(-1);

    const limiter = new Limiter(config, metrics, monitoring, webHooks, hooks);
    const handlerOne = () => new Promise((r) => setTimeout(r, 50));
    const handlerTwo = spy();

    const jobOne = limiter.limit(handlerOne, asyncNoop, asyncNoop, noop);
    const jobTwo = limiter.limit(handlerTwo, asyncNoop, asyncNoop, noop);

    const wait = jobOne();
    jobTwo();

    expect(handlerTwo.calledOnce).to.be.false;
    await wait;
    expect(handlerTwo.calledOnce).to.be.true;
  });

  it('continues to process jobs even if an earlier job errors', (d) => {
    const config = new Config();
    const monitoring = new Monitoring(config);
    const metrics = new Metrics();

    config.setConcurrent(1);
    config.setQueued(1);
    config.setTimeout(-1);

    const limiter = new Limiter(config, metrics, monitoring, webHooks, hooks);
    const errorJob = () =>
      Promise.reject(new Error('Danger, danger. High voltage!'));
    const okJob = spy();

    const jobOne = limiter.limit(errorJob, asyncNoop, asyncNoop, noop);
    const jobTwo = limiter.limit(okJob, asyncNoop, asyncNoop, noop);

    jobOne();
    jobTwo();

    limiter.addEventListener('end', () => {
      expect(okJob.calledOnce).to.be.true;
      d(undefined);
    });
  });

  it('bubbles up errors', async () => {
    const config = new Config();
    const monitoring = new Monitoring(config);
    const metrics = new Metrics();
    const error = new Error('WOW');

    config.setConcurrent(1);
    config.setQueued(1);
    config.setTimeout(-1);

    const limiter = new Limiter(config, metrics, monitoring, webHooks, hooks);
    const spy = () => new Promise((_r, rej) => rej(error));

    const job = limiter.limit(spy, asyncNoop, asyncNoop, noop);
    await job().catch(noop);

    limiter.addEventListener('error', (res) => {
      // 'end' callback fires before the failed callback hooks do, so nextTick to wait
      process.nextTick(() => {
        expect(res.detail.error).to.eql(error);
        expect(metrics.get().successful).to.eql(0);
        expect(metrics.get().error).to.eql(1);
        expect(webHooks.callErrorAlertURL.getCalls()[0].firstArg).to.include(
          error,
        );
        expect(webHooks.callErrorAlertURL.calledOnce).to.be.true;
        expect(hooks.after.args[0][0]).to.have.property('status', 'error');
      });
    });
  });

  it('calls an error handler with arguments if there are too many function calls', () => {
    const args = ['one', 'two', 'three'];
    const config = new Config();
    const monitoring = new Monitoring(config);
    const metrics = new Metrics();
    config.setConcurrent(1);
    config.setQueued(0);
    config.setTimeout(-1);

    const limiter = new Limiter(config, metrics, monitoring, webHooks, hooks);

    const handler = spy();
    const onError = spy();
    const job = limiter.limit(handler, onError, noop, noop);

    job();
    // @ts-ignore
    job(...args);

    expect(webHooks.callRejectAlertURL.calledOnce).to.be.true;
    expect(handler.calledOnce).to.be.true;
    expect(onError.calledOnce).to.be.true;
    expect(onError.args[0]).to.eql(args);
  });

  it('calls a timeout handler with arguments if a job takes too long', () =>
    new Promise((resolve, reject) => {
      const args = ['one', 'two', 'three'];
      const config = new Config();
      const metrics = new Metrics();
      const monitoring = new Monitoring(config);
      config.setConcurrent(1);
      config.setQueued(0);
      config.setTimeout(10);

      let timer: NodeJS.Timer;
      const limiter = new Limiter(config, metrics, monitoring, webHooks, hooks);
      const handler = () =>
        new Promise((d) => (timer = global.setTimeout(d, 1000)));

      const onTimeout = (...calledArgs: unknown[]) => {
        clearTimeout(timer as unknown as number);
        expect(calledArgs).to.eql(args);
        expect(webHooks.callTimeoutAlertURL.calledOnce).to.be.true;
      };

      const job = limiter.limit(handler, noop, onTimeout, noop);

      // @ts-ignore
      job(...args);

      limiter.addEventListener('end', () => {
        try {
          expect(hooks.after.args[0][0]).to.have.property('status', 'timedout');
        } catch (e) {
          return reject(e);
        }
        resolve(undefined);
      });
    }));

  it('allows overriding the timeouts', async () => {
    const config = new Config();
    const metrics = new Metrics();
    const monitoring = new Monitoring(config);
    config.setConcurrent(2);
    config.setQueued(0);
    config.setTimeout(1);

    const limiter = new Limiter(config, metrics, monitoring, webHooks, hooks);
    const onTimeout = spy();
    const handler = async () => new Promise((r) => setTimeout(r, 10));

    const job = limiter.limit(handler, noop, onTimeout, noop);
    const jobTwo = limiter.limit(handler, noop, onTimeout, () => 20);

    job();
    jobTwo();

    await sleep(25);

    expect(onTimeout.calledOnce).to.be.true;
  });

  it(`doesn't call a timeout handler if the job finishes in time`, async () => {
    const config = new Config();
    const metrics = new Metrics();
    const monitoring = new Monitoring(config);
    config.setConcurrent(1);
    config.setQueued(0);
    config.setTimeout(20);

    const limiter = new Limiter(config, metrics, monitoring, webHooks, hooks);
    const handler = () => new Promise((r) => setTimeout(r, 1));
    const timeout = spy();
    const job = limiter.limit(handler, noop, timeout, noop);
    await job();

    expect(timeout.called).not.to.be.true;
    expect(webHooks.callTimeoutAlertURL.calledOnce).not.to.be.true;
  });

  it(`won't add items to the queue when reached`, () =>
    new Promise((r) => {
      const config = new Config();
      const monitoring = new Monitoring(config);
      const metrics = new Metrics();
      config.setConcurrent(1);
      config.setQueued(0);
      config.setTimeout(-1);

      const limiter = new Limiter(config, metrics, monitoring, webHooks, hooks);

      const handler = spy();
      const job = limiter.limit(handler, noop, noop, noop);

      job();
      job();

      expect(limiter.length).to.equal(1);

      limiter.addEventListener('end', () => {
        expect(limiter.length).to.equal(0);
        expect(handler.calledOnce).to.be.true;
        expect(webHooks.callRejectAlertURL.calledOnce).to.be.true;
        r(undefined);
      });
    }));

  it(`won't add items when health is bad`, () =>
    new Promise((r) => {
      const config = new Config();
      config.enableHealthChecks(true);
      config.setCPULimit(1);
      config.setMemoryLimit(1);

      const monitoring = new Monitoring(config);
      const metrics = new Metrics();
      config.setConcurrent(10);
      config.setQueued(10);
      config.setTimeout(-1);

      const limiter = new Limiter(config, metrics, monitoring, webHooks, hooks);

      const handler = spy();
      const job = limiter.limit(handler, noop, noop, noop);

      job().catch(() => {
        expect(limiter.length).to.equal(0);
        expect(handler.calledOnce).to.be.false;
        expect(webHooks.callFailedHealthURL.calledOnce).to.be.true;
        r(undefined);
      });
    }));

  it(`will add items when health is good`, () =>
    new Promise((r) => {
      const config = new Config();
      config.enableHealthChecks(true);
      config.setCPULimit(100);
      config.setMemoryLimit(100);

      const metrics = new Metrics();
      const monitoring = new Monitoring(config);
      config.setConcurrent(10);
      config.setQueued(10);
      config.setTimeout(-1);

      const limiter = new Limiter(config, metrics, monitoring, webHooks, hooks);

      const handler = spy();
      const job = limiter.limit(handler, noop, noop, noop);

      job();

      limiter.addEventListener('end', () => {
        expect(limiter.length).to.equal(0);
        expect(handler.calledOnce).to.be.true;
        expect(webHooks.callFailedHealthURL.calledOnce).to.be.false;
        r(undefined);
      });
    }));
});
