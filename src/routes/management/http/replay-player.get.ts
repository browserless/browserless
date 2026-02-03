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

// Bundled Svelte player assets
import { RRWEB_PLAYER_CSS, RRWEB_PLAYER_JS } from '../../../generated/rrweb-player.js';

export interface QuerySchema extends SystemQueryParameters {
  token?: string;
  speed?: string;
  autoplay?: string;
}

export default class ReplayPlayerGetRoute extends HTTPRoute {
  name = BrowserlessRoutes.ReplayPlayerGetRoute;
  accepts = [contentTypes.any];
  auth = true;
  browser = null;
  concurrency = false;
  contentTypes = [contentTypes.html];
  description = `View a session replay in an interactive player.`;
  method = Methods.get;
  path = HTTPManagementRoutes.replayPlayer;
  tags = [APITags.management];

  async handler(req: Request, res: ServerResponse): Promise<void> {
    const replay = this.sessionReplay();
    if (!replay) {
      return writeResponse(res, 503, 'Session replay is not enabled');
    }

    // Extract replay ID from path: /replays/:id/player
    const pathParts = req.parsed.pathname.split('/');
    const playerIndex = pathParts.indexOf('player');
    const id = playerIndex > 0 ? pathParts[playerIndex - 1] : null;

    if (!id) {
      throw new NotFound('Replay ID is required');
    }

    const replayData = await replay.getReplay(id);
    if (!replayData) {
      throw new NotFound(`Replay "${id}" not found`);
    }

    const html = this.generatePlayerHTML(replayData.events, replayData.metadata);

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
    // Use pre-bundled Svelte player assets from build time
    const css = RRWEB_PLAYER_CSS;
    const js = RRWEB_PLAYER_JS;

    // Full replay data for Svelte app
    const replayData = JSON.stringify({ events, metadata });

    // Svelte player HTML - the bundled Svelte app handles all UI rendering
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Session Replay - ${metadata.id}</title>
  <style>
/* CSS from bundled Svelte app (may be empty if styles are inlined) */
${css}

/* Base styles - Svelte components provide their own styles */
* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  height: 100%;
  overflow: hidden;
}
#app {
  height: 100%;
}
  </style>
</head>
<body>
  <div id="app"></div>
  <script>
    // Replay data for Svelte app
    window.__REPLAY_DATA__ = ${replayData};
  </script>
  <script>
${js}
  </script>
</body>
</html>`;
  }
}
