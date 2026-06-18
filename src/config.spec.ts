import { expect } from 'chai';
import { Config } from '@browserless.io/browserless';

describe('Config', () => {
  describe('getSelfNavigationHosts', () => {
    it('returns the server own host:port, deduped across the http + ws address', () => {
      const config = new Config();
      config.setPort(3000);
      // getServerAddress() and getServerWebSocketAddress() share host:port, so
      // the set collapses to a single entry.
      expect(config.getSelfNavigationHosts()).to.deep.equal(['localhost:3000']);
    });

    it('is port-specific so other services on the same host are not allowed', () => {
      const config = new Config();
      config.setPort(54321);
      expect(config.getSelfNavigationHosts()).to.deep.equal([
        'localhost:54321',
      ]);
    });
  });
});
