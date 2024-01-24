import { CDPJSONPayload, pageID } from '@browserless.io/browserless';

export const getCDPJSONPayload = (externalAddress: string): CDPJSONPayload => {
  const id = pageID();
  const { protocol, host, pathname, href } = new URL(
    `/devtools/page/${id}`,
    externalAddress,
  );

  return {
    description: '',
    devtoolsFrontendUrl: `/devtools/inspector.html?${protocol.replace(':', '')}=${host}${pathname}`,
    id,
    title: 'New Tab',
    type: 'page',
    url: 'about:blank',
    webSocketDebuggerUrl: href,
  };
};
