// HTTP Routes
export { default as EdgeContentPostRoute } from './http/content.post.js';
export { default as EdgeDownloadPostRoute } from './http/download.post.js';
export { default as EdgeFunctionPostRoute } from './http/function.post.js';
export { default as EdgeJSONListGetRoute } from './http/json-list.get.js';
export { default as EdgeJSONNewPutRoute } from './http/json-new.put.js';
export { default as EdgeJSONProtocolGetRoute } from './http/json-protocol.get.js';
export { default as EdgeJSONVersionGetRoute } from './http/json-version.get.js';
export { default as EdgePDFPostRoute } from './http/pdf.post.js';
export { default as EdgePerformancePostRoute } from './http/performance.post.js';
export { default as EdgeScrapePostRoute } from './http/scrape.post.js';
export { default as EdgeScreenshotPostRoute } from './http/screenshot.post.js';

// WebSocket Routes
export { default as EdgeBrowserWebSocketRoute } from './ws/browser.js';
export { default as EdgeCDPWebSocketRoute } from './ws/cdp.js';
export { default as EdgeFunctionConnectWebSocketRoute } from './ws/function-connect.js';
export { default as EdgePageWebSocketRoute } from './ws/page.js';
export { default as EdgePlaywrightWebSocketRoute } from './ws/playwright.js';
