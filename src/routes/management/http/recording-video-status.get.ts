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
export default class RecordingVideoStatusGetRoute extends HTTPRoute {
  name = BrowserlessRoutes.RecordingVideoStatusGetRoute;
  accepts = [contentTypes.any];
  auth = true;
  browser = null;
  concurrency = false;
  contentTypes = [contentTypes.json];
  description = `Get video encoding status and progress for a recording.`;
  method = Methods.get;
  path = HTTPManagementRoutes.recordingVideoStatus;
  tags = [APITags.management];

  async handler(req: Request, res: ServerResponse): Promise<void> {
    const replay = this.sessionReplay();
    if (!replay) {
      return jsonResponse(res, 503, { error: 'Session replay is not enabled' });
    }

    // Extract recording ID from path: /recordings/:id/video/status
    const pathParts = req.parsed.pathname.split('/');
    const videoIndex = pathParts.indexOf('video');
    const id = videoIndex > 0 ? pathParts[videoIndex - 1] : null;

    if (!id) {
      throw new NotFound('Recording ID is required');
    }

    const store = replay.getStore();
    if (!store) {
      return jsonResponse(res, 503, { error: 'Recording store not available' });
    }

    const result = store.findById(id);
    if (result.ok && !result.value) {
      throw new NotFound(`Recording "${id}" not found`);
    }
    if (!result.ok) {
      return jsonResponse(res, 500, { error: 'Failed to read recording' });
    }

    const recording = result.value!;
    const encoder = replay.getVideoEncoder();
    const progress = encoder?.getProgress(id) ?? null;

    const response = {
      encodingStatus: progress?.status ?? recording.encodingStatus,
      frameCount: recording.frameCount,
      framesProcessed: progress?.framesProcessed ?? 0,
      fps: progress?.fps ?? 0,
      percent: recording.frameCount > 0 && progress
        ? Math.min(100, Math.round((progress.framesProcessed / recording.frameCount) * 100))
        : 0,
    };

    return jsonResponse(res, 200, response);
  }
}
