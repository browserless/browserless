import { expect } from 'chai';
import { Config } from '@browserless.io/browserless';

describe('Config', () => {
  it('preserves an unset limit and snapshots valid operator byte limits', () => {
    const original = process.env.CDP_MAX_INBOUND_PAYLOAD;
    const legacy = process.env.WS_MAX_PAYLOAD;
    try {
      delete process.env.CDP_MAX_INBOUND_PAYLOAD;
      process.env.WS_MAX_PAYLOAD = 'invalid-legacy-setting';
      expect(new Config().getCdpMaxInboundPayload()).to.equal(undefined);
      process.env.CDP_MAX_INBOUND_PAYLOAD = '';
      expect(new Config().getCdpMaxInboundPayload()).to.equal(undefined);
      for (const value of [1, 512, 134217728, 2147483647]) {
        process.env.CDP_MAX_INBOUND_PAYLOAD = String(value);
        const config = new Config();
        delete process.env.CDP_MAX_INBOUND_PAYLOAD;
        expect(config.getCdpMaxInboundPayload()).to.equal(value);
      }
    } finally {
      if (original === undefined) delete process.env.CDP_MAX_INBOUND_PAYLOAD;
      else process.env.CDP_MAX_INBOUND_PAYLOAD = original;
      if (legacy === undefined) delete process.env.WS_MAX_PAYLOAD;
      else process.env.WS_MAX_PAYLOAD = legacy;
    }
  });

  it('rejects invalid CDP_MAX_INBOUND_PAYLOAD during configuration without exposing its value', () => {
    const original = process.env.CDP_MAX_INBOUND_PAYLOAD;
    try {
      for (const value of [
        '0',
        '-1',
        '1.5',
        'NaN',
        'Infinity',
        '2147483648',
        'private-invalid-value',
      ]) {
        process.env.CDP_MAX_INBOUND_PAYLOAD = value;
        expect(() => new Config())
          .to.throw(/CDP_MAX_INBOUND_PAYLOAD/)
          .with.property('message')
          .that.does.not.include('private-invalid-value');
      }
    } finally {
      if (original === undefined) delete process.env.CDP_MAX_INBOUND_PAYLOAD;
      else process.env.CDP_MAX_INBOUND_PAYLOAD = original;
    }
  });

  describe('getSelfNavigationHosts', () => {
    it('returns the server own host:port, deduped across the http + ws address', () => {
      const config = new Config();
      config.setPort(3000);
      // Derive the expected host from the server address itself so the
      // assertion holds regardless of the HOST env (CI may set it). The http
      // and ws addresses share host:port, so the set collapses to one entry.
      const expected = new URL(config.getServerAddress()).host;
      expect(config.getSelfNavigationHosts()).to.deep.equal([expected]);
      expect(expected).to.match(/:3000$/);
    });

    it('is port-specific so other services on the same host are not allowed', () => {
      const config = new Config();
      config.setPort(54321);
      const hosts = config.getSelfNavigationHosts();
      expect(hosts).to.have.lengthOf(1);
      expect(hosts[0]).to.match(/:54321$/);
    });

    it('reflects a runtime port change rather than serving a stale memo', () => {
      const config = new Config();
      config.setPort(3000);
      expect(config.getSelfNavigationHosts()[0]).to.match(/:3000$/);
      // The result is memoized per request on the navigation hot path, but the
      // server binds its real port via #setPort, so the memo must key off the
      // current host:port and recompute when it changes.
      config.setPort(4000);
      expect(config.getSelfNavigationHosts()[0]).to.match(/:4000$/);
    });
  });
});
