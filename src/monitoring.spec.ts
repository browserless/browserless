/* eslint-disable no-unused-expressions */
import {
  CgroupV1Source,
  CgroupV2Source,
  HostSource,
  Logger,
  parseCpuMax,
  parseCpuStatUsageUsec,
  parseCpuV1Quota,
  parseMemoryMax,
  parseMemoryV1Limit,
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

describe('CgroupV2Source', () => {
  afterEach(() => Sinon.restore());

  const makeReadFile = (responses: Record<string, string | Error>) => {
    return async (path: string) => {
      const v = responses[path];
      if (v === undefined) throw new Error(`unexpected path ${path}`);
      if (v instanceof Error) throw v;
      return v;
    };
  };

  it('returns null for cpu on the first call (no prior sample)', async () => {
    const now = Sinon.stub();
    now.returns(1_000_000);

    const source = new CgroupV2Source({
      readFile: makeReadFile({
        '/sys/fs/cgroup/cpu.stat': 'usage_usec 1000\n',
        '/sys/fs/cgroup/cpu.max': '100000 100000',
        '/sys/fs/cgroup/memory.current': '536870912',
        '/sys/fs/cgroup/memory.max': '1073741824',
      }),
      now,
    });

    const result = await source.read();
    expect(result.cpu).to.be.null;
    expect(result.memory).to.equal(0.5);
  });

  it('computes cpu fraction from delta between two reads', async () => {
    const responses: Record<string, string> = {
      '/sys/fs/cgroup/cpu.stat': 'usage_usec 1000\n',
      '/sys/fs/cgroup/cpu.max': '100000 100000', // 1 core
      '/sys/fs/cgroup/memory.current': '0',
      '/sys/fs/cgroup/memory.max': '1073741824',
    };
    const readFile = async (path: string) => responses[path];

    const now = Sinon.stub();
    now.onCall(0).returns(1_000_000); // first sample at t=0
    now.onCall(1).returns(1_001_000); // second read 1000ms later

    const source = new CgroupV2Source({ readFile, now });
    await source.read(); // store first sample

    // 1,000,000 usec of CPU time consumed in 1000 ms wall, on 1 core = 100%
    responses['/sys/fs/cgroup/cpu.stat'] = 'usage_usec 1001000\n';

    const result = await source.read();
    expect(result.cpu).to.be.closeTo(1.0, 0.001);
  });

  it('uses os.cpus().length when cpu.max is "max"', async () => {
    const responses: Record<string, string> = {
      '/sys/fs/cgroup/cpu.stat': 'usage_usec 0\n',
      '/sys/fs/cgroup/cpu.max': 'max 100000',
      '/sys/fs/cgroup/memory.current': '0',
      '/sys/fs/cgroup/memory.max': 'max',
    };
    const readFile = async (path: string) => responses[path];

    const now = Sinon.stub();
    now.onCall(0).returns(1_000_000);
    now.onCall(1).returns(1_001_000);

    const source = new CgroupV2Source({ readFile, now });
    await source.read();

    const cores = os.cpus().length;
    // 1,000,000 usec used over 1000 ms wall on N cores = 1/N
    responses['/sys/fs/cgroup/cpu.stat'] = 'usage_usec 1000000\n';

    const result = await source.read();
    expect(result.cpu).to.be.closeTo(1 / cores, 0.001);
  });

  it('returns nulls when a read fails, logs once per category', async () => {
    const warnStub = Sinon.stub(Logger.prototype, 'warn');

    const readFile = async () => {
      throw new Error('EACCES');
    };

    const source = new CgroupV2Source({ readFile });
    const result1 = await source.read();
    const result2 = await source.read();

    expect(result1).to.deep.equal({ cpu: null, memory: null });
    expect(result2).to.deep.equal({ cpu: null, memory: null });

    // 2 categories of read failure (cpu-read, memory-read) — each logged exactly once.
    expect(warnStub.callCount).to.equal(2);
    const messages = warnStub.getCalls().map((c) => c.args[0] as string);
    expect(messages.some((m) => m.includes('cpu-read'))).to.be.true;
    expect(messages.some((m) => m.includes('memory-read'))).to.be.true;
  });

  it('returns nulls when cpu.stat is unparseable', async () => {
    const source = new CgroupV2Source({
      readFile: makeReadFile({
        '/sys/fs/cgroup/cpu.stat': 'garbage\n',
        '/sys/fs/cgroup/cpu.max': '100000 100000',
        '/sys/fs/cgroup/memory.current': '0',
        '/sys/fs/cgroup/memory.max': '1073741824',
      }),
    });

    const result = await source.read();
    expect(result.cpu).to.be.null;
    expect(result.memory).to.equal(0);
  });

  it('decouples memory failure from cpu success', async () => {
    const responses: Record<string, string> = {
      '/sys/fs/cgroup/cpu.stat': 'usage_usec 1000\n',
      '/sys/fs/cgroup/cpu.max': '100000 100000', // 1 core
      '/sys/fs/cgroup/memory.current': '0',
      '/sys/fs/cgroup/memory.max': 'garbage',
    };
    const readFile = async (path: string) => responses[path];

    const now = Sinon.stub();
    now.onCall(0).returns(1_000_000);
    now.onCall(1).returns(1_001_000);

    const source = new CgroupV2Source({ readFile, now });
    await source.read(); // first sample stored

    responses['/sys/fs/cgroup/cpu.stat'] = 'usage_usec 1001000\n';
    const result = await source.read();
    expect(result.cpu).to.be.closeTo(1.0, 0.001);
    expect(result.memory).to.be.null;
  });
});

describe('cgroup v1 parsers', () => {
  describe('parseCpuV1Quota', () => {
    it('returns quota/period when bounded', () => {
      expect(parseCpuV1Quota('200000', '100000')).to.equal(2);
      expect(parseCpuV1Quota('50000', '100000')).to.equal(0.5);
    });

    it('returns os.cpus().length when quota is -1 (unbounded)', () => {
      expect(parseCpuV1Quota('-1', '100000')).to.equal(os.cpus().length);
    });

    it('returns null for invalid content', () => {
      expect(parseCpuV1Quota('abc', '100000')).to.be.null;
      expect(parseCpuV1Quota('100000', '0')).to.be.null;
    });

    it('returns null when quota content is empty or whitespace', () => {
      expect(parseCpuV1Quota('', '100000')).to.be.null;
      expect(parseCpuV1Quota('   ', '100000')).to.be.null;
    });
  });

  describe('parseMemoryV1Limit', () => {
    it('returns the byte value when bounded', () => {
      expect(parseMemoryV1Limit('536870912')).to.equal(536870912);
    });

    it('returns os.totalmem() when the kernel sentinel is used (unbounded)', () => {
      // Treat any value larger than 16 * host RAM as unbounded
      const sentinel = String(os.totalmem() * 32);
      expect(parseMemoryV1Limit(sentinel)).to.equal(os.totalmem());
    });

    it('returns null for invalid content', () => {
      expect(parseMemoryV1Limit('garbage')).to.be.null;
      expect(parseMemoryV1Limit('')).to.be.null;
    });
  });
});

describe('CgroupV1Source', () => {
  afterEach(() => Sinon.restore());

  it('converts cpuacct.usage from nanoseconds to fractional cpu', async () => {
    const responses: Record<string, string> = {
      '/sys/fs/cgroup/cpu/cpuacct.usage': '1000000', // 1 ms in ns = 1000 us
      '/sys/fs/cgroup/cpu/cpu.cfs_quota_us': '100000', // 1 core
      '/sys/fs/cgroup/cpu/cpu.cfs_period_us': '100000',
      '/sys/fs/cgroup/memory/memory.usage_in_bytes': '0',
      '/sys/fs/cgroup/memory/memory.limit_in_bytes': '1073741824',
    };
    const readFile = async (path: string) => responses[path];

    const now = Sinon.stub();
    now.onCall(0).returns(1_000_000);
    now.onCall(1).returns(1_001_000);

    const source = new CgroupV1Source({ readFile, now });
    await source.read();

    // 1,000,000,000 ns = 1,000,000 us delta over 1000 ms wall on 1 core = 100%
    responses['/sys/fs/cgroup/cpu/cpuacct.usage'] = '1001000000';
    const result = await source.read();
    expect(result.cpu).to.be.closeTo(1.0, 0.001);
  });

  it('computes memory fraction', async () => {
    const responses: Record<string, string> = {
      '/sys/fs/cgroup/cpu/cpuacct.usage': '0',
      '/sys/fs/cgroup/cpu/cpu.cfs_quota_us': '100000',
      '/sys/fs/cgroup/cpu/cpu.cfs_period_us': '100000',
      '/sys/fs/cgroup/memory/memory.usage_in_bytes': '268435456',
      '/sys/fs/cgroup/memory/memory.limit_in_bytes': '536870912',
    };
    const source = new CgroupV1Source({
      readFile: async (path: string) => responses[path],
    });
    const result = await source.read();
    expect(result.memory).to.equal(0.5);
  });

  it('returns nulls when a read fails, logs once per category', async () => {
    const warnStub = Sinon.stub(Logger.prototype, 'warn');

    const readFile = async () => {
      throw new Error('EACCES');
    };

    const source = new CgroupV1Source({ readFile });
    const result1 = await source.read();
    const result2 = await source.read();

    expect(result1).to.deep.equal({ cpu: null, memory: null });
    expect(result2).to.deep.equal({ cpu: null, memory: null });

    // 2 categories of read failure (cpu-read, memory-read) — each logged exactly once.
    expect(warnStub.callCount).to.equal(2);
    const messages = warnStub.getCalls().map((c) => c.args[0] as string);
    expect(messages.some((m) => m.includes('cpu-read'))).to.be.true;
    expect(messages.some((m) => m.includes('memory-read'))).to.be.true;
  });

  it('decouples memory failure from cpu success', async () => {
    const responses: Record<string, string> = {
      '/sys/fs/cgroup/cpu/cpuacct.usage': '1000000',
      '/sys/fs/cgroup/cpu/cpu.cfs_quota_us': '100000',
      '/sys/fs/cgroup/cpu/cpu.cfs_period_us': '100000',
      '/sys/fs/cgroup/memory/memory.usage_in_bytes': '0',
      '/sys/fs/cgroup/memory/memory.limit_in_bytes': 'garbage',
    };
    const readFile = async (path: string) => responses[path];

    const now = Sinon.stub();
    now.onCall(0).returns(1_000_000);
    now.onCall(1).returns(1_001_000);

    const source = new CgroupV1Source({ readFile, now });
    await source.read(); // first sample stored

    responses['/sys/fs/cgroup/cpu/cpuacct.usage'] = '1001000000';
    const result = await source.read();
    expect(result.cpu).to.be.closeTo(1.0, 0.001);
    expect(result.memory).to.be.null;
  });
});
