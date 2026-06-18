import { expect } from 'chai';
import { Config } from '@browserless.io/browserless';

describe('Config', () => {
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
  });
});
