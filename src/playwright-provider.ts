import { last as _last } from 'lodash';

const { playwrightVersions } = require('../package.json');

export const getPlaywright = async (selectedVersion: string | undefined) => {
  const version = selectedVersion
    ? playwrightVersions[selectedVersion] || playwrightVersions.default
    : playwrightVersions.default;

  const playwright = require(version);
  return playwright.chromium;
};

export const isVersionCompatible = (version: string) => {
  return Boolean(playwrightVersions[version]);
};

export const earliestPlaywrightVersion = _last(Object.keys(playwrightVersions));
