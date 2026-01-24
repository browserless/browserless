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

// Bundled rrweb-player assets - no require.resolve() needed
import { RRWEB_PLAYER_CSS, RRWEB_PLAYER_JS } from '../../../generated/rrweb-player.js';

export interface QuerySchema extends SystemQueryParameters {
  token?: string;
}

export default class RecordingPlayerGetRoute extends HTTPRoute {
  name = BrowserlessRoutes.RecordingPlayerGetRoute;
  accepts = [contentTypes.any];
  auth = true;
  browser = null;
  concurrency = false;
  contentTypes = [contentTypes.html];
  description = `View a session replay recording in an interactive player.`;
  method = Methods.get;
  path = HTTPManagementRoutes.recordingPlayer;
  tags = [APITags.management];

  async handler(req: Request, res: ServerResponse): Promise<void> {
    const replay = this.sessionReplay();
    if (!replay) {
      return writeResponse(res, 503, 'Session replay is not enabled');
    }

    // Extract recording ID from path: /recordings/:id/player
    const pathParts = req.parsed.pathname.split('/');
    const playerIndex = pathParts.indexOf('player');
    const id = playerIndex > 0 ? pathParts[playerIndex - 1] : null;

    if (!id) {
      throw new NotFound('Recording ID is required');
    }

    const recording = await replay.getRecording(id);
    if (!recording) {
      throw new NotFound(`Recording "${id}" not found`);
    }

    const html = this.generatePlayerHTML(recording.events, recording.metadata);

    res.setHeader('Content-Type', 'text/html');
    res.writeHead(200);
    res.end(html);
  }

  private generatePlayerHTML(events: unknown[], metadata: {
    browserType: string;
    duration: number;
    endedAt: number;
    eventCount: number;
    id: string;
    routePath: string;
    startedAt: number;
    trackingId?: string;
  }): string {
    // Use pre-bundled player assets from build time
    const css = RRWEB_PLAYER_CSS;
    const js = RRWEB_PLAYER_JS;

    const durationSeconds = Math.round(metadata.duration / 1000);
    const startDate = new Date(metadata.startedAt).toISOString();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Session Replay - ${metadata.id}</title>
  <style>
/* rrweb-player CSS (bundled from node_modules) */
${css}

/* Custom styles */
* {
  box-sizing: border-box;
}
body {
  margin: 0;
  padding: 20px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
  background: #1a1a2e;
  color: #eee;
  min-height: 100vh;
}
.header {
  max-width: 1200px;
  margin: 0 auto 20px;
  padding-bottom: 20px;
  border-bottom: 1px solid #333;
}
.header h1 {
  margin: 0 0 10px;
  font-size: 24px;
  color: #fff;
}
.metadata {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  font-size: 14px;
  color: #aaa;
}
.metadata-item {
  display: flex;
  align-items: center;
  gap: 8px;
}
.metadata-label {
  color: #666;
}
.player-container {
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  justify-content: center;
}
.rr-player {
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}
.back-link {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #6c5ce7;
  text-decoration: none;
  margin-bottom: 20px;
  font-size: 14px;
}
.back-link:hover {
  text-decoration: underline;
}
  </style>
</head>
<body>
  <div class="header">
    <a href="/recordings" class="back-link">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M19 12H5M12 19l-7-7 7-7"/>
      </svg>
      Back to Recordings
    </a>
    <h1>Session Replay</h1>
    <div class="metadata">
      <div class="metadata-item">
        <span class="metadata-label">ID:</span>
        <span>${metadata.id}</span>
      </div>
      ${metadata.trackingId ? `
      <div class="metadata-item">
        <span class="metadata-label">Tracking ID:</span>
        <span>${metadata.trackingId}</span>
      </div>
      ` : ''}
      <div class="metadata-item">
        <span class="metadata-label">Browser:</span>
        <span>${metadata.browserType}</span>
      </div>
      <div class="metadata-item">
        <span class="metadata-label">Duration:</span>
        <span>${durationSeconds}s</span>
      </div>
      <div class="metadata-item">
        <span class="metadata-label">Events:</span>
        <span>${metadata.eventCount}</span>
      </div>
      <div class="metadata-item">
        <span class="metadata-label">Started:</span>
        <span>${startDate}</span>
      </div>
      <div class="metadata-item">
        <span class="metadata-label">Route:</span>
        <span>${metadata.routePath}</span>
      </div>
    </div>
  </div>

  <div class="player-container">
    <div id="player"></div>
  </div>

  <script>
// rrweb-player JS (bundled from node_modules)
${js}
  </script>
  <script>
    const events = ${JSON.stringify(events)};

    if (events.length > 0) {
      new rrwebPlayer({
        target: document.getElementById('player'),
        props: {
          events,
          width: 1024,
          height: 576,
          autoPlay: false,
          showController: true,
          speedOption: [0.5, 1, 2, 4, 8],
        },
      });
    } else {
      document.getElementById('player').innerHTML = '<p style="color: #999; text-align: center; padding: 40px;">No events recorded in this session.</p>';
    }
  </script>
</body>
</html>`;
  }
}
