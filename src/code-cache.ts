import { TTLCache } from '@brokerloop/ttlcache';
import shortid = require('shortid');

export interface ICodeCache {
  readonly concurrency: number;
  set: (code: string) => string;
  get: (id: string) => string | undefined;
}

export class CodeCache {
  private cache: TTLCache;

  constructor(ttl: number, max: number) {
    this.cache = new TTLCache({ ttl, max });
  }

  public set(code: string): string {
    const id = shortid.generate();
    this.cache.set(id, code);
    return id;
  }

  public get(id: string): string | undefined {
    const code = this.cache.get(id);
    this.cache.delete(id);
    return code;
  }
}
