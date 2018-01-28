import { Chrome } from './Chrome';
import {
  connectionTimeout,
  port,
  maxConcurrentSessions,
  maxQueueLength,
} from './config';

new Chrome({
  connectionTimeout,
  port,
  maxConcurrentSessions,
  maxQueueLength,
})
.startServer();
