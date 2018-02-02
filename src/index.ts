import { Chrome } from './Chrome';
import {
  connectionTimeout,
  port,
  maxConcurrentSessions,
  maxQueueLength,
  prebootChrome,
} from './config';

new Chrome({
  connectionTimeout,
  port,
  maxConcurrentSessions,
  maxQueueLength,
  prebootChrome,
})
.startServer();
