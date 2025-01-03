import {
  APITags,
  BrowserlessRoutes,
  ChromiumCDP,
  FirefoxPlaywright,
  HTTPManagementRoutes,
  HTTPRoute,
  Methods,
  Request,
  WebKitPlaywright,
  availableBrowsers,
  contentTypes,
  jsonResponse,
} from '@browserless.io/browserless';
import { ServerResponse } from 'http';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ResponseSchema {
  /**
   * The semantic version of the Browserless API
   */
  version: string;

  /**
   * The version of Chromium installed, or null if not installed
   */
  chromium: string | null;

  /**
   * The version of Webkit installed, or null if not installed
   */
  webkit: string | null;

  /**
   * The version of Firefox installed, or null if not installed
   */
  firefox: string | null;

  /**
   * The supported version(s) of puppeteer
   */
  playwright: string[];

  /**
   * The supported version(s) of playwright
   */
  puppeteer: string[];
}

const semverReg = /(\*|\^|>|=|<|~)/gi;
const require = createRequire(import.meta.url);
const blessPackageJSON = require(
  path.join(__dirname, '..', '..', '..', '..', 'package.json'),
);
const { browsers } = require(
  path.join(process.cwd(), 'node_modules', 'playwright-core', 'browsers.json'),
) as {
  browsers: [
    {
      name: string;
      browserVersion: string;
    },
  ];
};
const chromium = browsers.find((b) => b.name === 'chromium')!.browserVersion;
const firefox = browsers.find((b) => b.name === 'firefox')!.browserVersion;
const webkit = browsers.find((b) => b.name === 'webkit')!.browserVersion;
const playwrightCore = blessPackageJSON.dependencies['playwright-core'].replace(
  semverReg,
  '',
);
const puppeteer = blessPackageJSON.dependencies['puppeteer-core'].replace(
  semverReg,
  '',
);
const playwright = Object.entries(blessPackageJSON.playwrightVersions)
  .map(([, v]) => blessPackageJSON.dependencies[v as string])
  .filter((_) => !!_)
  .map((v) => v.match(/[0-9.]+/g).join(''))
  .concat(playwrightCore);

export default class MetaGetRoute extends HTTPRoute {
  name = BrowserlessRoutes.MetaGetRoute;
  accepts = [contentTypes.any];
  auth = true;
  browser = null;
  concurrency = false;
  contentTypes = [contentTypes.json];
  description = `Returns a JSON payload of the current system versions, including the core API version.`;
  method = Methods.get;
  path = HTTPManagementRoutes.meta;
  tags = [APITags.management];
  async handler(_req: Request, res: ServerResponse): Promise<void> {
    const installedBrowsers = await availableBrowsers;
    const response: ResponseSchema = {
      version: blessPackageJSON.version,
      chromium: installedBrowsers.includes(ChromiumCDP) ? chromium : null,
      firefox: installedBrowsers.includes(FirefoxPlaywright) ? firefox : null,
      webkit: installedBrowsers.includes(WebKitPlaywright) ? webkit : null,
      playwright: [...new Set(playwright)],
      puppeteer: [puppeteer],
    };
    return jsonResponse(res, 200, response);
  }
}
