import * as path from 'path';

import { WORKSPACE_DELETE_EXPIRED, WORKSPACE_DIR, WORKSPACE_EXPIRE_DAYS } from './config';
import { exists, getDebug, lstat, readdir } from './utils';

const debug = getDebug('scheduler');
const rimraf = require('rimraf');
const DAILY = 24 * 60 * 60 * 1000;

const intervalIds: NodeJS.Timeout[] = [];

const getWorkspaceFiles = async (): Promise<{ created: Date; location: string; name: string }[]> => {
  const files = await readdir(WORKSPACE_DIR);

  return Promise.all(files.map(async (file) => {
    const location = path.join(WORKSPACE_DIR, file);
    const stats = await lstat(location);

    return {
      created: stats.birthtime,
      location,
      name: file,
    };
  }));
};

const checkExpiredDownloads = async () => {
  debug(`Checking workspace for expired files...`);
  const workspace = await getWorkspaceFiles();

  if (workspace) {
    workspace.forEach(async (workspaceItem) => {
      const expireTime = Date.now() - (WORKSPACE_EXPIRE_DAYS * 24 * 60 * 60 * 1000);

      if (workspaceItem.created.getTime() < expireTime) {
        if (await exists(workspaceItem.location)) {
          debug(`Deleting "${workspaceItem.location}" as it's past ${WORKSPACE_EXPIRE_DAYS} days since creation`);
          rimraf(workspaceItem.location, (error: Error) => {
            if (error) {
              debug(`Issue encountered deleting ${workspaceItem.name}: ${error.message}`);
            }
          });
        }
      }
    });
  }
};

// Only cleanup workspace files if this is docker, otherwise
// might delete stuff in /tmp
if (WORKSPACE_DELETE_EXPIRED) {
  checkExpiredDownloads();
  intervalIds.push(setInterval(checkExpiredDownloads, DAILY));
}

export const clearTimers = () => intervalIds.forEach((intervalId) => clearInterval(intervalId));
