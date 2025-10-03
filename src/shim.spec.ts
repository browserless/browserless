import * as http from 'http';
import { expect } from 'chai';
import {
  shimLegacyRequests,
  moveTokenToHeader,
} from '@browserless.io/browserless';

describe('Request Shimming', () => {
  describe('headless', () => {
    it('converts headless true', () => {
      const url = 'wss://localhost?headless=true';
      const final = 'wss://localhost/?launch={"headless":true}';
      const shimmed = shimLegacyRequests(new URL(url));

      expect(decodeURIComponent(shimmed.href)).to.equal(final);
    });

    it('converts headless false', () => {
      const url = 'wss://localhost?headless=false';
      const final = 'wss://localhost/?launch={"headless":false}';
      const shimmed = shimLegacyRequests(new URL(url));

      expect(decodeURIComponent(shimmed.href)).to.equal(final);
    });

    it('converts headless shell', () => {
      const url = 'wss://localhost?headless=shell';
      const final = 'wss://localhost/?launch={"headless":"shell"}';
      const shimmed = shimLegacyRequests(new URL(url));

      expect(decodeURIComponent(shimmed.href)).to.equal(final);
    });

    it('does not convert headless options when already set in launch params', () => {
      const url = 'wss://localhost?headless=false&launch={"headless":"shell"}';
      const final = 'wss://localhost/?launch={"headless":"shell"}';
      const shimmed = shimLegacyRequests(new URL(url));

      expect(decodeURIComponent(shimmed.href)).to.equal(final);
    });

    it('converts legacy headless into prior specified launch options', () => {
      const url = 'wss://localhost?headless=true&launch={"args":["--cool"]}';
      const final =
        'wss://localhost/?launch={"args":["--cool"],"headless":true}';
      const shimmed = shimLegacyRequests(new URL(url));

      expect(decodeURIComponent(shimmed.href)).to.equal(final);
    });
  });

  describe('stealth', () => {
    it('converts stealth true', () => {
      const url = 'wss://localhost?stealth=true';
      const final = 'wss://localhost/?launch={"stealth":true}';
      const shimmed = shimLegacyRequests(new URL(url));

      expect(decodeURIComponent(shimmed.href)).to.equal(final);
    });

    it('converts stealth false', () => {
      const url = 'wss://localhost?stealth=false';
      const final = 'wss://localhost/?launch={"stealth":false}';
      const shimmed = shimLegacyRequests(new URL(url));

      expect(decodeURIComponent(shimmed.href)).to.equal(final);
    });

    it('does not convert stealth options when already set in launch params', () => {
      const url = 'wss://localhost?stealth=false&launch={"stealth":true}';
      const final = 'wss://localhost/?launch={"stealth":true}';
      const shimmed = shimLegacyRequests(new URL(url));

      expect(decodeURIComponent(shimmed.href)).to.equal(final);
    });

    it('converts legacy stealth into prior specified launch options', () => {
      const url = 'wss://localhost?stealth=true&launch={"args":["--cool"]}';
      const final =
        'wss://localhost/?launch={"args":["--cool"],"stealth":true}';
      const shimmed = shimLegacyRequests(new URL(url));

      expect(decodeURIComponent(shimmed.href)).to.equal(final);
    });
  });

  describe('slowMo', () => {
    it('converts slowMo', () => {
      const url = 'wss://localhost?slowMo=100';
      const final = 'wss://localhost/?launch={"slowMo":100}';
      const shimmed = shimLegacyRequests(new URL(url));

      expect(decodeURIComponent(shimmed.href)).to.equal(final);
    });

    it('does not convert slowMo options when already set in launch params', () => {
      const url = 'wss://localhost?slowMo=100&launch={"slowMo":500}';
      const final = 'wss://localhost/?launch={"slowMo":500}';
      const shimmed = shimLegacyRequests(new URL(url));

      expect(decodeURIComponent(shimmed.href)).to.equal(final);
    });

    it('converts legacy slowMo into prior specified launch options', () => {
      const url = 'wss://localhost?slowMo=500&launch={"args":["--cool"]}';
      const final = 'wss://localhost/?launch={"args":["--cool"],"slowMo":500}';
      const shimmed = shimLegacyRequests(new URL(url));

      expect(decodeURIComponent(shimmed.href)).to.equal(final);
    });
  });

  describe('ignoreDefaultArgs', () => {
    it('converts ignoreDefaultArgs true', () => {
      const url = 'wss://localhost?ignoreDefaultArgs=true';
      const final = 'wss://localhost/?launch={"ignoreDefaultArgs":true}';
      const shimmed = shimLegacyRequests(new URL(url));

      expect(decodeURIComponent(shimmed.href)).to.equal(final);
    });

    it('converts ignoreDefaultArgs false', () => {
      const url = 'wss://localhost?ignoreDefaultArgs=false';
      const final = 'wss://localhost/?launch={"ignoreDefaultArgs":false}';
      const shimmed = shimLegacyRequests(new URL(url));

      expect(decodeURIComponent(shimmed.href)).to.equal(final);
    });

    it('does not convert ignoreDefaultArgs options when already set in launch params', () => {
      const url =
        'wss://localhost?ignoreDefaultArgs=false&launch={"ignoreDefaultArgs":true}';
      const final = 'wss://localhost/?launch={"ignoreDefaultArgs":true}';
      const shimmed = shimLegacyRequests(new URL(url));

      expect(decodeURIComponent(shimmed.href)).to.equal(final);
    });

    it('converts legacy ignoreDefaultArgs into prior specified launch options', () => {
      const url =
        'wss://localhost?ignoreDefaultArgs&launch={"args":["--cool"]}';
      const final =
        'wss://localhost/?launch={"args":["--cool"],"ignoreDefaultArgs":true}';
      const shimmed = shimLegacyRequests(new URL(url));

      expect(decodeURIComponent(shimmed.href)).to.equal(final);
    });

    it('handles array options', () => {
      const url = 'wss://localhost?ignoreDefaultArgs=one,two,three';
      const final =
        'wss://localhost/?launch={"ignoreDefaultArgs":["one","two","three"]}';
      const shimmed = shimLegacyRequests(new URL(url));

      expect(decodeURIComponent(shimmed.href)).to.equal(final);
    });
  });

  describe('no params', () => {
    it('does not alter URLS when no params are set', () => {
      const url = 'wss://localhost';
      const final = 'wss://localhost/';
      const shimmed = shimLegacyRequests(new URL(url));

      expect(decodeURIComponent(shimmed.href)).to.equal(final);
    });

    it('does not alter URLS when unknown params are set', () => {
      const url = 'wss://localhost?silly=banana';
      const final = 'wss://localhost/?silly=banana';
      const shimmed = shimLegacyRequests(new URL(url));

      expect(decodeURIComponent(shimmed.href)).to.equal(final);
    });
  });

  describe('insecure certs', () => {
    it('converts ignoreHTTPSErrors to acceptInsecureCerts', () => {
      const url = 'wss://localhost?ignoreHTTPSErrors';
      const final = 'wss://localhost/?launch={"acceptInsecureCerts":true}';
      const shimmed = shimLegacyRequests(new URL(url));

      expect(decodeURIComponent(shimmed.href)).to.equal(final);
    });

    it('acceptInsecureCerts takes precedence over ignoreHTTPSErrors', () => {
      const url = 'wss://localhost?ignoreHTTPSErrors&launch={"acceptInsecureCerts":false}';
      const final = 'wss://localhost/?launch={"acceptInsecureCerts":false}';
      const shimmed = shimLegacyRequests(new URL(url));

      expect(decodeURIComponent(shimmed.href)).to.equal(final);
    });
  });

  describe('token shimming', () => {
    it('converts token query parameters to an authorization header', () => {
      const url = 'wss://localhost?token=12345';
      const shimmed = moveTokenToHeader({
        url,
        headers: {},
      } as unknown as http.IncomingMessage);

      expect(shimmed).not.to.include('?token=');
    });

    it('converts the token to a proper header', () => {
      const url = 'wss://localhost?token=12345';
      const request = { url, headers: {} } as unknown as http.IncomingMessage;

      moveTokenToHeader(request);

      expect(request.headers.authorization).to.eql('Bearer 12345');
    });

    it('does no conversion if an authorization header is already present', () => {
      const oldAuth = 'Bearer foo-bar';
      const url = 'wss://localhost?token=12345';
      const request = {
        url,
        headers: { authorization: oldAuth },
      } as unknown as http.IncomingMessage;

      const shimmed = moveTokenToHeader(request);

      expect(shimmed).not.to.include('?token=');
      expect(request.headers.authorization).to.eql(oldAuth);
    });
  });
});
