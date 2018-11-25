let recorder = null;
let filename = null;

chrome.runtime.onConnect.addListener((port) => {
  port.onMessage.addListener((msg) => {
    switch (msg.type) {
      case 'SET_EXPORT_PATH':
        filename = msg.filename;
        break;
      case 'REC_STOP':
        recorder.stop();
        break;
      case 'REC_CLIENT_PLAY':
        if (recorder) {
          return;
        }
        chrome.desktopCapture.chooseDesktopMedia(['tab', 'audio'], streamId => {
          // Get the stream
          navigator.webkitGetUserMedia(
            {
              audio: false,
              video: {
                mandatory: {
                  chromeMediaSource: 'desktop',
                  chromeMediaSourceId: streamId,
                  minWidth: 1280,
                  maxWidth: 1280,
                  minHeight: 720,
                  maxHeight: 720,
                  minFrameRate: 60
                }
              }
            },
            (stream) => {
              const chunks = [];
              recorder = new MediaRecorder(stream, {
                videoBitsPerSecond: 2500000,
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

                chrome.downloads.download({ url: url, filename: filename }, () => {});
              };

              recorder.start();
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
    if (!delta.state || delta.state.current != 'complete') {
      return;
    }
    try {
      port.postMessage({ downloadComplete: true });
    } catch (e) {}
  });
});
