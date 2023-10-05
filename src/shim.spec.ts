import { expect } from 'chai';

import { shimLegacyRequests } from './shim.js';

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

    it('converts headless new', () => {
      const url = 'wss://localhost?headless=new';
      const final = 'wss://localhost/?launch={"headless":"new"}';
      const shimmed = shimLegacyRequests(new URL(url));

      expect(decodeURIComponent(shimmed.href)).to.equal(final);
    });

    it('does not convert headless options when already set in launch params', () => {
      const url = 'wss://localhost?headless=false&launch={"headless":"new"}';
      const final = 'wss://localhost/?launch={"headless":"new"}';
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
});
