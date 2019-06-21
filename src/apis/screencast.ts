import { Page } from 'puppeteer';

interface IBefore {
  page: Page;
  code: string;
}

interface IAfter {
  code: string;
  stopScreencast: () => void;
}

declare var MediaRecorder: any;
declare var navigator: any;

export const before = async ({ page, code }: IBefore) => {
  let rec: any;
  let stream: any;

  const setupScreencast = () => page.evaluate(async () => {
    document.title = 'browserless-screencast';

    const desktopStream = await navigator.mediaDevices.getDisplayMedia({video: true, audio: false});

    const tracks = [...desktopStream.getVideoTracks()];
    stream = new MediaStream(tracks);

    let blobs: any;
    blobs = [];

    rec = new MediaRecorder(stream, {mimeType: 'video/webm; codecs=vp8,opus'});
    rec.ondataavailable = (e: any) => blobs.push(e.data);
    rec.onstop = async () => {
      const blob = new Blob(blobs, {type: 'video/webm'});
      const el = document.createElement('a');
      el.setAttribute('download', '');
      el.href = window.URL.createObjectURL(blob);
      el.click();
    };
  });

  const startScreencast = () => page.evaluate(() => rec.start());

  const stopScreencast = () => page.evaluate(async () => {
    await rec.stop();
    stream.getTracks().forEach((s: any) => s.stop());
  });

  page.on('load', async () => {
    await setupScreencast();

    if (!code.includes('startScreencast')) {
      startScreencast();
    }
  });

  return {
    startScreencast,
    stopScreencast,
  };
};

export const after = async ({ code, stopScreencast }: IAfter) => {
  if (!code.includes('stopScreencast')) {
    await stopScreencast();
  }
};
