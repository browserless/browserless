import { 
  HTTPRoutes, 
  EdgeCDP,
  BrowserlessRoutes,
} from '@browserless.io/browserless';
import { default as ChromiumSiteDownloadPostRoute } from '../../../shared/site-download.http.js';

export default class EdgeSiteDownloadPostRoute extends ChromiumSiteDownloadPostRoute {
  name = BrowserlessRoutes.EdgeSiteDownloadPostRoute;
  browser = EdgeCDP;
  path = [HTTPRoutes.siteDownload, HTTPRoutes.edgeSiteDownload];
} 