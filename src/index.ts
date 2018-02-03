import { Chrome } from './Chrome';
import {
  connectionTimeout,
  port,
  maxConcurrentSessions,
  maxQueueLength,
  rejectAlertURL,
} from './config';

new Chrome({
  connectionTimeout,
  port,
  maxConcurrentSessions,
  maxQueueLength,
  rejectAlertURL,
})
.startServer();
