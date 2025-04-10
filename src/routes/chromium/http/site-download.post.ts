import { 
  HTTPRoutes, 
  ChromiumCDP,
  BrowserlessRoutes,
} from '@browserless.io/browserless';
import { default as BaseChromiumSiteDownloadPostRoute } from '../../../shared/site-download.http.js';

export default class ChromiumSiteDownloadPostRoute extends BaseChromiumSiteDownloadPostRoute {
  name = BrowserlessRoutes.ChromiumSiteDownloadPostRoute;
  browser = ChromiumCDP;
  path = [HTTPRoutes.siteDownload, HTTPRoutes.chromiumSiteDownload];
} 