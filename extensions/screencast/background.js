let recorder = null;
let shouldRecord = false;

// Some of these get defaulted by REC_CLIENT_SETUP
// and all can be overridden by calling `setPreferences`
let preferences = {
  source: 'desktop',
  audio: true,
  type: 'video/webm',
  mimeType: 'video/webm',
  framerate: 60,
  width: 0,
  height: 0,
};

chrome.runtime.onConnect.addListener((port) => {
  port.onMessage.addListener((msg) => {
    switch (msg.type) {
      case 'REC_STOP':
        recorder && recorder.stop();
        break;

      case 'SET_PREFERENCES':
        alert('HIT');
        preferences = {
          ...preferences,
          ...msg.prefs,
        };
        break;

      case 'REC_START':
        // Set a flag to start in case the stream hasn't been setup yet
        shouldRecord = true
        recorder && recorder.start();
        break;

      case 'REC_CLIENT_SETUP':
        if (recorder) {
          return;
        }
        alert('REC_CLIENT_SETUP');
        chrome.desktopCapture.chooseDesktopMedia(['audio','tab'], streamId => {
          // Get the stream
          navigator.webkitGetUserMedia(
            {
              audio: preferences.audio && {
                mandatory: {
                  chromeMediaSource: preferences.source,
                  chromeMediaSourceId: streamId,
                  echoCancellation: true
                },
              },
              video: {
                mandatory: {
                  chromeMediaSource: preferences.source,
                  chromeMediaSourceId: streamId,
                  minFrameRate: preferences.framerate,
                  maxFrameRate: preferences.framerate,
                  minWidth: preferences.width || msg.width,
                  maxWidth: preferences.width || msg.width,
                  minHeight: preferences.width || msg.height,
                  maxHeight: preferences.width || msg.height,
                }
              }
            },
            (stream) => {
              const chunks = [];
              recorder = new MediaRecorder(stream, {
                ignoreMutedMedia: true,
                mimeType: preferences.mimeType
              });

              recorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                  chunks.push(event.data);
                }
              };

              recorder.onstop = () => {
                const url = URL.createObjectURL(new Blob(chunks, {
                  type: preferences.type
                }));

                chrome.downloads.download({ url }, () => {});
              };

              shouldRecord && recorder.start();
            },
            error => console.log('Unable to get user media', error)
          );
        });
        break;

      default:
        console.log('Unrecognized message', msg);
    }
  });

  chrome.downloads.onChanged.addListener((delta) => {
    if (delta.filename && delta.filename.current) {
      port.postMessage({ filename: delta.filename.current });
    }

    if (!delta.state || delta.state.current !== 'complete') {
      return;
    }

    try {
      port.postMessage({ downloadComplete: true });
    } catch (e) {}
  });
});
