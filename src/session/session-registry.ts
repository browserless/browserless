import {
  BrowserInstance,
  BrowserlessSession,
  Logger,
} from '@browserless.io/browserless';

/**
 * SessionRegistry manages browser session bookkeeping.
 *
 * Responsibilities:
 * - Map<BrowserInstance, BrowserlessSession> storage
 * - Session lookup by browser or ID
 * - Session iteration and filtering
 *
 * This is a pure data structure with no side effects.
 * It does NOT handle lifecycle (timers, cleanup) - that's SessionLifecycleManager.
 */
export class SessionRegistry {
  private sessionsMap: Map<BrowserInstance, BrowserlessSession> = new Map();
  private log = new Logger('session-registry');

  /**
   * Register a browser session.
   */
  register(browser: BrowserInstance, session: BrowserlessSession): void {
    this.sessionsMap.set(browser, session);
    this.log.debug(`Registered session ${session.id}`);
  }

  /**
   * Remove a browser session.
   */
  remove(browser: BrowserInstance): void {
    const session = this.sessionsMap.get(browser);
    if (session) {
      this.sessionsMap.delete(browser);
      this.log.debug(`Removed session ${session.id}`);
    }
  }

  /**
   * Get session by browser instance.
   */
  get(browser: BrowserInstance): BrowserlessSession | undefined {
    return this.sessionsMap.get(browser);
  }

  /**
   * Check if browser is registered.
   */
  has(browser: BrowserInstance): boolean {
    return this.sessionsMap.has(browser);
  }

  /**
   * Get all browser-session pairs.
   */
  entries(): IterableIterator<[BrowserInstance, BrowserlessSession]> {
    return this.sessionsMap.entries();
  }

  /**
   * Get all browsers.
   */
  browsers(): IterableIterator<BrowserInstance> {
    return this.sessionsMap.keys();
  }

  /**
   * Get all sessions.
   */
  sessions(): IterableIterator<BrowserlessSession> {
    return this.sessionsMap.values();
  }

  /**
   * Get count of registered sessions.
   */
  size(): number {
    return this.sessionsMap.size;
  }

  /**
   * Find a session by its ID (extracted from wsEndpoint).
   */
  findById(sessionId: string): [BrowserInstance, BrowserlessSession] | null {
    for (const [browser, session] of this.sessionsMap) {
      if (session.id === sessionId) {
        return [browser, session];
      }
    }
    return null;
  }

  /**
   * Find a session by wsEndpoint path segment.
   */
  findByWsEndpoint(id: string): [BrowserInstance, BrowserlessSession] | null {
    for (const [browser, session] of this.sessionsMap) {
      if (browser.wsEndpoint()?.includes(id)) {
        return [browser, session];
      }
    }
    return null;
  }

  /**
   * Check if a trackingId is already in use.
   */
  hasTrackingId(trackingId: string): boolean {
    for (const session of this.sessionsMap.values()) {
      if (session.trackingId === trackingId) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get all sessions as an array of [browser, session] tuples.
   */
  toArray(): Array<[BrowserInstance, BrowserlessSession]> {
    return Array.from(this.sessionsMap.entries());
  }

  /**
   * Filter sessions by predicate.
   */
  filter(
    predicate: (browser: BrowserInstance, session: BrowserlessSession) => boolean
  ): Array<[BrowserInstance, BrowserlessSession]> {
    return this.toArray().filter(([b, s]) => predicate(b, s));
  }

  /**
   * Apply a function to each session and return results.
   */
  map<T>(
    fn: (browser: BrowserInstance, session: BrowserlessSession) => T
  ): T[] {
    return this.toArray().map(([b, s]) => fn(b, s));
  }

  /**
   * Clear all sessions.
   */
  clear(): void {
    this.sessionsMap.clear();
    this.log.debug('Cleared all sessions');
  }

  /**
   * Increment connection count for a session.
   */
  incrementConnections(browser: BrowserInstance): void {
    const session = this.sessionsMap.get(browser);
    if (session) {
      session.numbConnected++;
    }
  }

  /**
   * Decrement connection count for a session.
   */
  decrementConnections(browser: BrowserInstance): void {
    const session = this.sessionsMap.get(browser);
    if (session) {
      session.numbConnected--;
    }
  }
}
