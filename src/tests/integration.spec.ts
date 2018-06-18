// import * as puppeteer from 'puppeteer';
// import { BrowserlessServer } from '../browserless-server';

// const defaultParams = {
//   autoQueue: false,
//   chromeRefreshTime: 0,
//   connectionTimeout: 2000,
//   demoMode: false,
//   enableDebugger: true,
//   healthFailureURL: null,
//   keepAlive: false,
//   maxCPU: 100,
//   maxChromeRefreshRetries: 1,
//   maxConcurrentSessions: 2,
//   maxMemory: 100,
//   maxQueueLength: 2,
//   port: 3000,
//   prebootChrome: false,
//   queuedAlertURL: null,
//   rejectAlertURL: null,
//   timeoutAlertURL: null,
//   token: null,
// };

// const pleaseWriteTest = () => {
//   throw new Error(`Write this test`);
// };

// const shutdown = (instances) => {
//   return Promise.all(instances.map((instance) => instance.close()));
// };

// describe('Browserless Chrome', () => {
//   describe('WebSockets', () => {
//     it('runs requests concurrently', async () => {
//       const browserless = new BrowserlessServer(defaultParams);
//       await browserless.startServer();

//       const [ connectionOne, connectionTwo ] = await Promise.all([
//         puppeteer.connect({ browserWSEndpoint: `ws://localhost:${defaultParams.port}` }),
//         puppeteer.connect({ browserWSEndpoint: `ws://localhost:${defaultParams.port}` }),
//       ]);

//       expect(browserless.chromeService.queue).toHaveLength(2);

//       return shutdown([
//         browserless,
//         connectionOne,
//         connectionTwo,
//       ]);
//     });

//     it('queues requests', pleaseWriteTest);

//     it('fails requests', async () => {
//       const browserless = new BrowserlessServer({
//         ...defaultParams,
//         maxConcurrentSessions: 0,
//         maxQueueLength: 0,
//       });

//       await browserless.startServer();

//       expect(async () => {
//         await puppeteer.connect({ browserWSEndpoint: `ws://localhost:${defaultParams.port}` });
//       }).toThrowError();

//       return shutdown([ browserless ]);
//     });

//     it('runs uploaded code', pleaseWriteTest);

//     it('closes chrome when complete', pleaseWriteTest);
//   });

//   describe('HTTP', () => {
//     it('allows requests to /json/version', pleaseWriteTest);
//     it('allows requests to /introspection', pleaseWriteTest);
//     it('allows requests to /json/protocol', pleaseWriteTest);
//     it('allows requests to /metrics', pleaseWriteTest);
//     it('allows requests to /config', pleaseWriteTest);
//     it('allows requests to /pressure', pleaseWriteTest);
//     it('allows requests to /function', pleaseWriteTest);
//     it('allows requests to /screenshot', pleaseWriteTest);
//     it('allows requests to /content', pleaseWriteTest);
//     it('allows requests to /pdf', pleaseWriteTest);
//   });
// });
