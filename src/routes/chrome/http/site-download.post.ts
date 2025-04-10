import { 
  HTTPRoutes, 
  ChromeCDP,
  BrowserlessRoutes,
} from '@browserless.io/browserless';
import { default as ChromiumSiteDownloadPostRoute } from '../../../shared/site-download.http.js';

export default class ChromeSiteDownloadPostRoute extends ChromiumSiteDownloadPostRoute {
  name = BrowserlessRoutes.ChromeSiteDownloadPostRoute;
  browser = ChromeCDP;
  path = [HTTPRoutes.siteDownload, HTTPRoutes.chromeSiteDownload];
} 