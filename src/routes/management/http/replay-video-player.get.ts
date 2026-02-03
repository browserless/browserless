import {
  APITags,
  BrowserlessRoutes,
  HTTPManagementRoutes,
  HTTPRoute,
  Methods,
  NotFound,
  Request,
  SystemQueryParameters,
  contentTypes,
  writeResponse,
} from '@browserless.io/browserless';
import { ServerResponse } from 'http';

export interface QuerySchema extends SystemQueryParameters {
  token?: string;
}

/**
 * Video player page for a replay.
 *
 * Both encoding-in-progress and completed states use HLS playback via
 * hls-video-element + media-chrome. The only difference is whether the
 * playlist is still growing (encoding) or finalized (completed).
 */
export default class ReplayVideoPlayerGetRoute extends HTTPRoute {
  name = BrowserlessRoutes.ReplayVideoPlayerGetRoute;
  accepts = [contentTypes.any];
  auth = true;
  browser = null;
  concurrency = false;
  contentTypes = [contentTypes.html];
  description = `View a video replay in an HTML5 player.`;
  method = Methods.get;
  path = HTTPManagementRoutes.replayVideoPlayer;
  tags = [APITags.management];

  async handler(req: Request, res: ServerResponse): Promise<void> {
    const replay = this.sessionReplay();
    if (!replay) {
      return writeResponse(res, 503, 'Session replay is not enabled');
    }

    // Extract replay ID from path: /replays/:id/video/player
    const pathParts = req.parsed.pathname.split('/');
    const videoIndex = pathParts.indexOf('video');
    const id = videoIndex > 0 ? pathParts[videoIndex - 1] : null;

    if (!id) {
      throw new NotFound('Replay ID is required');
    }

    // Pass auth token through to sub-resource URLs (video, HLS, status)
    const token = req.parsed.searchParams.get('token') ?? '';

    // Check replay metadata for encoding status
    const store = replay.getStore();
    let encodingStatus = 'none';
    let frameCount = 0;

    if (store) {
      const result = store.findById(id);
      if (result.ok && result.value) {
        encodingStatus = result.value.encodingStatus;
        frameCount = result.value.frameCount;
      } else if (result.ok && !result.value) {
        throw new NotFound(`Replay "${id}" not found`);
      }
    }

    // Trigger on-demand encoding for deferred sessions (lazy encoding)
    if (encodingStatus === 'deferred') {
      const encoder = replay.getVideoEncoder();
      const replaysDir = replay.getReplaysDir();
      if (encoder && store) {
        store.updateEncodingStatus(id, 'pending');
        encoder.queueEncode(id, replaysDir, frameCount);
        encodingStatus = 'pending';
      }
    }

    const html = this.generatePlayerHTML(id, encodingStatus, frameCount, token);

    res.setHeader('Content-Type', 'text/html');
    res.writeHead(200);
    res.end(html);
  }

  private generatePlayerHTML(
    id: string,
    encodingStatus: string,
    frameCount: number,
    token: string,
  ): string {
    const tokenParam = token ? `?token=${encodeURIComponent(token)}` : '';
    const hlsUrl = `/replays/${id}/video/hls/playlist.m3u8${tokenParam}`;
    const statusUrl = `/replays/${id}/video/status${tokenParam}`;
    const isReady = encodingStatus === 'completed';
    const isEncoding = encodingStatus === 'deferred' || encodingStatus === 'pending' || encodingStatus === 'encoding';
    const hasFailed = encodingStatus === 'failed';
    const noVideo = encodingStatus === 'none' && frameCount === 0;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Video Replay - ${id}</title>
  ${isReady || isEncoding ? `
  <script type="module" src="https://cdn.jsdelivr.net/npm/hls-video-element@1.2/+esm"></script>
  <script type="module" src="https://cdn.jsdelivr.net/npm/media-chrome@4/+esm"></script>
  ` : ''}
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #0a0a0a;
      color: #e0e0e0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .container { text-align: center; width: 100%; max-width: 1300px; padding: 20px; }
    media-controller {
      width: 100%;
      max-height: 85vh;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 4px 24px rgba(0,0,0,0.5);
    }
    media-controller video,
    media-controller hls-video {
      width: 100%;
      max-height: 85vh;
    }
    .status {
      padding: 40px;
      border-radius: 8px;
      background: #1a1a1a;
    }
    .status h2 { margin-bottom: 12px; font-size: 1.2em; }
    .status p { color: #888; }
    .spinner {
      display: inline-block;
      width: 24px;
      height: 24px;
      border: 3px solid #333;
      border-top-color: #0af;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-bottom: 16px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .meta {
      margin-top: 12px;
      font-size: 0.85em;
      color: #666;
    }
    .encoding-text {
      margin-top: 10px;
      font-size: 0.8em;
      color: #888;
      font-variant-numeric: tabular-nums;
      text-align: center;
      transition: opacity 0.5s;
    }
  </style>
</head>
<body>
  <div class="container">
    ${isReady ? this.renderCompletedPlayer(hlsUrl, frameCount) : ''}
    ${isEncoding ? this.renderEncodingPlayer(hlsUrl, statusUrl) : ''}
    ${hasFailed ? `
    <div class="status">
      <h2>Encoding failed</h2>
      <p>${frameCount} frames were captured but encoding did not complete.</p>
    </div>
    ` : ''}
    ${noVideo ? `
    <div class="status">
      <h2>No video available</h2>
      <p>This replay does not have a video component.</p>
      <p class="meta"><a href="/replays/${id}/player${tokenParam}" style="color:#0af">View DOM replay instead</a></p>
    </div>
    ` : ''}
    ${!isReady && !isEncoding && !hasFailed && !noVideo ? `
    <div class="status">
      <h2>Video not available</h2>
      <p>Status: ${encodingStatus}</p>
    </div>
    ` : ''}
  </div>
</body>
</html>`;
  }

  private renderCompletedPlayer(hlsUrl: string, frameCount: number): string {
    return `
    <media-controller>
      <hls-video
        slot="media"
        src="${hlsUrl}"
        autoplay
        muted
        playsinline
      ></hls-video>
      <media-control-bar>
        <media-play-button></media-play-button>
        <media-seek-backward-button seekoffset="5"></media-seek-backward-button>
        <media-seek-forward-button seekoffset="5"></media-seek-forward-button>
        <media-mute-button></media-mute-button>
        <media-volume-range></media-volume-range>
        <media-time-range></media-time-range>
        <media-time-display showduration></media-time-display>
        <media-playback-rate-button rates="1 2 4 8"></media-playback-rate-button>
        <media-fullscreen-button></media-fullscreen-button>
      </media-control-bar>
    </media-controller>
    <div class="meta">${frameCount} frames captured</div>
    <script>
    (function() {
      var hlsVideo = document.querySelector('hls-video');
      if (hlsVideo) {
        function setSpeed() {
          var nativeVideo = hlsVideo.shadowRoot
            ? hlsVideo.shadowRoot.querySelector('video')
            : hlsVideo.querySelector('video');
          if (nativeVideo) {
            nativeVideo.playbackRate = 4;
            nativeVideo.play().catch(function(){});
          }
          if (typeof hlsVideo.playbackRate !== 'undefined') {
            hlsVideo.playbackRate = 4;
          }
        }
        customElements.whenDefined('hls-video').then(function() {
          setSpeed();
          hlsVideo.addEventListener('loadedmetadata', setSpeed);
        });
        setTimeout(setSpeed, 500);
        setTimeout(setSpeed, 1500);
      }
    })();
    </script>`;
  }

  private renderEncodingPlayer(hlsUrl: string, statusUrl: string): string {
    return `
    <media-controller>
      <hls-video
        slot="media"
        src="${hlsUrl}"
        muted
        autoplay
        playsinline
      ></hls-video>
      <media-control-bar>
        <media-play-button></media-play-button>
        <media-seek-backward-button seekoffset="5"></media-seek-backward-button>
        <media-seek-forward-button seekoffset="5"></media-seek-forward-button>
        <media-mute-button></media-mute-button>
        <media-volume-range></media-volume-range>
        <media-time-range></media-time-range>
        <media-time-display showduration></media-time-display>
        <media-playback-rate-button rates="1 2 4 8"></media-playback-rate-button>
        <media-fullscreen-button></media-fullscreen-button>
      </media-control-bar>
    </media-controller>
    <div class="encoding-text" id="encoding-text">Starting encoder...</div>
    <script>
    (function() {
      var hlsVideo = document.querySelector('hls-video');
      var statusUrl = '${statusUrl}';
      var text = document.getElementById('encoding-text');
      var polling = true;

      function setSpeed() {
        if (!hlsVideo) return;
        var nativeVideo = hlsVideo.shadowRoot
          ? hlsVideo.shadowRoot.querySelector('video')
          : hlsVideo.querySelector('video');
        if (nativeVideo) {
          nativeVideo.playbackRate = 4;
          nativeVideo.play().catch(function(){});
        }
        if (typeof hlsVideo.playbackRate !== 'undefined') {
          hlsVideo.playbackRate = 4;
        }
      }

      // Playlist is pre-generated — set speed as soon as element is ready
      customElements.whenDefined('hls-video').then(function() {
        setSpeed();
        hlsVideo.addEventListener('loadedmetadata', setSpeed);
      });
      setTimeout(setSpeed, 500);
      setTimeout(setSpeed, 1500);

      async function poll() {
        if (!polling) return;
        try {
          var res = await fetch(statusUrl);
          if (!res.ok) return;
          var data = await res.json();

          if (data.encodingStatus === 'completed' || data.encodingStatus === 'failed') {
            if (data.encodingStatus === 'failed') {
              text.textContent = 'Encoding failed';
              text.style.color = '#f44';
            } else {
              text.style.opacity = '0';
            }
            polling = false;
            return;
          }

          var pct = data.percent || 0;
          var parts = [];
          if (data.framesProcessed > 0 && data.frameCount > 0) {
            parts.push(data.framesProcessed + ' / ' + data.frameCount + ' frames (' + pct + '%)');
          }
          if (data.fps > 0) {
            parts.push(data.fps.toFixed(0) + ' fps');
          }
          if (data.fps > 0 && data.frameCount > 0 && data.framesProcessed > 0) {
            var remaining = data.frameCount - data.framesProcessed;
            var eta = Math.ceil(remaining / data.fps);
            if (eta > 0) {
              parts.push('~' + eta + 's remaining');
            }
          }

          if (parts.length > 0) {
            text.textContent = parts.join(' \\u00b7 ');
          } else if (data.encodingStatus === 'pending') {
            text.textContent = 'Waiting in queue...';
          } else {
            text.textContent = 'Encoding...';
          }
        } catch (e) {
          // Network error, keep polling
        }
        if (polling) setTimeout(poll, 1000);
      }

      poll();
    })();
    </script>`;
  }
}
