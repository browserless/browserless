import { expect } from 'chai';

import { Metrics } from './metrics.js';

describe('Metrics', () => {
  it('records successful sessions', () => {
    const m = new Metrics();
    m.addSuccessful(1000);

    expect(m.get()).have.property('successful', 1);
  });

  it('records timed-out sessions', () => {
    const m = new Metrics();
    m.addTimedout(1000);

    expect(m.get()).have.property('timedout', 1);
  });

  it('records queued sessions', () => {
    const m = new Metrics();
    m.addQueued();

    expect(m.get()).have.property('queued', 1);
  });

  it('records unauthorized sessions', () => {
    const m = new Metrics();
    m.addUnauthorized();

    expect(m.get()).have.property('unauthorized', 1);
  });

  it('captures max concurrently running sessions', () => {
    const m = new Metrics();

    m.addRunning();

    m.addSuccessful(10);

    m.addRunning();
    m.addRunning();

    m.addError(10);
    m.addTimedout(10);

    expect(m.get()).have.property('running', 0);
    expect(m.get()).have.property('maxConcurrent', 2);
  });
});
