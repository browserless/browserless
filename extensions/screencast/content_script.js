/* eslint-disable no-undef */
/**
 * Simply forwarding messages here back and forth
 * between the background.js script and the page's
 * runtime JavaScript.
 */
window.onload = () => {
  const port = chrome.runtime.connect(chrome.runtime.id);
  port.onMessage.addListener((msg) => {
    window.postMessage(msg, '*');
  });
  window.addEventListener('message', event => {
    if (event.source === window && event.data.type) {
      port.postMessage(event.data);
    }
  });
  document.title = 'browserless-screencast';
};
