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
  jsonResponse,
} from '@browserless.io/browserless';
import { ServerResponse } from 'http';

export interface QuerySchema extends SystemQueryParameters {
  token?: string;
}

/**
 * JSON endpoint for real-time encoding progress.
 * Polled by the player page every 1s during encoding.
 *
 * Returns base status from SQLite, overlaid with real-time
 * progress (framesProcessed, fps) from the encoder's in-memory Map.
 */
export default class VideoStatusGetRoute extends HTTPRoute {
  name = BrowserlessRoutes.VideoStatusGetRoute;
  accepts = [contentTypes.any];
  auth = true;
  browser = null;
  concurrency = false;
  contentTypes = [contentTypes.json];
  description = `Get video encoding status and progress for a replay.`;
  method = Methods.get;
  path = HTTPManagementRoutes.videoStatus;
  tags = [APITags.management];

  async handler(req: Request, res: ServerResponse): Promise<void> {
    const replay = this.sessionReplay();
    if (!replay) {
      return jsonResponse(res, 503, { error: 'Session replay is not enabled' });
    }

    // Extract replay ID from path: /video/:id/status
    const pathParts = req.parsed.pathname.split('/');
    const videoIndex = pathParts.indexOf('video');
    const id = videoIndex >= 0 && videoIndex + 1 < pathParts.length
      ? pathParts[videoIndex + 1]
      : null;

    if (!id) {
      throw new NotFound('Replay ID is required');
    }

    const store = replay.getStore();
    if (!store) {
      return jsonResponse(res, 503, { error: 'Replay store not available' });
    }

    const result = store.findById(id);
    if (result.ok && !result.value) {
      throw new NotFound(`Replay "${id}" not found`);
    }
    if (!result.ok) {
      return jsonResponse(res, 500, { error: 'Failed to read replay' });
    }

    const replayRecord = result.value!;
    const encoder = replay.getVideoEncoder();
    const progress = encoder?.getProgress(id) ?? null;

    const response = {
      encodingStatus: progress?.status ?? replayRecord.encodingStatus,
      frameCount: replayRecord.frameCount,
      framesProcessed: progress?.framesProcessed ?? 0,
      fps: progress?.fps ?? 0,
      percent: replayRecord.frameCount > 0 && progress
        ? Math.min(100, Math.round((progress.framesProcessed / replayRecord.frameCount) * 100))
        : 0,
    };

    return jsonResponse(res, 200, response);
  }
}
