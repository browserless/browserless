import { BadRequest } from '../utils.js';

export const validateJavaScriptOptions = (body: {
  setJavaScriptEnabled?: boolean;
  scrollPage?: boolean;
  waitForEvent?: unknown;
}): void => {
  if (body.setJavaScriptEnabled !== false) return;
  if (body.scrollPage === true) {
    throw new BadRequest('scrollPage requires JavaScript to be enabled.');
  }
  if (body.waitForEvent !== undefined) {
    throw new BadRequest('waitForEvent requires JavaScript to be enabled.');
  }
};
