// @ts-ignore
window.__is_demo_machine__ = 'chrome.browserless.io' === window.location.host && !window.location.search.includes('?token=');

const characters = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const { port, hostname, protocol } = window.location;
export const baseURL = `${protocol}//${hostname}${port ? `:${port}` : ''}`;

const id = (prepend: string = '') =>
  prepend + Array.from({ length: prepend ? 32 - prepend.length : 32 }, () =>
    characters.charAt(Math.floor(Math.random() * characters.length)),
  ).join('');

export const fetchSessions = (trackingId?: string) => {
  const sessionURL = trackingId ?
    `${baseURL}/sessions?trackindId=${trackingId}` :
    `${baseURL}/sessions`;

  return fetch(sessionURL, {
    credentials: 'same-origin',
    headers: {
      'Accept': 'application/json',
    }
  })
  .then(res => res.json());
}

// devtools://devtools/bundled/devtools_app.html?ws=localhost:3000/devtools/page/piss
export const runSession = async (code: string) => {
  const trackingId = id();

  const body = JSON.stringify({
    code,
    detached: true,
  });

  await fetch(`${baseURL}/function?trackingId=${trackingId}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
    },
    body,
  });

  const sessions = await fetchSessions(trackingId);

  return sessions[0];
};
