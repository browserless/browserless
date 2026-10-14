import type {
  CDPSessionEvents,
  Connection,
  PDFOptions,
  Protocol,
} from 'puppeteer-core';
import { CDPSessionEvent } from 'puppeteer-core/internal/api/CDPSession.js';
import type { ChromiumCDP } from '../../browsers/browsers.cdp.js';
import type { Config } from '../../config.js';
import { EventEmitter } from 'node:events';
import type { Logger } from '../../logger.js';
import type { Request } from '../../http.js';
import { Script } from 'node:vm';
import micromatch from 'micromatch';

export interface BQLBrowserAPIOptions {
  browser: ChromiumCDP;
  config: Config;
  logger: Logger;
  req: Request;
  blockConsentModals: boolean;
}
export interface ConsoleEvent {
  type: string;
  text: string;
  args: string[];
  location: {
    url: string | null;
    lineNumber: number | null;
    columnNumber: number | null;
  } | null;
  timestamp: number;
}

export type WaitUntil = string | string[];
export type Operator = 'and' | 'or' | 'AND' | 'OR';
export interface EvaluateOptions {
  content?: string;
  url?: string;
  timeout?: number;
  executionTimeout?: number;
  cdp?: Connection;
}
type Filter = {
  url?: string[];
  regex?: string[];
  method?: string[];
  type?: string[];
  status?: number[];
  operator?: Operator;
};
type ElementArgs = {
  selector: string;
  cdp?: Connection;
  timeout?: number;
  visible?: boolean;
  hidden?: boolean;
  wait?: boolean;
  scroll?: boolean;
  checkInteractable?: boolean;
};
interface SelectorNode {
  id: string;
  class: string[];
  innerHTML: string;
  innerText: string;
  attributes: Record<string, string>;
  attribute(args: { name: string }): {
    name: string;
    value: string | undefined;
  };
  mapSelector(args: ElementArgs): Promise<SelectorNode[]>;
}
interface PageTarget {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl: string;
}
type ReadArgs = Partial<ElementArgs> & {
  clean?: {
    removeNonTextNodes: boolean;
    removeAttributes: boolean;
    removeRegex: boolean;
    regexes: string[];
    selectors: string[];
    attributes?: string[];
    mode?: 'ALLOW' | 'DENY';
  };
  rewrite?: {
    baseURL: string;
    resources: Array<{ url: string; path: string }>;
  };
};
type NetworkRecord = {
  id: string;
  url: string;
  method: string;
  type: string;
  headers: Record<string, string>;
  status?: number;
  loaderId?: string;
  response?: Protocol.Network.Response;
};
export type FetchDecision = {
  method:
    'Fetch.failRequest' | 'Fetch.fulfillRequest' | 'Fetch.continueRequest';
  params?: Record<string, unknown>;
};
export type RequestHandler = (
  event: Protocol.Fetch.RequestPausedEvent,
  cdp: Connection,
) => Promise<FetchDecision | void> | FetchDecision | void;
export type PDFOptionsInput = Omit<
  Protocol.Page.PrintToPDFRequest,
  | 'paperWidth'
  | 'paperHeight'
  | 'marginTop'
  | 'marginBottom'
  | 'marginLeft'
  | 'marginRight'
> & {
  width?: string | number;
  height?: string | number;
  format?: string;
  marginTop?: string | number;
  marginBottom?: string | number;
  marginLeft?: string | number;
  marginRight?: string | number;
  margin?: PDFOptions['margin'];
  fullPage?: boolean;
  waitForFonts?: boolean;
  waitForImages?: boolean;
  timeout?: number;
  omitBackground?: boolean;
  tagged?: boolean;
  outline?: boolean;
};

const glob = (value: string, pattern: string) =>
  micromatch.isMatch(value, pattern, { bash: true });
const matches = (
  r: { url: string; method: string; type: string; status?: number },
  f: Filter,
) => {
  const and = (f.operator ?? 'or').toLowerCase() === 'and';
  const check = <T>(items: T[], predicate: (item: T) => boolean) =>
    and ? items.every(predicate) : items.some(predicate);
  const checks: boolean[] = [];
  if (f.url?.length) checks.push(check(f.url, (p) => glob(r.url, p)));
  if (f.regex?.length)
    checks.push(check(f.regex, (p) => new RegExp(p).test(r.url)));
  if (f.method?.length)
    checks.push(
      check(f.method, (m) => m.toLowerCase() === r.method.toLowerCase()),
    );
  if (f.type?.length)
    checks.push(check(f.type, (t) => t.toLowerCase() === r.type.toLowerCase()));
  if (f.status?.length)
    checks.push(check(f.status, (status) => status === r.status));
  return !checks.length || check(checks, Boolean);
};
const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
const bounded = async <T>(
  promise: Promise<T>,
  timeout: number,
  label: string,
): Promise<T> => {
  if (!timeout) return promise;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeout}ms`)),
          timeout,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

/** Raw CDP primitives. Subclasses add policy through the protected hooks. */
export class BQLBrowserAPI {
  public mainCDP!: Connection;
  public browserCDP!: Connection;
  protected readonly browser: ChromiumCDP;
  protected readonly config: Config;
  protected readonly logger: Logger;
  protected readonly req: Request;
  protected readonly blockConsentModals: boolean;
  protected readonly events = new EventEmitter();
  protected readonly requestPipeline = {
    use: (handler: RequestHandler) => {
      this.handlers.push(handler);
      return () => {
        this.handlers = this.handlers.filter((h) => h !== handler);
      };
    },
  };
  protected inputDriver = {
    move: async (cdp: Connection, x: number, y: number) => {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    },
    click: async (cdp: Connection, x: number, y: number) => {
      await this.inputDriver.move(cdp, x, y);
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x,
        y,
        button: 'left',
        clickCount: 1,
      });
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x,
        y,
        button: 'left',
        clickCount: 1,
      });
    },
    type: async (cdp: Connection, text: string, delay?: [number, number]) => {
      for (const character of text) {
        const special =
          character === '\n' || character === '\r'
            ? {
                key: 'Enter',
                code: 'Enter',
                windowsVirtualKeyCode: 13,
                text: '\r',
              }
            : character === '\t'
              ? { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }
              : { key: character, text: character };
        await cdp.send('Input.dispatchKeyEvent', {
          type: 'keyDown',
          ...special,
        });
        await cdp.send('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: special.key,
          ...(special.code
            ? {
                code: special.code,
                windowsVirtualKeyCode: special.windowsVirtualKeyCode,
              }
            : {}),
        });
        if (delay?.[0]) await pause(delay[0]);
      }
    },
  };
  private timeout = 30_000;
  private closed = false;
  private handlers: RequestHandler[] = [];
  private rules: Array<{ filter: Filter; decision: FetchDecision }> = [];
  private requests = new Map<string, NetworkRecord>();
  private responses = new Map<string, NetworkRecord>();
  private responseOrigins = new Map<
    string,
    { cdp: Connection; pending: boolean; failed: boolean }
  >();
  private inflight = new Set<string>();
  protected pendingRequests = new WeakMap<Connection, Map<string, number>>();
  private clients = new Set<Connection>();
  private cleanup: Array<() => void> = [];
  private userAgentValue?: string;
  private headers: Record<string, string> = {};
  private jsEnabled = true;
  private mediaType = '';
  private starting?: Promise<void>;
  private targetOrder = new Map<string, number>();
  private targetSequence = 0;
  private rejectedDocuments = new Set<Connection>();
  private currentFrames = new WeakMap<Connection, Protocol.Page.Frame>();
  protected consoleCapture = false;
  private httpAuth?: { username: string; password: string; origin?: string };
  private authChallenges = new WeakMap<
    Connection,
    Map<string, { attempted: boolean; networkId?: string }>
  >();

  constructor(options: BQLBrowserAPIOptions) {
    this.browser = options.browser;
    this.config = options.config;
    this.logger = options.logger;
    this.req = options.req;
    this.blockConsentModals = options.blockConsentModals;
    this.events.setMaxListeners(0);
  }

  protected async onStart(
    _mainCDP: Connection,
    _browserCDP: Connection,
  ): Promise<void> {
    void _mainCDP;
    void _browserCDP;
  }
  protected async onTargetAttached(
    _cdp: Connection,
    _kind: string,
  ): Promise<void> {
    void _cdp;
    void _kind;
  }
  protected async beforeNavigate(_url?: string): Promise<void> {
    void _url;
  }
  protected async afterNavigate(_result: unknown): Promise<void> {
    void _result;
  }
  protected async beforeReadback(): Promise<void> {}
  protected async beforeCapture(): Promise<void> {}
  protected async onClose(): Promise<void> {}
  protected async beforeTargetSetup(
    _cdp: Connection,
    _kind: string,
  ): Promise<void> {
    void _cdp;
    void _kind;
  }
  protected async setupRuntime(cdp: Connection): Promise<void> {
    await cdp.send('Runtime.enable');
  }
  protected async beforeRequestRules(
    _event: Protocol.Fetch.RequestPausedEvent,
    _cdp: Connection,
  ): Promise<FetchDecision | void> {
    void _event;
    void _cdp;
  }
  protected async applyUserAgent(
    cdp: Connection,
    userAgent: string,
  ): Promise<void> {
    await cdp.send('Network.setUserAgentOverride', { userAgent });
  }
  protected resolveSelector(selector: string): string {
    if (selector.trimStart().startsWith('<'))
      throw new Error('Deep iframe selectors are not supported');
    return selector;
  }

  protected async connect(url: string): Promise<Connection> {
    const { Connection: RawConnection } = await import('puppeteer-core');
    const { NodeWebSocketTransport } =
      await import('puppeteer-core/internal/node/NodeWebSocketTransport.js');
    const logger = () => undefined;
    const transport = await NodeWebSocketTransport.create(
      url,
      undefined,
      logger,
    );
    const Constructor = RawConnection as unknown as new (
      ...args: unknown[]
    ) => Connection;
    return new Constructor(
      url,
      transport,
      undefined,
      undefined,
      undefined,
      undefined,
      logger,
    );
  }

  public start(): Promise<void> {
    if (this.closed)
      return Promise.reject(new Error('Browser is no longer running'));
    return (this.starting ??= (async () => {
      const endpoint = this.browser.wsEndpoint();
      if (!endpoint) throw new Error('Browser has no CDP endpoint');
      const targets = await this.listPageTargets();
      const page =
        targets.find((t) => !/^(chrome|devtools):/.test(t.url)) ??
        (await this.fetchTarget<PageTarget>('/json/new?about:blank', 'PUT'));
      if (!page?.webSocketDebuggerUrl)
        throw new Error('No available page target');
      this.mainCDP = await this.connect(page.webSocketDebuggerUrl);
      this.browserCDP = await this.connect(endpoint);
      if (this.closed) {
        this.mainCDP.dispose();
        this.browserCDP.dispose();
        throw new Error('Browser is no longer running');
      }
      this.observeDisconnect(this.browserCDP);
      targets
        .filter((t) => t.id !== page.id)
        .sort((a, b) => a.id.localeCompare(b.id))
        .forEach((t) => this.observeTarget(t.id));
      this.observeTarget(page.id);
      const created = (event: Protocol.Target.TargetCreatedEvent) => {
        if (event.targetInfo.type === 'page')
          this.observeTarget(event.targetInfo.targetId);
      };
      const destroyed = (event: Protocol.Target.TargetDestroyedEvent) => {
        this.targetOrder.delete(event.targetId);
      };
      this.browserCDP.on('Target.targetCreated', created);
      this.browserCDP.on('Target.targetDestroyed', destroyed);
      this.cleanup.push(() => {
        this.browserCDP.off('Target.targetCreated', created);
        this.browserCDP.off('Target.targetDestroyed', destroyed);
      });
      await this.browserCDP.send('Target.setDiscoverTargets', {
        discover: true,
      });
      await this.setupTarget(this.mainCDP, 'page');
      if (this.closed) throw new Error('Browser is no longer running');
      await this.onStart(this.mainCDP, this.browserCDP);
    })().catch(async (error: unknown) => {
      await this.close();
      throw error;
    }));
  }

  protected async fetchTarget<T>(path: string, method = 'GET'): Promise<T> {
    const endpoint = this.browser.wsEndpoint();
    if (!endpoint) throw new Error('Browser has no CDP endpoint');
    const base = new URL(endpoint);
    base.protocol = base.protocol === 'wss:' ? 'https:' : 'http:';
    const response = await fetch(new URL(path, base), {
      method,
      signal: AbortSignal.timeout(this.timeout || 30_000),
    });
    if (!response.ok) throw new Error('Unable to query browser targets');
    return response.json();
  }

  protected async setupTarget(cdp: Connection, kind: string): Promise<void> {
    if (this.clients.has(cdp)) return;
    this.clients.add(cdp);
    this.observeDisconnect(cdp);
    await this.beforeTargetSetup(cdp, kind);
    const pending = new Map<string, number>();
    this.pendingRequests.set(cdp, pending);
    const listen = <E extends keyof CDPSessionEvents>(
      event: E,
      handler: (event: CDPSessionEvents[E]) => void,
    ) => {
      cdp.on(event, handler);
      this.cleanup.push(() => cdp.off(event, handler));
    };
    listen(
      'Page.frameNavigated',
      (event: Protocol.Page.FrameNavigatedEvent) => {
        if (!event.frame.parentId) this.currentFrames.set(cdp, event.frame);
      },
    );
    listen(
      'Network.requestWillBeSent',
      (e: Protocol.Network.RequestWillBeSentEvent) => {
        if (cdp !== this.mainCDP) return;
        this.requests.set(e.requestId, {
          id: e.requestId,
          ...e.request,
          type: (e.type ?? '').toLowerCase(),
          loaderId: e.loaderId,
        });
        this.inflight.add(e.requestId);
        pending.set(e.requestId, Date.now());
        this.events.emit('network-change');
        this.events.emit('request', this.requests.get(e.requestId));
      },
    );
    listen(
      'Network.responseReceived',
      (e: Protocol.Network.ResponseReceivedEvent) => {
        if (cdp !== this.mainCDP) return;
        const request = this.requests.get(e.requestId);
        this.responses.set(e.requestId, {
          id: e.requestId,
          url: e.response.url,
          method: request?.method ?? 'GET',
          type: e.type.toLowerCase(),
          headers: e.response.headers,
          status: e.response.status,
          loaderId: e.loaderId,
          response: e.response,
        });
        this.responseOrigins.set(e.requestId, {
          cdp,
          pending: true,
          failed: false,
        });
        if (this.responseOrigins.size > 1000)
          this.responseOrigins.delete(
            this.responseOrigins.keys().next().value!,
          );
        const contentType = Object.entries(e.response.headers ?? {})
          .find(([name]) => name.toLowerCase() === 'content-type')?.[1]
          ?.toLowerCase();
        if (
          e.type === 'EventSource' ||
          e.type === 'WebSocket' ||
          contentType?.startsWith('text/event-stream') ||
          contentType?.startsWith('multipart/x-mixed-replace')
        ) {
          pending.delete(e.requestId);
          this.events.emit('network-change');
        }
        this.events.emit('response', this.responses.get(e.requestId));
      },
    );
    for (const event of [
      'Network.loadingFinished',
      'Network.loadingFailed',
    ] as const)
      listen(event, (e: { requestId: string }) => {
        pending.delete(e.requestId);
        const challenges = this.authChallenges.get(cdp);
        for (const [id, challenge] of challenges ?? []) {
          if (challenge.networkId === e.requestId) challenges!.delete(id);
        }
        const origin = this.responseOrigins.get(e.requestId);
        if (origin?.cdp === cdp) {
          origin.pending = false;
          origin.failed = event === 'Network.loadingFailed';
          this.events.emit('body', e.requestId);
        }
        if (cdp !== this.mainCDP) return;
        this.inflight.delete(e.requestId);
        this.events.emit('network-change');
      });
    listen('Fetch.requestPaused', (e: Protocol.Fetch.RequestPausedEvent) => {
      if (this.httpAuth) {
        let challenges = this.authChallenges.get(cdp);
        if (!challenges) this.authChallenges.set(cdp, (challenges = new Map()));
        challenges.set(e.requestId, {
          attempted: false,
          networkId: e.networkId,
        });
      }
      void this.dispatchFetch(e, cdp).catch((error: unknown) => {
        this.events.emit('failure', error);
        this.logger.error?.('Fetch dispatch failed');
      });
    });
    listen('Fetch.authRequired', (event: Protocol.Fetch.AuthRequiredEvent) => {
      let authChallengeResponse: Protocol.Fetch.AuthChallengeResponse = {
        response: 'Default',
      };
      if (event.authChallenge.source === 'Server' && this.httpAuth) {
        let challenges = this.authChallenges.get(cdp);
        if (!challenges) this.authChallenges.set(cdp, (challenges = new Map()));
        const challenge = challenges.get(event.requestId) ?? {
          attempted: false,
        };
        const allowed =
          !this.httpAuth.origin ||
          event.authChallenge.origin === this.httpAuth.origin;
        authChallengeResponse =
          allowed && !challenge.attempted
            ? {
                response: 'ProvideCredentials',
                username: this.httpAuth.username,
                password: this.httpAuth.password,
              }
            : { response: 'CancelAuth' };
        challenge.attempted = true;
        challenges.set(event.requestId, challenge);
      }
      void cdp
        .send('Fetch.continueWithAuth', {
          requestId: event.requestId,
          authChallengeResponse,
        })
        .catch(() =>
          this.events.emit('failure', new Error('HTTP authentication failed')),
        );
    });
    listen(
      'Runtime.consoleAPICalled',
      (event: Protocol.Runtime.ConsoleAPICalledEvent) => {
        if (!this.consoleCapture || cdp !== this.mainCDP) return;
        const values = event.args.map((arg) =>
          arg.value !== undefined
            ? arg.value
            : (arg.unserializableValue ?? arg.description ?? arg.type),
        );
        const frame = event.stackTrace?.callFrames[0];
        this.events.emit('console', {
          type: event.type,
          text: values
            .map((value) =>
              typeof value === 'string' ? value : JSON.stringify(value),
            )
            .join(' '),
          args: values.map((value) => JSON.stringify(value)),
          location: frame
            ? {
                url: frame.url || null,
                lineNumber: frame.lineNumber,
                columnNumber: frame.columnNumber,
              }
            : null,
          timestamp: Date.now(),
        } satisfies ConsoleEvent);
      },
    );
    listen(
      'Runtime.exceptionThrown',
      (event: Protocol.Runtime.ExceptionThrownEvent) => {
        if (!this.consoleCapture || cdp !== this.mainCDP) return;
        const details = event.exceptionDetails;
        const text = details.exception?.description ?? details.text;
        this.events.emit('console', {
          type: 'error',
          text,
          args: [JSON.stringify(text)],
          location: {
            url: details.url || null,
            lineNumber: details.lineNumber,
            columnNumber: details.columnNumber,
          },
          timestamp: Date.now(),
        } satisfies ConsoleEvent);
      },
    );
    await cdp.send('Page.enable');
    const { frameTree } = await cdp.send('Page.getFrameTree');
    if (frameTree) this.currentFrames.set(cdp, frameTree.frame);
    await this.setupRuntime(cdp);
    await cdp.send('Network.enable');
    await cdp.send('Page.setLifecycleEventsEnabled', { enabled: true });
    await cdp.send('Fetch.enable', {
      patterns: [{ urlPattern: '*', requestStage: 'Request' }],
      handleAuthRequests: !!this.httpAuth,
    });
    await cdp.send('Network.setExtraHTTPHeaders', { headers: this.headers });
    await cdp.send('Emulation.setScriptExecutionDisabled', {
      value: !this.jsEnabled,
    });
    if (this.userAgentValue)
      await this.applyUserAgent(cdp, this.userAgentValue);
    if (this.mediaType)
      await cdp.send('Emulation.setEmulatedMedia', { media: this.mediaType });
    await this.onTargetAttached(cdp, kind);
  }

  public async ensureConsoleCapture(): Promise<void> {
    if (this.consoleCapture) return;
    await this.mainCDP.send('Runtime.enable');
    this.consoleCapture = true;
  }

  /** Bounded event stream; cancellation also wakes a pending next(). */
  public streamEvents<T = unknown>(event: string): AsyncGenerator<T> {
    const buffer: T[] = [];
    let ended = this.closed;
    let wake: (() => void) | undefined;
    const data = (value: T) => {
      if (ended) return;
      if (buffer.length === 1000) buffer.shift();
      buffer.push(value);
      wake?.();
      wake = undefined;
    };
    const end = () => {
      ended = true;
      buffer.length = 0;
      this.events.off(event, data);
      this.events.off('close', end);
      wake?.();
      wake = undefined;
    };
    if (!ended) {
      this.events.on(event, data);
      this.events.once('close', end);
    }
    const iterator = (async function* () {
      try {
        while (!ended) {
          if (buffer.length) yield buffer.shift()!;
          else
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
        }
      } finally {
        end();
      }
    })();
    const finish = iterator.return.bind(iterator);
    iterator.return = (value) => {
      end();
      return finish(value);
    };
    return iterator;
  }

  protected async assertNavigationAllowed(url: string): Promise<void> {
    if (!this.config.getBlockedURLPatterns) return;
    const { findBlockedNavigationUrl } =
      await import('../../network-security.js');
    if (
      findBlockedNavigationUrl(
        url,
        this.config.getBlockedURLPatterns(),
        this.config.getBlockedNetworkRanges(),
        this.config.getSelfNavigationHosts(),
      )
    )
      throw new Error('Navigation is blocked');
  }

  private async dispatchFetch(
    event: Protocol.Fetch.RequestPausedEvent,
    cdp: Connection,
  ): Promise<void> {
    let decision: FetchDecision | undefined;
    try {
      await this.assertNavigationAllowed(event.request.url);
    } catch {
      decision = {
        method: 'Fetch.failRequest',
        params: { errorReason: 'BlockedByClient' },
      };
    }
    if (!decision) {
      try {
        decision = (await this.beforeRequestRules(event, cdp)) || undefined;
      } catch (error) {
        decision = {
          method: 'Fetch.failRequest',
          params: { errorReason: 'Failed' },
        };
        this.events.emit('failure', error);
      }
    }
    const matchingRules = this.rules.filter((r) =>
      matches({ ...event.request, type: event.resourceType }, r.filter),
    );
    decision ??=
      matchingRules.find((r) => r.decision.method === 'Fetch.failRequest')
        ?.decision ?? matchingRules[0]?.decision;
    if (!decision)
      for (const handler of this.handlers) {
        try {
          decision = (await handler(event, cdp)) || undefined;
        } catch (error) {
          decision = {
            method: 'Fetch.failRequest',
            params: { errorReason: 'Failed' },
          };
          this.events.emit('failure', error);
        }
        if (decision) break;
      }
    decision ??= { method: 'Fetch.continueRequest' };
    const intentionalDocumentReject =
      event.resourceType === 'Document' &&
      decision.method === 'Fetch.failRequest' &&
      decision.params?.errorReason === 'Aborted' &&
      (!this.currentFrames.has(cdp) ||
        this.currentFrames.get(cdp)?.id === event.frameId);
    if (intentionalDocumentReject) this.rejectedDocuments.add(cdp);
    await cdp.send(decision.method, {
      ...decision.params,
      requestId: event.requestId,
    });
    if (intentionalDocumentReject)
      this.events.emit('document-rejected', cdp, event.request.url);
  }

  public preferences({ timeout }: { timeout?: number }) {
    if (timeout !== undefined) {
      if (!Number.isFinite(timeout) || timeout < 0)
        throw new Error('Invalid timeout');
      this.timeout = timeout;
    }
    return { timeout: this.timeout };
  }

  public async evaluate(args: EvaluateOptions) {
    await this.beforeReadback();
    return this.evaluateInternal(args);
  }

  protected async evaluateInternal({
    content,
    url,
    timeout = 10_000,
    executionTimeout = 0,
    cdp = this.mainCDP,
    // Runtime.evaluate returns caller-defined JSON, not a fixed browser schema.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }: EvaluateOptions): Promise<{ value: any; time: number }> {
    if ((content === undefined) === (url === undefined))
      throw new Error('Exactly one of "content" or "url" is required');
    if (url) content = await this.fetchScript(url, timeout);
    const start = Date.now();
    const body = content!.trim();
    const expression = body.replace(/\s*;+\s*$/, '');
    let isExpression = false;
    try {
      new Script(`(async() => (${expression}))`);
      isExpression = true;
    } catch {}
    const result = await bounded(
      cdp.send('Runtime.evaluate', {
        expression: `(async() => { ${isExpression ? `return (${expression});` : body} })()`,
        returnByValue: true,
        awaitPromise: true,
        ...(executionTimeout > 0 ? { timeout: executionTimeout } : {}),
      }),
      timeout,
      'evaluate',
    );
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text,
      );
    const remote = result.result;
    const value = remote.unserializableValue
      ? ((
          { NaN, Infinity, '-Infinity': -Infinity, '-0': -0 } as Record<
            string,
            unknown
          >
        )[remote.unserializableValue] ?? remote.unserializableValue)
      : remote.value;
    return { value, time: Date.now() - start };
  }
  public url() {
    return this.evaluate({ content: 'location.href' });
  }
  public title() {
    return this.evaluate({ content: 'document.title' });
  }

  protected async fetchScript(url: string, timeout: number): Promise<string> {
    const signal = AbortSignal.timeout(timeout || 30_000);
    for (let hops = 0; ; hops++) {
      await this.assertNavigationAllowed(url);
      const response: Response = await fetch(url, {
        signal,
        redirect: 'manual',
      });
      if (
        response.status >= 300 &&
        response.status < 400 &&
        response.headers.has('location')
      ) {
        if (hops >= 20) throw new Error('Too many script redirects');
        url = new URL(response.headers.get('location')!, url).href;
        continue;
      }
      if (!response.ok) throw new Error('Error getting script from URL');
      return response.text();
    }
  }

  protected selectorExpression(selector: string, root = 'document'): string {
    selector = this.resolveSelector(selector);
    return `((root) => {
      const result = [];
      const visit = (scope) => {
        result.push(...scope.querySelectorAll(${JSON.stringify(selector)}));
        for (const el of scope.querySelectorAll('*')) if (el.shadowRoot) visit(el.shadowRoot);
      };
      try {
        if (root) visit(root);
      } catch (error) {
        if (error.name !== 'SyntaxError') throw error;
        const selected = (0, eval)(${JSON.stringify(selector)});
        return selected == null ? [] : selected instanceof Element ? [selected] : Array.from(selected);
      }
      return result;
    })(${root})`;
  }
  public async querySelectorAll({
    selector,
    cdp = this.mainCDP,
    timeout,
  }: ElementArgs) {
    const query = this.selectorExpression(selector);
    const { value } = await this.evaluate({
      cdp,
      timeout,
      content: `${query}.map(el => ({ id: el.id, childElementCount: el.childElementCount, className: el.className, innerHTML: el.innerHTML, innerText: el.innerText, localName: el.localName, outerHTML: el.outerHTML }))`,
    });
    return value?.length ? value : null;
  }
  public async querySelector(args: ElementArgs) {
    return (await this.querySelectorAll(args))?.[0] ?? null;
  }
  public async mapSelector({
    selector,
    cdp = this.mainCDP,
    timeout,
    wait,
    parent,
    parentIdx,
  }: ElementArgs & { parent?: string; parentIdx?: number }): Promise<
    SelectorNode[]
  > {
    await this.waitForSelector({
      selector: parent ?? selector,
      cdp,
      timeout: wait ? timeout : 100,
      visible: false,
    });
    const root =
      parent === undefined
        ? 'document'
        : `${this.selectorExpression(parent)}[${parentIdx ?? 0}]`;
    const { value } = await this.evaluate({
      cdp,
      content: `${this.selectorExpression(selector, root)}.map(el => ({ id: el.id, class: [...el.classList], innerHTML: el.innerHTML, innerText: el.innerText, attributes: Object.fromEntries([...el.attributes].map(a => [a.name,a.value])) }))`,
    });
    return (value ?? []).map((node: SelectorNode, index: number) => ({
      ...node,
      attribute: ({ name }: { name: string }) => ({
        name,
        value: node.attributes[name],
      }),
      mapSelector: (args: ElementArgs) =>
        this.mapSelector({ ...args, cdp, parent: selector, parentIdx: index }),
    }));
  }
  public async waitForSelector({
    selector,
    cdp = this.mainCDP,
    timeout = this.timeout,
    visible,
    hidden,
    checkInteractable,
  }: ElementArgs) {
    const query = this.selectorExpression(selector);
    const start = Date.now();
    do {
      const { value } = await this.evaluateInternal({
        cdp,
        timeout: timeout ? Math.max(1, timeout - (Date.now() - start)) : 0,
        content: `(() => {
        const el = ${query}[0];
        if (!el) return ${hidden ? '{ x:0,y:0,width:0,height:0 }' : 'null'};
        const r = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        const shown = !!(r.width && r.height && style.visibility !== 'hidden' && style.display !== 'none');
        if (${!!hidden}) return shown ? null : {x:0,y:0,width:0,height:0};
        if (${!!visible} && !shown) return null;
        if (${!!checkInteractable} && (el.disabled || style.pointerEvents === 'none')) return null;
        return {x:r.x,y:r.y,width:r.width,height:r.height};
      })()`,
      });
      if (value) return { ...value, cdp };
      if (this.closed) throw new Error('Browser is no longer running');
      await pause(50);
    } while (!timeout || Date.now() - start < timeout);
    throw new Error(`waitForSelector timed out after ${timeout}ms`);
  }
  public async getBoundingClientRect(args: ElementArgs) {
    if (this.closed) return null;
    const cdp = args.cdp ?? this.mainCDP;
    const { value } = await this.evaluateInternal({
      cdp,
      timeout: args.timeout,
      content: `(() => {
      const el = ${this.selectorExpression(args.selector)}[0];
      if (!el) return null;
      const r = el.getBoundingClientRect(); const style = getComputedStyle(el);
      if (${!!args.visible} && (!r.width || !r.height || style.visibility === 'hidden' || style.display === 'none')) return null;
      return {x:r.x,y:r.y,width:r.width,height:r.height};
    })()`,
    });
    return value ? { ...value, cdp } : null;
  }
  public async click(
    args: Partial<ElementArgs> & { x?: number; y?: number } = {},
  ) {
    const start = Date.now();
    let cdp = args.cdp ?? this.mainCDP;
    let { x, y } = args;
    if (args.selector) {
      if (args.scroll) await this.scroll({ ...args, selector: args.selector });
      const rect = await this.waitForSelector({
        ...args,
        selector: args.selector,
        cdp,
        timeout: args.wait ? args.timeout : 100,
      });
      x = rect.x + rect.width / 2;
      y = rect.y + rect.height / 2;
      cdp = rect.cdp;
    }
    if (!Number.isFinite(x) || !Number.isFinite(y))
      throw new Error('click requires a selector or x and y');
    await this.inputDriver.click(cdp, x!, y!);
    return { cdp, selector: args.selector, x, y, time: Date.now() - start };
  }
  public async hover(args: Partial<ElementArgs> & { x?: number; y?: number }) {
    const start = Date.now();
    let cdp = args.cdp ?? this.mainCDP;
    let { x, y } = args;
    if (args.selector) {
      if (args.scroll) await this.scroll({ ...args, selector: args.selector });
      const rect = await this.waitForSelector({
        ...args,
        selector: args.selector,
        cdp,
        timeout: args.wait ? args.timeout : 100,
      });
      x = rect.x + rect.width / 2;
      y = rect.y + rect.height / 2;
      cdp = rect.cdp;
    }
    if (!Number.isFinite(x) || !Number.isFinite(y))
      throw new Error('hover requires a selector or x and y');
    await this.inputDriver.move(cdp, x!, y!);
    return { cdp, selector: args.selector, x, y, time: Date.now() - start };
  }
  public async type(
    args: ElementArgs & {
      text: string;
      delay?: [number, number];
      interactable?: boolean;
    },
  ) {
    const start = Date.now();
    const result = await this.click({
      ...args,
      checkInteractable: args.interactable ?? true,
    });
    await this.inputDriver.type(result.cdp, args.text, args.delay);
    return { ...result, text: args.text, time: Date.now() - start };
  }
  public async checkbox(args: ElementArgs & { checked: boolean }) {
    const start = Date.now();
    await this.waitForSelector({
      ...args,
      timeout: args.wait ? args.timeout : 100,
    });
    const { value: checked } = await this.evaluateInternal({
      cdp: args.cdp,
      content: `(() => { const el = ${this.selectorExpression(args.selector)}[0]; if (!el || el.type !== 'checkbox') throw new Error('Element is not a checkbox'); return el.checked; })()`,
    });
    const result =
      checked === args.checked
        ? { selector: args.selector }
        : await this.click(args);
    return { ...result, time: Date.now() - start };
  }
  public async select(args: ElementArgs & { value: string | string[] }) {
    const start = Date.now();
    await this.waitForSelector({
      ...args,
      timeout: args.wait ? args.timeout : 100,
    });
    if (args.scroll) await this.scroll(args);
    const values = Array.isArray(args.value) ? args.value : [args.value];
    const cdp = args.cdp ?? this.mainCDP;
    const { value } = await this.evaluateInternal({
      cdp,
      content: `(() => {
      const el = ${this.selectorExpression(args.selector)}[0];
      if (!(el instanceof HTMLSelectElement)) throw new Error('Element is not a select');
      const values = new Set(${JSON.stringify(values)}); let chosen = false;
      for (const option of el.options) { const selected = values.has(option.value) && (el.multiple || !chosen); option.selected = selected; if (selected) chosen = true; }
      if (!chosen) el.selectedIndex = -1;
      el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true}));
      return [...el.selectedOptions].map(o => o.value);
    })()`,
    });
    return { cdp, selector: args.selector, value, time: Date.now() - start };
  }
  public async scroll(
    args: Partial<ElementArgs> & {
      x?: number;
      y?: number;
      throughPage?: boolean;
    },
  ) {
    const start = Date.now();
    const cdp = args.cdp ?? this.mainCDP;
    if (
      args.throughPage &&
      (args.selector || args.x !== undefined || args.y !== undefined)
    )
      throw new Error(
        'throughPage cannot be combined with coordinates or selector',
      );
    if (
      !args.throughPage &&
      !args.selector &&
      args.x === undefined &&
      args.y === undefined
    )
      throw new Error('scroll requires coordinates or selector');
    if (args.selector)
      await this.waitForSelector({
        ...args,
        selector: args.selector,
        timeout: args.wait ? args.timeout : 100,
      });
    await this.evaluateInternal({
      cdp,
      timeout: args.timeout,
      content: args.selector
        ? `${this.selectorExpression(args.selector)}[0].scrollIntoView({block:'center',inline:'center'})`
        : args.throughPage
          ? `(async() => { for (let y=0; y < document.documentElement.scrollHeight; y += innerHeight) { window.scrollTo(0,y); await new Promise(r => setTimeout(r,50)); } })()`
          : `window.scrollBy(${args.x ?? 0},${args.y ?? 0})`,
    });
    return {
      cdp,
      x: args.x,
      y: args.y,
      selector: args.selector,
      time: Date.now() - start,
    };
  }

  private async read(args: ReadArgs, mode: 'html' | 'text'): Promise<string> {
    const selector = args.selector ?? 'html';
    const query = this.selectorExpression(selector);
    await this.waitForSelector({ ...args, selector });
    const { value } = await this.evaluate({
      cdp: args.cdp,
      timeout: args.timeout,
      content: `(() => {
      const root = ${mode === 'html' && !args.selector ? 'document' : `${query}[0]`};
      const clean = ${JSON.stringify(args.clean ?? null)};
      if (clean?.removeNonTextNodes) for (const sel of clean.selectors) for (const el of document.querySelectorAll(sel)) el.remove();
      if (clean?.removeAttributes) for (const el of document.querySelectorAll('*')) for (const attr of [...el.attributes]) {
        const listed = clean.attributes?.includes(attr.name) ?? false;
        if (!clean.attributes || (clean.mode === 'ALLOW' ? !listed : listed)) el.removeAttribute(attr.name);
      }
      const rewrite = ${JSON.stringify(args.rewrite ?? null)};
      if (rewrite) for (const el of document.querySelectorAll('[src],[href]')) for (const name of ['src','href']) {
        const raw = el.getAttribute(name); if (!raw) continue;
        const url = new URL(raw,rewrite.baseURL).href;
        const resource = rewrite.resources.find(r => r.url === url);
        if (resource) el.setAttribute(name,resource.path);
      }
      return ${mode === 'html' ? "[...root.childNodes].map(node => node === document.documentElement ? node.outerHTML : new XMLSerializer().serializeToString(node)).join('')" : "root.innerText ?? root.textContent ?? ''"};
    })()`,
    });
    return args.clean?.removeRegex
      ? args.clean.regexes.reduce(
          (text, regex) => text.replace(new RegExp(regex, 'gi'), ' '),
          value as string,
        )
      : value;
  }
  public async html(args: ReadArgs = {}) {
    const start = Date.now();
    return { html: await this.read(args, 'html'), time: Date.now() - start };
  }
  public async text(args: ReadArgs = {}) {
    const start = Date.now();
    return { text: await this.read(args, 'text'), time: Date.now() - start };
  }
  public async markdown(args: ReadArgs = {}) {
    const start = Date.now();
    const selector = args.selector ?? 'html';
    await this.waitForSelector({ ...args, selector });
    const { value } = await this.evaluate({
      cdp: args.cdp,
      timeout: args.timeout,
      content: `(() => {
      const render = node => {
        if (node.nodeType === 3) return node.textContent;
        if (node.nodeType !== 1 || ['SCRIPT','STYLE','NOSCRIPT'].includes(node.tagName)) return '';
        const text = [...node.childNodes].map(render).join('');
        const tag = node.tagName;
        if (/^H[1-6]$/.test(tag)) return '\\n' + '#'.repeat(Number(tag[1])) + ' ' + text.trim() + '\\n\\n';
        if (tag === 'A') return '[' + text + '](' + node.href + ')';
        if (tag === 'IMG') return '![' + node.alt + '](' + node.src + ')';
        if (tag === 'STRONG' || tag === 'B') return '**' + text + '**';
        if (tag === 'EM' || tag === 'I') return '*' + text + '*';
        if (tag === 'LI') return '- ' + text.trim() + '\\n';
        if (tag === 'BR') return '\\n';
        return ['P','DIV','SECTION','UL','OL','PRE','BLOCKQUOTE'].includes(tag) ? '\\n' + text + '\\n' : text;
      };
      return render(${this.selectorExpression(selector)}[0]).replace(/\\n{3,}/g,'\\n\\n').trim();
    })()`,
    });
    return { markdown: value as string, time: Date.now() - start };
  }

  public waitForNavigation(
    waitUntil: WaitUntil = 'load',
    timeout = this.timeout,
    cdp = this.mainCDP,
  ): Promise<{
    ip: string | null;
    port: number | null;
    url: string | null;
    text: string | null;
    status: number | null;
    time: number;
    rejected?: boolean;
  }> {
    return this.waitForDocument(waitUntil, timeout, cdp);
  }
  protected waitForDocument(
    waitUntil: WaitUntil,
    timeout: number,
    cdp: Connection,
    documentOpen = false,
  ): ReturnType<BQLBrowserAPI['waitForNavigation']> {
    const start = Date.now();
    const waits = (Array.isArray(waitUntil) ? waitUntil : [waitUntil]).map(
      (w) => w.toLowerCase(),
    );
    return new Promise((resolve, reject) => {
      if (this.closed) {
        reject(new Error('Browser is no longer running'));
        return;
      }
      let frame: Protocol.Page.Frame | undefined;
      let opened = !documentOpen;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let graceTimer: ReturnType<typeof setTimeout> | undefined;
      let quietTimer: ReturnType<typeof setTimeout> | undefined;
      let graceLoader: string | undefined;
      let relaxed = false;
      let settled = false;
      const seen = new Map<string, Set<string>>();
      const documents = new Map<string, Protocol.Network.Response>();
      const cleanup = () => {
        clearTimeout(timer);
        clearTimeout(graceTimer);
        clearTimeout(quietTimer);
        cdp.off('Network.dataReceived', progress);
        cdp.off('Network.loadingFinished', progress);
        cdp.off('Network.loadingFailed', progress);
        this.events.off('network-change', progress);
        cdp.off('Page.frameNavigated', navigated);
        cdp.off('Page.lifecycleEvent', lifecycle);
        cdp.off('Page.navigatedWithinDocument', sameDocument);
        cdp.off('Network.responseReceived', response);
        this.events.off('close', closed);
        this.events.off('failure', failed);
        this.events.off('document-rejected', documentRejected);
      };
      const failed = (error: unknown) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const closed = () => failed(new Error('Browser is no longer running'));
      const finish = (url: string, loader?: string) => {
        if (settled) return;
        settled = true;
        cleanup();
        const r = loader ? documents.get(loader) : undefined;
        const rejected =
          this.rejectedDocuments.has(cdp) ||
          this.rules.some(
            (rule) =>
              rule.decision.method === 'Fetch.failRequest' &&
              matches({ url, method: 'GET', type: 'Document' }, rule.filter),
          );
        const error = rejected || url.startsWith('chrome-error:');
        resolve({
          ip: error ? null : (r?.remoteIPAddress ?? null),
          port: error ? null : (r?.remotePort ?? null),
          url,
          text: error ? null : (r?.statusText ?? 'ok'),
          status: error ? null : (r?.status ?? 200),
          time: Date.now() - start,
          rejected,
        });
      };
      const check = () => {
        if (settled || !frame || !opened) return;
        const events = seen.get(frame.loaderId) ?? new Set<string>();
        if (graceLoader !== frame.loaderId) {
          clearTimeout(graceTimer);
          clearTimeout(quietTimer);
          graceLoader = undefined;
          relaxed = false;
        }
        if (
          !graceLoader &&
          waits.some((w) => w === 'networkidle' || w === 'networkidle0') &&
          events.has('networkalmostidle')
        ) {
          graceLoader = frame.loaderId;
          const settle = () => {
            relaxed = true;
            check();
          };
          graceTimer = setTimeout(
            settle,
            Math.min(
              30_000,
              timeout
                ? Math.max(0, timeout - (Date.now() - start)) / 2
                : 30_000,
            ),
          );
          progress();
        }
        if (
          waits.every(
            (w) =>
              w === 'commit' ||
              ((w === 'networkidle' || w === 'networkidle0') &&
                relaxed &&
                events.has('networkalmostidle')) ||
              events.has(
                w === 'networkidle0'
                  ? 'networkidle'
                  : w === 'networkidle2'
                    ? 'networkalmostidle'
                    : w,
              ),
          )
        )
          finish(frame.url, frame.loaderId);
      };
      const progress = () => {
        if (settled) return;
        clearTimeout(quietTimer);
        if (graceLoader && !this.pendingRequests.get(cdp)?.size) {
          quietTimer = setTimeout(() => {
            relaxed = true;
            check();
          }, 1000);
        }
      };
      const navigated = (e: Protocol.Page.FrameNavigatedEvent) => {
        if (!e.frame.parentId && opened) {
          frame = e.frame;
          if (e.type === 'BackForwardCacheRestore') {
            seen.set(
              frame.loaderId,
              new Set([
                'load',
                'domcontentloaded',
                'networkidle',
                'networkalmostidle',
                'firstmeaningfulpaint',
                'firstcontentfulpaint',
                'interactivetime',
              ]),
            );
          }
          check();
        }
      };
      const lifecycle = (e: Protocol.Page.LifecycleEventEvent) => {
        if (
          e.frameId !== (frame ?? this.currentFrames.get(cdp))?.id &&
          (frame || this.currentFrames.has(cdp))
        )
          return;
        if (documentOpen && e.name === 'init') {
          const current = this.currentFrames.get(cdp);
          if (!current) return;
          frame = { ...current, loaderId: e.loaderId };
          opened = true;
          seen.delete(e.loaderId);
        }
        const events = seen.get(e.loaderId) ?? new Set<string>();
        events.add(e.name.toLowerCase().replace('candidate', ''));
        seen.set(e.loaderId, events);
        check();
      };
      const response = (e: Protocol.Network.ResponseReceivedEvent) => {
        if (e.type !== 'Document') return;
        documents.set(e.loaderId, e.response);
        const contentType =
          e.response.mimeType ??
          Object.entries(e.response.headers ?? {}).find(
            ([name]) => name.toLowerCase() === 'content-type',
          )?.[1];
        if (
          e.frameId === (frame ?? this.currentFrames.get(cdp))?.id &&
          contentType?.toLowerCase().includes('application/pdf')
        ) {
          finish(e.response.url, e.loaderId);
        }
      };
      const sameDocument = (e: Protocol.Page.NavigatedWithinDocumentEvent) => {
        if (
          !documentOpen &&
          e.frameId === (frame ?? this.currentFrames.get(cdp))?.id
        )
          finish(e.url);
      };
      const documentRejected = (target: Connection, url: string) => {
        if (target === cdp) finish(url);
      };
      cdp.on('Page.frameNavigated', navigated);
      cdp.on('Page.lifecycleEvent', lifecycle);
      cdp.on('Page.navigatedWithinDocument', sameDocument);
      cdp.on('Network.responseReceived', response);
      cdp.on('Network.dataReceived', progress);
      cdp.on('Network.loadingFinished', progress);
      cdp.on('Network.loadingFailed', progress);
      this.events.on('network-change', progress);
      this.events.once('close', closed);
      this.events.once('failure', failed);
      this.events.on('document-rejected', documentRejected);
      if (timeout)
        timer = setTimeout(
          () => failed(new Error(`Navigation timed out after ${timeout}ms`)),
          timeout,
        );
    });
  }
  private resetNetwork() {
    this.requests.clear();
    this.responses.clear();
    this.inflight.clear();
    this.pendingRequests.get(this.mainCDP)?.clear();
    this.rejectedDocuments.clear();
    this.events.emit('network-change');
  }
  private async navigate(
    command: 'Page.navigate' | 'Page.reload' | 'Page.navigateToHistoryEntry',
    params:
      | Protocol.Page.NavigateRequest
      | Protocol.Page.ReloadRequest
      | Protocol.Page.NavigateToHistoryEntryRequest,
    args: { waitUntil?: WaitUntil; timeout?: number },
    url?: string,
  ) {
    if (this.closed) throw new Error('Browser is no longer running');
    if (url) await this.assertNavigationAllowed(url);
    await this.beforeNavigate(url);
    this.resetNetwork();
    const waiting = this.waitForNavigation(args.waitUntil, args.timeout);
    const sent = this.mainCDP
      .send(command, params)
      .then((r) => {
        if (!r || !('errorText' in r) || !r.errorText) return false;
        const intentional =
          this.rejectedDocuments.has(this.mainCDP) ||
          (!!url &&
            this.rules.some(
              (rule) =>
                rule.decision.method === 'Fetch.failRequest' &&
                matches({ url, method: 'GET', type: 'Document' }, rule.filter),
            ));
        if (!intentional) throw new Error(r.errorText);
        return true;
      })
      .catch((error: unknown) => {
        this.events.emit('failure', error);
        throw error;
      });
    const [result, intentional] = await Promise.all([waiting, sent]);
    if (intentional)
      Object.assign(result, {
        rejected: true,
        status: null,
        text: null,
        ip: null,
        port: null,
      });
    await this.afterNavigate(result);
    return result;
  }
  public goto({
    url,
    referer,
    referrerPolicy,
    ...args
  }: {
    url: string;
    waitUntil?: WaitUntil;
    timeout?: number;
    referer?: string;
    referrerPolicy?: string;
  }) {
    return this.navigate(
      'Page.navigate',
      {
        url,
        referrer: referer,
        ...(referrerPolicy
          ? {
              referrerPolicy: referrerPolicy.replace(/-./g, (m) =>
                m[1].toUpperCase(),
              ) as Protocol.Page.ReferrerPolicy,
            }
          : {}),
      },
      args,
      url,
    );
  }
  public reload(args: { waitUntil?: WaitUntil; timeout?: number }) {
    return this.navigate('Page.reload', {}, args);
  }
  private async history(
    delta: number,
    args: { waitUntil?: WaitUntil; timeout?: number },
  ) {
    const history = await this.mainCDP.send('Page.getNavigationHistory');
    const entry = history.entries[history.currentIndex + delta];
    return entry
      ? this.navigate(
          'Page.navigateToHistoryEntry',
          { entryId: entry.id },
          args,
          entry.url,
        )
      : null;
  }
  public back(args: { waitUntil?: WaitUntil; timeout?: number }) {
    return this.history(-1, args);
  }
  public forward(args: { waitUntil?: WaitUntil; timeout?: number }) {
    return this.history(1, args);
  }
  public async content({
    html,
    cdp = this.mainCDP,
    timeout = this.timeout,
    waitUntil = 'load',
  }: {
    html: string;
    cdp?: Connection;
    timeout?: number;
    waitUntil?: WaitUntil;
  }) {
    const start = Date.now();
    await this.beforeNavigate();
    const { frameTree } = await cdp.send('Page.getFrameTree');
    this.currentFrames.set(cdp, frameTree.frame);
    this.resetNetwork();
    const waiting = this.waitForDocument(waitUntil, timeout, cdp, true);
    const set = cdp
      .send('Page.setDocumentContent', { frameId: frameTree.frame.id, html })
      .catch((error: unknown) => {
        this.events.emit('failure', error);
        throw error;
      });
    await Promise.all([waiting, set]);
    const { value: url } = await this.evaluateInternal({
      cdp,
      content: 'location.href',
    });
    const result = { url, status: 200, time: Date.now() - start };
    await this.afterNavigate(result);
    return result;
  }

  public async cookies({
    cookies,
    cdp = this.mainCDP,
  }: {
    cookies?: Array<
      Omit<Protocol.Network.CookieParam, 'partitionKey'> & {
        partitionKey?: { sourceOrigin: string; hasCrossSiteAncestor?: boolean };
      }
    >;
    cdp?: Connection;
  } = {}) {
    const start = Date.now();
    const { value: location } = await this.evaluate({
      cdp,
      content:
        '({url:location.href,domain:location.hostname,path:location.pathname})',
    });
    const urls = new Set<string>([location.url]);
    if (cookies?.length) {
      for (const cookie of cookies)
        if (
          !cookie.name ||
          cookie.value === undefined ||
          (!cookie.url && !cookie.domain)
        )
          throw new Error('Cookie name, value, and URL or domain are required');
      const items = cookies.map((cookie) => {
        if (cookie.url) urls.add(cookie.url);
        else
          for (const scheme of ['http', 'https'])
            urls.add(
              `${scheme}://${cookie.domain!.replace(/^\./, '')}${cookie.path ?? '/'}`,
            );
        return {
          ...cookie,
          partitionKey: cookie.partitionKey
            ? {
                topLevelSite: cookie.partitionKey.sourceOrigin,
                hasCrossSiteAncestor:
                  cookie.partitionKey.hasCrossSiteAncestor ?? false,
              }
            : undefined,
        };
      });
      for (const cookie of items)
        await cdp.send('Network.deleteCookies', {
          name: cookie.name,
          url: cookie.url,
          domain: cookie.domain,
          path: cookie.path,
          partitionKey: cookie.partitionKey,
        });
      await cdp.send('Network.setCookies', { cookies: items });
    }
    const result = await cdp.send('Network.getCookies', { urls: [...urls] });
    return {
      cookies: result.cookies.map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        url: cookie.domain
          ? `https://${cookie.domain}${cookie.path || '/'}`
          : location.url,
        domain: cookie.domain || location.domain,
        path: cookie.path || location.path,
        expires: cookie.expires,
        secure: cookie.secure || false,
        httpOnly: cookie.httpOnly || false,
        sameSite: cookie.sameSite || 'Lax',
      })),
      time: Date.now() - start,
    };
  }
  public async setExtraHTTPHeaders({
    headers,
  }: {
    headers: Record<string, string> | Array<{ name: string; value: string }>;
  }) {
    const start = Date.now();
    this.headers = Array.isArray(headers)
      ? Object.fromEntries(headers.map((h) => [h.name, h.value]))
      : headers;
    await this.mainCDP.send('Network.setExtraHTTPHeaders', {
      headers: this.headers,
    });
    return {
      headers: Object.entries(this.headers).map(([name, value]) => ({
        name,
        value,
      })),
      time: Date.now() - start,
    };
  }
  public async userAgent({ userAgent }: { userAgent: string }) {
    const start = Date.now();
    this.userAgentValue = userAgent;
    await this.applyUserAgent(this.mainCDP, userAgent);
    return { userAgent, time: Date.now() - start };
  }
  public async authenticate({
    username,
    password,
    origin,
  }: {
    username: string;
    password: string;
    origin?: string;
  }) {
    const start = Date.now();
    if (origin !== undefined) {
      let parsed: URL;
      try {
        parsed = new URL(origin);
      } catch {
        throw new Error('Invalid HTTP origin');
      }
      if (
        !['http:', 'https:'].includes(parsed.protocol) ||
        parsed.username ||
        parsed.password ||
        parsed.pathname !== '/' ||
        parsed.search ||
        parsed.hash
      )
        throw new Error('Invalid HTTP origin');
      origin = parsed.origin;
    }
    this.httpAuth = { username, password, origin };
    this.authChallenges = new WeakMap();
    await this.mainCDP.send('Fetch.enable', {
      patterns: [{ urlPattern: '*', requestStage: 'Request' }],
      handleAuthRequests: true,
    });
    return { status: null, text: null, url: null, time: Date.now() - start };
  }
  public async javaScriptEnabled({
    enabled = true,
    cdp = this.mainCDP,
  }: {
    enabled?: boolean;
    cdp?: Connection;
  }) {
    const start = Date.now();
    this.jsEnabled = enabled;
    await cdp.send('Emulation.setScriptExecutionDisabled', { value: !enabled });
    return { enabled, time: Date.now() - start };
  }
  public async viewport({
    width,
    height,
    deviceScaleFactor = 1,
    mobile = false,
    hasTouch = false,
    landscape = false,
    maxTouchPoints = 1,
  }: {
    width: number;
    height: number;
    deviceScaleFactor?: number;
    mobile?: boolean;
    hasTouch?: boolean;
    landscape?: boolean;
    maxTouchPoints?: number;
  }) {
    const start = Date.now();
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width < 1 ||
      height < 1 ||
      !Number.isFinite(deviceScaleFactor) ||
      deviceScaleFactor < 0
    )
      throw new Error('Invalid viewport dimensions');
    width = Math.floor(width);
    height = Math.floor(height);
    await this.mainCDP.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor,
      mobile,
      screenOrientation: {
        type: landscape ? 'landscapePrimary' : 'portraitPrimary',
        angle: landscape ? 90 : 0,
      },
    });
    await this.mainCDP.send('Emulation.setTouchEmulationEnabled', {
      enabled: hasTouch,
      maxTouchPoints,
    });
    return {
      width,
      height,
      deviceScaleFactor,
      mobile,
      hasTouch,
      landscape,
      time: Date.now() - start,
    };
  }
  public async emulateMediaType({
    type,
    cdp = this.mainCDP,
  }: {
    type: 'screen' | 'print';
    cdp?: Connection;
  }) {
    const start = Date.now();
    this.mediaType = type;
    await cdp.send('Emulation.setEmulatedMedia', { media: type });
    return { type, time: Date.now() - start };
  }
  public async screenshot({
    selector,
    options = {},
    cdp = this.mainCDP,
  }: {
    selector?: string;
    options?: {
      type?: 'png' | 'jpeg' | 'webp';
      quality?: number;
      fullPage?: boolean;
      omitBackground?: boolean;
      clip?: { x: number; y: number; width: number; height: number };
      captureBeyondViewport?: boolean;
      timeout?: number;
      waitForImages?: boolean;
    };
    cdp?: Connection;
  } = {}) {
    const start = Date.now();
    await this.beforeCapture();
    if (
      options.quality !== undefined &&
      (!Number.isFinite(options.quality) ||
        options.quality < 0 ||
        options.quality > 100 ||
        !['jpeg', 'webp'].includes(options.type ?? 'png'))
    )
      throw new Error('Invalid screenshot quality');
    if (
      options.clip &&
      (!Number.isFinite(options.clip.width) ||
        !Number.isFinite(options.clip.height) ||
        options.clip.width <= 0 ||
        options.clip.height <= 0)
    )
      throw new Error('Invalid screenshot clip');
    if (selector && options.fullPage)
      throw new Error('selector and fullPage are exclusive');
    if (options.waitForImages) await this.waitForImages(cdp, options.timeout);
    let clip = options.clip;
    if (selector) {
      const rect = await this.waitForSelector({ selector, cdp, visible: true });
      const { cssLayoutViewport } = await cdp.send('Page.getLayoutMetrics');
      clip = {
        x: rect.x + cssLayoutViewport.pageX,
        y: rect.y + cssLayoutViewport.pageY,
        width: rect.width,
        height: rect.height,
      };
    } else if (options.fullPage) {
      const { cssContentSize } = await cdp.send('Page.getLayoutMetrics');
      clip = cssContentSize;
    }
    if (options.omitBackground)
      await cdp.send('Emulation.setDefaultBackgroundColorOverride', {
        color: { r: 0, g: 0, b: 0, a: 0 },
      });
    try {
      const { data } = await bounded(
        cdp.send('Page.captureScreenshot', {
          format: options.type ?? 'png',
          quality: options.quality,
          ...(clip ? { clip: { ...clip, scale: 1 } } : {}),
          captureBeyondViewport:
            options.captureBeyondViewport ?? !!(selector || options.fullPage),
          fromSurface: true,
        }),
        options.timeout ?? this.timeout,
        'Screenshot',
      );
      return {
        base64: data,
        format: options.type ?? 'png',
        time: Date.now() - start,
      };
    } finally {
      if (options.omitBackground)
        await cdp.send('Emulation.setDefaultBackgroundColorOverride');
    }
  }
  public async pdf({
    options = {},
    cdp = this.mainCDP,
  }: { options?: PDFOptionsInput; cdp?: Connection } = {}) {
    const start = Date.now();
    await this.beforeCapture();
    if (options.waitForFonts)
      await this.evaluateInternal({
        cdp,
        timeout: options.timeout,
        content: 'document.fonts.ready.then(() => true)',
      });
    if (options.waitForImages) await this.waitForImages(cdp, options.timeout);
    if (options.fullPage && (options.format || options.height))
      throw new Error('fullPage is exclusive with format and height');
    const inches = (
      value: string | number | undefined,
      fallback: number,
    ): number => {
      if (value === undefined) return fallback;
      if (typeof value === 'number') return value / 96;
      const match = /^(\d+(?:\.\d+)?)\s*(px|in|cm|mm)?$/.exec(value);
      if (!match) throw new Error('Invalid paper dimension');
      return (
        Number(match[1]) *
        { px: 1 / 96, in: 1, cm: 1 / 2.54, mm: 1 / 25.4 }[match[2] ?? 'px']!
      );
    };
    const formats: Record<string, [number, number]> = {
      letter: [8.5, 11],
      legal: [8.5, 14],
      tabloid: [11, 17],
      ledger: [17, 11],
      a0: [33.1, 46.8],
      a1: [23.4, 33.1],
      a2: [16.54, 23.4],
      a3: [11.7, 16.54],
      a4: [8.27, 11.7],
      a5: [5.83, 8.27],
      a6: [4.13, 5.83],
    };
    const format = options.format
      ? formats[options.format.toLowerCase()]
      : undefined;
    if (options.format && !format) throw new Error('Invalid paper format');
    let paperHeight = format?.[1] ?? inches(options.height, 11);
    if (options.fullPage)
      paperHeight =
        (await cdp.send('Page.getLayoutMetrics')).cssContentSize.height / 96;
    if (options.omitBackground)
      await cdp.send('Emulation.setDefaultBackgroundColorOverride', {
        color: { r: 0, g: 0, b: 0, a: 0 },
      });
    try {
      const { data } = await bounded(
        cdp.send('Page.printToPDF', {
          landscape: options.landscape,
          displayHeaderFooter: options.displayHeaderFooter,
          headerTemplate: options.headerTemplate,
          footerTemplate: options.footerTemplate,
          printBackground: options.printBackground,
          scale: options.scale,
          paperWidth: format?.[0] ?? inches(options.width, 8.5),
          paperHeight,
          marginTop:
            options.marginTop === undefined && options.margin?.top === undefined
              ? undefined
              : inches(options.marginTop ?? options.margin?.top, 0),
          marginBottom:
            options.marginBottom === undefined &&
            options.margin?.bottom === undefined
              ? undefined
              : inches(options.marginBottom ?? options.margin?.bottom, 0),
          marginLeft:
            options.marginLeft === undefined &&
            options.margin?.left === undefined
              ? undefined
              : inches(options.marginLeft ?? options.margin?.left, 0),
          marginRight:
            options.marginRight === undefined &&
            options.margin?.right === undefined
              ? undefined
              : inches(options.marginRight ?? options.margin?.right, 0),
          pageRanges: options.pageRanges,
          preferCSSPageSize: options.preferCSSPageSize,
          generateTaggedPDF: options.generateTaggedPDF ?? options.tagged,
          generateDocumentOutline:
            options.generateDocumentOutline ?? options.outline,
        }),
        options.timeout ?? this.timeout,
        'PDF',
      );
      return {
        base64: data,
        size: Buffer.from(data, 'base64').length,
        time: Date.now() - start,
      };
    } finally {
      if (options.omitBackground)
        await cdp.send('Emulation.setDefaultBackgroundColorOverride');
    }
  }
  private async waitForImages(cdp: Connection, timeout = this.timeout) {
    await this.evaluateInternal({
      cdp,
      timeout,
      content: `Promise.all([...document.images].filter(img => !img.complete).map(img => new Promise(resolve => {
      const done = () => { img.removeEventListener('load',done); img.removeEventListener('error',done); resolve(); };
      img.addEventListener('load',done); img.addEventListener('error',done);
    })))`,
    });
  }

  private async inject(
    kind: 'script' | 'style',
    {
      url,
      content,
      id,
      type,
      cdp = this.mainCDP,
    }: {
      url?: string;
      content?: string;
      id?: string;
      type?: string;
      cdp?: Connection;
    },
  ) {
    const start = Date.now();
    if (!url && content === undefined)
      throw new Error('One of URL or content is required');
    await this.evaluateInternal({
      cdp,
      content: `(async() => {
      const el = document.createElement(${JSON.stringify(kind === 'style' && url ? 'link' : kind)});
      if (${JSON.stringify(id ?? '')}) el.id = ${JSON.stringify(id ?? '')};
      if (${JSON.stringify(type ?? '')}) el.type = ${JSON.stringify(type ?? '')};
      ${url ? (kind === 'script' ? `el.src = ${JSON.stringify(url)};` : `el.rel = 'stylesheet'; el.href = ${JSON.stringify(url)};`) : `el.textContent = ${JSON.stringify(content)};`}
      const host = document.head || document.body;
      if (!host) { document.documentElement?.appendChild(el); return; }
      ${url ? "const loaded = new Promise((resolve,reject) => { el.onload = resolve; el.onerror = () => reject(new Error('Unable to load resource')); });" : ''}
      host.appendChild(el); ${url ? 'await loaded;' : ''}
    })()`,
    });
    return { time: Date.now() - start };
  }
  public addScriptTag(args: {
    url?: string;
    content?: string;
    id?: string;
    type?: string;
    cdp?: Connection;
  }) {
    return this.inject('script', args);
  }
  public addStyleTag(args: {
    url?: string;
    content?: string;
    cdp?: Connection;
  }) {
    return this.inject('style', args);
  }

  public async waitForFunction({
    fn,
    polling = 100,
    pollingType,
    timeout = this.timeout,
    cdp = this.mainCDP,
  }: {
    fn: string;
    polling?: number;
    pollingType?: 'raf' | 'mutation';
    timeout?: number;
    cdp?: Connection;
  }) {
    const start = Date.now();
    if (!Number.isFinite(polling) || polling < 0)
      throw new Error('Invalid polling interval');
    await this.evaluateInternal({
      cdp,
      timeout,
      content: `new Promise((resolve,reject) => {
      let timer, deadline, observer, frame, finished = false;
      const finish = (error) => { if (finished) return; finished = true; clearTimeout(timer); clearTimeout(deadline); observer?.disconnect(); if (frame !== undefined) cancelAnimationFrame(frame); error ? reject(error) : resolve(true); };
      const tick = async () => { if (finished) return; try { let value = (${fn}); if (typeof value === 'function') value = value(); if (await value) return finish(); } catch(error) { return finish(error); }
        if (${JSON.stringify(pollingType)} === 'raf') frame = requestAnimationFrame(tick);
        else if (${JSON.stringify(pollingType)} === 'mutation') { observer = new MutationObserver(() => { observer.disconnect(); tick(); }); observer.observe(document,{subtree:true,childList:true,attributes:true}); }
        else timer = setTimeout(tick,${polling});
      };
      if (${timeout}) deadline = setTimeout(() => finish(new Error('waitForFunction timed out')),${timeout}); tick();
    })`,
    });
    return { time: Date.now() - start };
  }
  private eventTracker(event: string) {
    return `(() => { const key = '__bqlWatchedEvents'; const events = globalThis[key] ??= {}; const name = ${JSON.stringify(event)}; events[name] ??= false; const record = () => { events[name] = true; }; document.addEventListener(name, record, {once:true}); window.addEventListener(name, record, {once:true}); })()`;
  }
  public async watchEvent({
    event,
    cdp = this.mainCDP,
  }: {
    event: string;
    cdp?: Connection;
  }) {
    const start = Date.now();
    const source = this.eventTracker(event);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source });
    await this.evaluateInternal({ cdp, content: source });
    return { time: Date.now() - start };
  }
  public async waitForEvent({
    event,
    timeout = this.timeout,
    cdp = this.mainCDP,
  }: {
    event: string;
    timeout?: number;
    cdp?: Connection;
  }) {
    const start = Date.now();
    await this.evaluateInternal({
      cdp,
      timeout,
      content: `new Promise((resolve,reject) => {
      const name = ${JSON.stringify(event)}; if (globalThis.__bqlWatchedEvents?.[name]) return resolve(true);
      let timer; const cleanup = () => { clearTimeout(timer); document.removeEventListener(name,done); window.removeEventListener(name,done); };
      const done = () => { cleanup(); resolve(true); };
      document.addEventListener(name,done,{once:true}); window.addEventListener(name,done,{once:true});
      if (${timeout}) timer = setTimeout(() => { cleanup(); reject(new Error('waitForEvent timed out')); },${timeout});
    })`,
    });
    return { time: Date.now() - start };
  }
  public waitForTimeout({ time }: { time: number }) {
    return pause(time).then(() => ({ time }));
  }
  public waitForNetworkIdle({
    idleTime = 500,
    concurrency = 0,
    timeout = this.timeout,
  }: { idleTime?: number; concurrency?: number; timeout?: number } = {}) {
    if (idleTime < 0 || concurrency < 0)
      return Promise.reject(new Error('Invalid idle time or concurrency'));
    const start = Date.now();
    return new Promise<{ time: number }>((resolve, reject) => {
      let idle: ReturnType<typeof setTimeout> | undefined,
        deadline: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        clearTimeout(idle);
        clearTimeout(deadline);
        this.events.off('network-change', check);
        this.events.off('close', closed);
      };
      const closed = () => {
        cleanup();
        reject(new Error('Browser closed while waiting'));
      };
      const check = () => {
        if (this.inflight.size > concurrency) {
          clearTimeout(idle);
          idle = undefined;
        } else
          idle ??= setTimeout(() => {
            cleanup();
            resolve({ time: Date.now() - start });
          }, idleTime);
      };
      this.events.on('network-change', check);
      this.events.once('close', closed);
      if (timeout)
        deadline = setTimeout(() => {
          cleanup();
          reject(new Error('Network idle timed out'));
        }, timeout);
      check();
    });
  }
  private filterArgs(args: {
    urls?: string[];
    methods?: string[];
    types?: string[];
    statuses?: number[];
    operator?: Operator;
  }): Filter {
    return {
      url: args.urls,
      method: args.methods,
      type: args.types,
      status: args.statuses,
      operator: args.operator,
    };
  }
  public hasMadeRequest(args: {
    urls?: string[];
    methods?: string[];
    types?: string[];
    operator?: Operator;
  }) {
    const found = [...this.requests.values()]
      .filter((r) => matches(r, this.filterArgs(args)))
      .map(({ id, url, method, type, headers }) => ({
        id,
        url,
        method,
        type,
        headers,
      }));
    return found.length ? found : null;
  }
  public hasReceivedResponse(args: {
    urls?: string[];
    methods?: string[];
    types?: string[];
    statuses?: number[];
    operator?: Operator;
  }) {
    const found = [...this.responses.values()]
      .filter((r) => matches(r, this.filterArgs(args)))
      .map(({ id, url, method, type, headers, status }) => ({
        id,
        url,
        method,
        type,
        headers,
        status,
      }));
    return found.length ? found : null;
  }
  private waitNetwork(
    kind: 'request' | 'response',
    filter: Filter,
    timeout = this.timeout,
  ): Promise<NetworkRecord[]> {
    const records = () =>
      [
        ...(kind === 'request' ? this.requests : this.responses).values(),
      ].filter((r) => matches(r, filter));
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        clearTimeout(timer);
        this.events.off(kind, check);
        this.events.off('close', closed);
      };
      const check = () => {
        const found = records();
        if (found.length) {
          cleanup();
          resolve(found);
        }
      };
      const closed = () => {
        cleanup();
        reject(new Error('Browser closed while waiting'));
      };
      this.events.on(kind, check);
      this.events.once('close', closed);
      if (timeout)
        timer = setTimeout(() => {
          cleanup();
          reject(new Error(`Network ${kind} timed out`));
        }, timeout);
      check();
    });
  }
  public waitForRequest(args: {
    urls?: string[];
    methods?: string[];
    types?: string[];
    operator?: Operator;
    timeout?: number;
  }) {
    return this.waitNetwork('request', this.filterArgs(args), args.timeout);
  }
  public waitForResponse(args: {
    urls?: string[];
    methods?: string[];
    types?: string[];
    statuses?: number[];
    operator?: Operator;
    timeout?: number;
  }) {
    return this.waitNetwork('response', this.filterArgs(args), args.timeout);
  }
  public async getResponseBody(
    id: string,
    timeout = this.timeout,
  ): Promise<{ body: string; base64Encoded: boolean } | null> {
    const deadline = timeout ? Date.now() + timeout : undefined;
    const origin = this.responseOrigins.get(id);
    const cdp = origin?.cdp ?? this.mainCDP;
    await this.beforeReadback();
    try {
      if (this.closed) return null;
      if (origin?.pending ?? this.inflight.has(id))
        await new Promise<void>((resolve, reject) => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          const done = (finished: string) => {
            if (finished === id) {
              cleanup();
              resolve();
            }
          };
          const closed = () => {
            cleanup();
            reject(new Error('Browser closed'));
          };
          const cleanup = () => {
            clearTimeout(timer);
            this.events.off('body', done);
            this.events.off('close', closed);
          };
          this.events.on('body', done);
          this.events.once('close', closed);
          if (timeout)
            timer = setTimeout(() => {
              cleanup();
              reject(new Error('Response body timed out'));
            }, timeout);
        });
      if (this.closed || origin?.failed || (deadline && Date.now() >= deadline))
        return null;
      return await bounded(
        cdp.send('Network.getResponseBody', { requestId: id }),
        deadline ? Math.max(1, deadline - Date.now()) : 0,
        'Response body',
      );
    } catch {
      return null;
    }
  }
  public async request(args: Filter & { wait: boolean; timeout?: number }) {
    const records = await this.waitNetwork(
      'request',
      args,
      args.wait ? args.timeout : 100,
    ).catch(() => null);
    return (
      records?.map(({ url, method, type, headers }) => ({
        url,
        method,
        type,
        headers: Object.entries(headers).map(([name, value]) => ({
          name,
          value,
        })),
      })) ?? null
    );
  }
  public async response(args: Filter & { wait: boolean; timeout?: number }) {
    const grant = args.wait ? (args.timeout ?? this.timeout) : undefined;
    const deadline = grant ? Date.now() + grant : undefined;
    const records = await this.waitNetwork(
      'response',
      args,
      args.wait ? args.timeout : 100,
    ).catch(() => null);
    return records
      ? Promise.all(
          records.map(async ({ id, url, method, type, headers, status }) => ({
            id,
            url,
            method,
            type,
            status,
            headers: Object.entries(headers).map(([name, value]) => ({
              name,
              value,
            })),
            ...((deadline && Date.now() >= deadline
              ? null
              : await this.getResponseBody(
                  id,
                  deadline ? Math.max(1, deadline - Date.now()) : grant,
                )) ?? { body: null, base64Encoded: false }),
          })),
        )
      : null;
  }
  public async reject({ enabled, ...filter }: Filter & { enabled: boolean }) {
    const start = Date.now();
    if (!enabled)
      this.rules = this.rules.filter(
        (r) => r.decision.method !== 'Fetch.failRequest',
      );
    else {
      this.validateFilter(filter);
      this.rules.push({
        filter,
        decision: {
          method: 'Fetch.failRequest',
          params: { errorReason: 'Aborted' },
        },
      });
    }
    return { enabled, time: Date.now() - start };
  }
  private validateFilter(filter: Filter) {
    if (
      ![filter.url, filter.regex, filter.method, filter.type].some(
        (v) => v?.length,
      )
    )
      throw new Error('One of URL, regex, method or type must be specified');
    for (const regex of filter.regex ?? []) {
      if (
        regex.length > 200 ||
        /\([^)]*[+*{][^)]*\)\s*[+*{]/.test(regex) ||
        /\((?:[^()]*\([^)]*[+*{][^)]*\)[^()]*)\)\s*[+*{]/.test(regex)
      )
        throw new Error('Network regex is too complex');
      try {
        new RegExp(regex);
      } catch {
        throw new Error('Network regex is invalid');
      }
    }
  }
  public async fulfill({
    status = 200,
    contentType,
    body,
    base64Body,
    headers = [],
    ...filter
  }: Omit<Filter, 'status'> & {
    status?: number;
    contentType?: string;
    body?: string;
    base64Body?: string;
    headers?: Array<{ name: string; value: string }>;
  }) {
    const start = Date.now();
    this.validateFilter(filter);
    this.rules.push({
      filter,
      decision: {
        method: 'Fetch.fulfillRequest',
        params: {
          responseCode: status,
          responseHeaders: [
            ...headers,
            ...(contentType
              ? [{ name: 'Content-Type', value: contentType }]
              : []),
          ],
          body: base64Body ?? Buffer.from(body ?? '').toString('base64'),
        },
      },
    });
    return { time: Date.now() - start };
  }
  public async listPageTargets(): Promise<PageTarget[]> {
    return (await this.fetchTarget<PageTarget[]>('/json/list')).filter(
      (t) => t.type === 'page',
    );
  }
  public async windows() {
    return (await this.listPageTargets()).map((t) => ({
      targetId: t.id,
      url: t.url,
      title: t.title,
    }));
  }
  public getCurrentTargetId(): string | null {
    return this.mainCDP?.url().split('/').pop() ?? null;
  }
  private observeTarget(id: string) {
    if (!this.targetOrder.has(id))
      this.targetOrder.set(id, this.targetSequence++);
  }
  public async switchToWindow({
    targetId,
    url,
    title,
    newest = false,
    timeout = 5000,
    waitUntil,
  }: {
    targetId?: string;
    url?: string;
    title?: string;
    newest?: boolean;
    timeout?: number;
    waitUntil?: WaitUntil;
  }) {
    const start = Date.now();
    do {
      if (this.closed)
        return { success: false, error: 'Browser is no longer running' };
      const targets = await this.listPageTargets();
      targets.forEach((t) => this.observeTarget(t.id));
      if (newest)
        targets.sort(
          (a, b) => this.targetOrder.get(b.id)! - this.targetOrder.get(a.id)!,
        );
      const target = targets.find((t) =>
        targetId
          ? t.id === targetId
          : (!url || glob(t.url, url)) && (!title || glob(t.title, title)),
      );
      if (target) {
        const previous = this.mainCDP;
        const next =
          target.id === this.getCurrentTargetId()
            ? previous
            : await this.connect(target.webSocketDebuggerUrl);
        try {
          this.mainCDP = next;
          await this.setupTarget(next, 'page');
        } catch (error) {
          this.mainCDP = previous;
          throw error;
        }
        this.resetNetwork();
        await this.browserCDP.send('Target.activateTarget', {
          targetId: target.id,
        });
        if (waitUntil)
          await this.waitForFunction({
            fn: "document.readyState === 'complete'",
            timeout,
          });
        return { success: true, url: target.url, title: target.title };
      }
      await pause(50);
    } while (Date.now() - start < timeout);
    return { success: false, error: 'No matching window found' };
  }
  public async getWindowSize() {
    const { value } = await this.evaluate({
      content: '({width:innerWidth,height:innerHeight})',
    });
    return value;
  }
  public async getPageSize(cdp = this.mainCDP) {
    const { cssContentSize } = await cdp.send('Page.getLayoutMetrics');
    return { width: cssContentSize.width, height: cssContentSize.height };
  }
  public hasErrored() {
    // Raw Connection exposes this getter, but its public declaration omits it.
    const connections = [this.mainCDP, this.browserCDP] as Array<
      Connection & { readonly _closed?: boolean }
    >;
    return this.closed || connections.some((cdp) => cdp?._closed);
  }
  public onDisconnected(listener: () => void): () => void {
    this.events.on('disconnected', listener);
    return () => {
      this.events.off('disconnected', listener);
    };
  }
  private observeDisconnect(cdp: Connection): void {
    const disconnected = () => {
      if (this.closed || (cdp !== this.mainCDP && cdp !== this.browserCDP))
        return;
      this.events.emit('disconnected');
      void this.close().catch(() =>
        this.logger.error?.('Browser cleanup failed'),
      );
    };
    cdp.on(CDPSessionEvent.Disconnected, disconnected);
    this.cleanup.push(() =>
      cdp.off(CDPSessionEvent.Disconnected, disconnected),
    );
  }
  public async close() {
    if (this.closed) return;
    this.closed = true;
    this.events.emit('close');
    try {
      await this.onClose();
    } finally {
      this.cleanup.splice(0).forEach((fn) => fn());
      for (const cdp of this.clients) cdp.dispose();
      if (!this.clients.has(this.mainCDP)) this.mainCDP?.dispose();
      this.browserCDP?.dispose();
      this.clients.clear();
      this.responseOrigins.clear();
      this.httpAuth = undefined;
      this.authChallenges = new WeakMap();
      this.events.removeAllListeners();
    }
  }
}

export default BQLBrowserAPI;
