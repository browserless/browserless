import { BadRequest } from '@browserless.io/browserless';

export const validateJavaScriptOptions = (body: {
  setJavaScriptEnabled?: boolean;
  addScriptTag?: { url?: string }[];
  scrollPage?: boolean;
  waitForEvent?: unknown;
  waitForFunction?: unknown;
}): void => {
  if (body.setJavaScriptEnabled !== false) return;
  if (body.addScriptTag?.some(({ url }) => url)) {
    throw new BadRequest(
      'addScriptTag with a URL requires JavaScript to be enabled.',
    );
  }
  if (body.scrollPage === true) {
    throw new BadRequest('scrollPage requires JavaScript to be enabled.');
  }
  if (body.waitForEvent !== undefined) {
    throw new BadRequest('waitForEvent requires JavaScript to be enabled.');
  }
  if (body.waitForFunction !== undefined) {
    throw new BadRequest('waitForFunction requires JavaScript to be enabled.');
  }
};
