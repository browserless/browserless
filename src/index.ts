import { Chrome } from './Chrome';
import {
  connectionTimeout,
  debugConnectionTimeout,
  port,
  maxConcurrentSessions,
  maxQueueLength,
  logActivity,
} from './config';

new Chrome({
  connectionTimeout,
  debugConnectionTimeout,
  port,
  maxConcurrentSessions,
  maxQueueLength,
  logActivity,
});
