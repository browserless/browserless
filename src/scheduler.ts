import { WORKSPACE_DIR, WORKSPACE_EXPIRE_DAYS } from './config';
import { buildWorkspaceDir, exists, getDebug } from './utils';

const debug = getDebug('cron');
const rimraf = require('rimraf');
const DAILY = 24 * 60 * 60 * 1000;

const intervalIds: NodeJS.Timeout[] = [];

const checkExpiredDownloads = async () => {
  const workspace = await buildWorkspaceDir(WORKSPACE_DIR);

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

checkExpiredDownloads();

intervalIds.push(setInterval(checkExpiredDownloads, DAILY));

export const clearTimers = () => intervalIds.forEach((intervalId) => clearInterval(intervalId));
