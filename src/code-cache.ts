import { TTLCache } from '@brokerloop/ttlcache';
import * as uuid from 'uuid/v4';

export interface ICodeCache {
  readonly concurrency: number;
  set: (code: string) => string;
  get: (id: string) => string | undefined;
}

export class CodeCache {
  private cache: TTLCache;

  constructor(max: number) {
    this.cache = new TTLCache({ ttl: 300000, max });
  }

  public set(code: string): string {
    const id = uuid();
    this.cache.set(id, code);
    return id;
  }

  public get(id: string): string | undefined {
    return this.cache.get(id);
  }
}
