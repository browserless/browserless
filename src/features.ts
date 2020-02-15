import { Feature } from './types';

export function isFeature(str: string): str is Feature {
  return str === 'prometheus' || str === 'debugger' || str === 'debugViewer' || str === 'introspectionEndpoint'
    || str === 'metricsEndpoint' || str === 'configEndpoint' || str === 'workspaces' || str === 'downloadEndpoint'
    || str === 'pressureEndpoint' || str === 'functionEndpoint' || str === 'killEndpoint'
    || str === 'screencastEndpoint' || str === 'screenshotEndpoint' || str === 'contentEndpoint'
    || str === 'pdfEndpoint' || str === 'statsEndpoint' || str === 'scrapeEndpoint';
}

// tslint:disable-next-line:variable-name
export const Features = {
  CONFIG_ENDPOINT: 'configEndpoint' as Feature,
  CONTENT_ENDPOINT: 'contentEndpoint' as Feature,
  DEBUGGER: 'debugger' as Feature,
  DEBUG_VIEWER: 'debugViewer' as Feature,
  DOWNLOAD_ENDPOINT: 'downloadEndpoint' as Feature,
  FUNCTION_ENDPOINT: 'functionEndpoint' as Feature,
  INTROSPECTION_ENDPOINT: 'introspectionEndpoint' as Feature,
  KILL_ENDPOINT: 'killEndpoint' as Feature,
  METRICS_ENDPOINT: 'metricsEndpoint' as Feature,
  PDF_ENDPOINT: 'pdfEndpoint' as Feature,
  PRESSURE_ENDPOINT: 'pressureEndpoint' as Feature,
  PROMETHEUS: 'prometheus' as Feature,
  SCRAPE_ENDPOINT: 'scrapeEndpoint' as Feature,
  SCREENCAST_ENDPOINT: 'screencastEndpoint' as Feature,
  SCREENSHOT_ENDPOINT: 'screenshotEndpoint' as Feature,
  STATS_ENDPOINT: 'statsEndpoint' as Feature,
  WORKSPACES: 'workspaces' as Feature,
};
