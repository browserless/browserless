/* eslint-disable no-unused-expressions */
import { HostSource, readWithTimeout } from '@browserless.io/browserless';
import { expect } from 'chai';
import Sinon from 'sinon';
import si from 'systeminformation';

describe('HostSource', () => {
  afterEach(() => Sinon.restore());

  it('returns CPU and memory fractions from systeminformation', async () => {
    Sinon.stub(si, 'currentLoad').resolves({
      currentLoadUser: 42,
    } as unknown as si.Systeminformation.CurrentLoadData);
    Sinon.stub(si, 'mem').resolves({
      active: 256,
      total: 1024,
    } as unknown as si.Systeminformation.MemData);

    const source = new HostSource();
    const result = await source.read();

    expect(result.cpu).to.equal(0.42);
    expect(result.memory).to.equal(0.25);
  });

  it('returns nulls when systeminformation throws', async () => {
    Sinon.stub(si, 'currentLoad').rejects(new Error('boom'));
    Sinon.stub(si, 'mem').rejects(new Error('boom'));

    const source = new HostSource();
    const result = await source.read();

    expect(result.cpu).to.be.null;
    expect(result.memory).to.be.null;
  });
});

describe('readWithTimeout', () => {
  it('resolves to file contents when readFile resolves in time', async () => {
    const readFile: Parameters<typeof readWithTimeout>[1] = async () => 'hello';
    const result = await readWithTimeout('/fake', readFile, 100);
    expect(result).to.equal('hello');
  });

  it('rejects when the timeout fires before readFile resolves', async () => {
    const readFile: Parameters<typeof readWithTimeout>[1] = (_path, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason));
      });

    let err: Error | undefined;
    try {
      await readWithTimeout('/fake', readFile, 20);
    } catch (e) {
      err = e as Error;
    }
    expect(err).to.exist;
    expect((err as Error & { name: string }).name).to.equal('TimeoutError');
  });
});
