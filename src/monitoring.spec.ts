/* eslint-disable no-unused-expressions */
import {
  HostSource,
  parseCpuMax,
  parseCpuStatUsageUsec,
  parseMemoryMax,
  readWithTimeout,
} from '@browserless.io/browserless';
import { expect } from 'chai';
import os from 'os';
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

describe('cgroup v2 parsers', () => {
  describe('parseCpuMax', () => {
    it('returns quota / period as cores when bounded', () => {
      expect(parseCpuMax('100000 100000')).to.equal(1);
      expect(parseCpuMax('50000 100000')).to.equal(0.5);
      expect(parseCpuMax('400000 100000')).to.equal(4);
    });

    it('returns the host CPU count when unbounded ("max")', () => {
      expect(parseCpuMax('max 100000')).to.equal(os.cpus().length);
    });

    it('returns null for malformed content', () => {
      expect(parseCpuMax('')).to.be.null;
      expect(parseCpuMax('garbage')).to.be.null;
      expect(parseCpuMax('100000')).to.be.null;
    });
  });

  describe('parseCpuStatUsageUsec', () => {
    it('extracts usage_usec', () => {
      const content =
        'usage_usec 12345\nuser_usec 6000\nsystem_usec 6345\n';
      expect(parseCpuStatUsageUsec(content)).to.equal(12345);
    });

    it('ignores unknown fields added by future kernels', () => {
      const content =
        'usage_usec 999\nfuture_field 42\nuser_usec 500\n';
      expect(parseCpuStatUsageUsec(content)).to.equal(999);
    });

    it('returns null when usage_usec is missing or non-numeric', () => {
      expect(parseCpuStatUsageUsec('user_usec 1\nsystem_usec 2\n')).to.be.null;
      expect(parseCpuStatUsageUsec('usage_usec abc\n')).to.be.null;
      expect(parseCpuStatUsageUsec('')).to.be.null;
    });
  });

  describe('parseMemoryMax', () => {
    it('returns the byte value when bounded', () => {
      expect(parseMemoryMax('536870912')).to.equal(536870912);
    });

    it('returns os.totalmem() when unbounded ("max")', () => {
      expect(parseMemoryMax('max')).to.equal(os.totalmem());
    });

    it('returns null for malformed content', () => {
      expect(parseMemoryMax('')).to.be.null;
      expect(parseMemoryMax('garbage')).to.be.null;
    });
  });
});
