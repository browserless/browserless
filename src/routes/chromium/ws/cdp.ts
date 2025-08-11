import {
  default as ChromiumCDPWebSocketRoute,
  QuerySchema as SharedQuerySchema,
} from '../../../shared/chromium.ws.js';

export type QuerySchema = SharedQuerySchema;
export default ChromiumCDPWebSocketRoute;
