/* eslint-disable no-undef */

// All recordings are hoisted in this reference
// so we can navigate pages and more.
const recordings = new Map();
class Recorder {
  #recorder = null;
  #chunks = [];

  async start(opts) {
    return new Promise((resolve, reject) => {
      if (this.#recorder) {
        return reject(new Error(`${id} has already started recording`));
      }

      chrome.desktopCapture.chooseDesktopMedia(
        ['audio', 'tab'],
        async (streamId) => {
          const userMediaPreferences = {
            audio: {
              mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: streamId,
                echoCancellation: true,
              },
            },
            video: {
              mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: streamId,
                maxFrameRate: opts.framerate || 60,
                minFrameRate: opts.framerate || 60,
              },
            },
          };

          const stream = await navigator.mediaDevices.getUserMedia(
            userMediaPreferences
          );

          if (opts.video === false) {
            const videoTracks = stream.getVideoTracks();
            videoTracks.forEach((track) => stream.removeTrack(track));
          }

          if (opts.audio === false) {
            const audioTracks = stream.getAudioTracks();
            audioTracks.forEach((track) => stream.removeTrack(track));
          }

          this.#recorder = new MediaRecorder(stream, {
            ignoreMutedMedia: true,
            mimeType: opts.video === false ? 'audio/webm' : 'video/webm',
          });

          this.#recorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
              this.#chunks.push(event.data);
            }
          };
          resolve();

          // Wait 350ms for the invisible dialog to disappear
          setTimeout(() => this.#recorder.start(), 500);
        }
      );
    });
  }

  async stop() {
    return new Promise((resolve, reject) => {
      if (!this.#recorder) {
        return reject(
          new Error(`No recorder has started, did you forget to start?`)
        );
      }

      this.#recorder.onstop = () => {
        const blob = new Blob(this.#chunks, {
          type: 'video/webm',
        });
        const reader = new FileReader();

        reader.onload = () => {
          resolve(reader.result);
        };

        reader.onerror = (err) => {
          reject(err);
        };

        reader.readAsBinaryString(blob);
      };

      this.#recorder.stop();
    });
  }
}

chrome.runtime.onConnect.addListener((port) => {
  port.onMessage.addListener(async (msg) => {
    const { id, type } = msg;
    if (type === 'REC_START') {
      if (recordings.has(id)) {
        return;
      }
      const recorder = new Recorder();
      recordings.set(id, recorder);
      try {
        await recorder.start(msg);
        return port.postMessage({ id, message: 'REC_STARTED' });
      } catch (err) {
        return port.postMessage({
          error: err.message,
          id,
          message: 'REC_START_FAIL',
        });
      }
    }

    if (type === 'REC_STOP') {
      const recorder = recordings.get(id);
      if (!recorder) {
        return port.postMessage({
          id,
          message: 'REC_NOT_STARTED',
        });
      }
      try {
        const result = await recorder.stop();
        return port.postMessage({ file: result, id, message: 'REC_FILE' });
      } catch (err) {
        return port.postMessage({
          error: err.message,
          id,
          message: 'REC_STOP_FAIL',
        });
      } finally {
        recordings.delete(id);
      }
    }
  });
});
