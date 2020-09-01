import * as path from 'path';
import { after as downloadAfter } from './download';
import { id, mkdir } from '../utils';
import { WORKSPACE_DIR } from '../config';
import { IBefore } from '../types';

export const before = async ({ page, code, debug, browser }: IBefore) => {
  // @ts-ignore reaching into private methods
  const client = page._client;
  const renderer = await browser.newPage();
  const downloadPath = path.join(WORKSPACE_DIR, `.browserless.download.${id()}`);
  await mkdir(downloadPath);
  const downloadName = id() + '.webm';
  let screencastAPI: any;

  // @ts-ignore
  await renderer._client.send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath,
  });

  // Setup page handlers
  const setup = async () => await renderer.evaluateHandle((downloadName) => {
    const screencastAPI = class {
      private canvas: HTMLCanvasElement;
      private ctx: CanvasRenderingContext2D;
      private downloadAnchor: HTMLAnchorElement;
      private recordingFinish: Promise<void>;
      private recorder: any;
      private chunks: any[];

      constructor() {
        this.canvas = document.createElement('canvas');
        this.downloadAnchor = document.createElement('a');

        document.body.appendChild(this.canvas);
        document.body.appendChild(this.downloadAnchor);

        this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
        this.downloadAnchor.href = '#';
        this.downloadAnchor.textContent = 'Download video';
        this.downloadAnchor.id = 'download';
        this.chunks = [];
      }

      private async beginRecording(stream: any): Promise<any[]> {
        return new Promise((resolve, reject) => {
          // @ts-ignore No MediaRecorder
          this.recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
          this.recorder.ondataavailable = (e: any) => this.chunks.push(e.data);
          this.recorder.onerror = reject;
          this.recorder.onstop = resolve;
          this.recorder.start();
        });
      }

      private async download() {
        await this.recordingFinish;
        const blob = new Blob(this.chunks, { type: 'video/webm' });

        this.downloadAnchor.onclick = () => {
          this.downloadAnchor.href = URL.createObjectURL(blob);
          this.downloadAnchor.download = downloadName;
        };

        this.downloadAnchor.click();
      }

      async start({ width, height }: { width: number; height: number }) {
        this.canvas.width = width;
        this.canvas.height = height;
        // @ts-ignore No captureStream API
        this.recordingFinish = this.beginRecording(this.canvas.captureStream());
      }

      async draw(pngData: Buffer) {
        const data = await fetch(`data:image/png;base64,${pngData}`)
          .then(res => res.blob())
          .then(blob => createImageBitmap(blob));

        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.drawImage(data, 0, 0);

        return this;
      }

      stop() {
        this.recorder.stop();
        this.download();
        return this;
      }
    };

    return new screencastAPI();
  }, downloadName);

  const startScreencast = async () => {
    const viewport = page.viewport();
    screencastAPI = await setup();
    await page.bringToFront();

    await renderer.evaluateHandle(
      (screencastAPI, width, height) => screencastAPI.start({ width, height }),
      screencastAPI,
      viewport.width, viewport.height
    );

    await client.send('Page.startScreencast', {
      format: 'jpeg',
      maxWidth: viewport.width,
      maxHeight: viewport.height,
      everyNthFrame: 1,
    });

    client.on('Page.screencastFrame', ({ data, sessionId }: { data: string; sessionId: string }) => {
      renderer.evaluateHandle((screencastAPI, data) => screencastAPI.draw(data), screencastAPI, data);
      client.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    });
  };

  const stopScreencast = async () => {
    await client.send('Page.stopScreencast');
    await renderer.bringToFront();
    await renderer.evaluateHandle((screencastAPI) => screencastAPI.stop(), screencastAPI);
  };

  page.on('load', async () => {
    if (!code.includes('startScreencast')) {
      debug(`Starting to record`);
      setTimeout(startScreencast, 0);
    }
  });

  return {
    downloadPath,
    startScreencast,
    stopScreencast,
  };
};

export const after = async(
  { code, stopScreencast, downloadPath, debug, res, done }:
  { code: string; stopScreencast: () => Promise<void>; downloadPath: string, debug: (...args: string[]) => {}, res: any, done: (errBack?: Error | null) => {} },
) => {
  if (!code.includes('stopScreencast')) {
    await stopScreencast();
  }

  return downloadAfter({ downloadPath, debug, res, done });
};
