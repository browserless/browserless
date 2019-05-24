let recorder = null;
let shouldRecord = false;

chrome.runtime.onConnect.addListener((port) => {
  port.onMessage.addListener((msg) => {
    switch (msg.type) {
      case 'REC_STOP':
        recorder && recorder.stop();
        break;

      case 'REC_START':
        // Set a flag to start in case the stream hasn't been setup yet
        shouldRecord = true
        recorder && recorder.start();
        break;

      case 'REC_CLIENT_PLAY':
        if (recorder) {
          return;
        }
        chrome.desktopCapture.chooseDesktopMedia(['audio','tab'], streamId => {
          // Get the stream
          navigator.webkitGetUserMedia(
            {
              audio: {
                mandatory: {
                  chromeMediaSource: 'desktop',
                  chromeMediaSourceId: streamId,
                  echoCancellation: true
                },
              },
              video: {
                mandatory: {
                  chromeMediaSource: 'desktop',
                  chromeMediaSourceId: streamId,
                  minFrameRate: 60
                }
              }
            },
            (stream) => {
              const chunks = [];
              recorder = new MediaRecorder(stream, {
                ignoreMutedMedia: true,
                mimeType: 'video/webm'
              });

              recorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                  chunks.push(event.data);
                }
              };

              recorder.onstop = () => {
                const url = URL.createObjectURL(new Blob(chunks, {
                  type: 'video/webm'
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
