import { Config, Logger, decrypt, encrypt } from '@browserless.io/browserless';
import { readFile, stat, writeFile } from 'fs/promises';
import { EventEmitter } from 'events';

export class FileSystem extends EventEmitter {
  protected fsMap: Map<string, string[]> = new Map();
  // mtime of the file when its cache entry was hydrated, so external
  // writes to the same path invalidate the in-memory copy.
  protected mtimes: Map<string, number> = new Map();
  // Per-path promise chain so concurrent append() calls can't interleave
  // their read-modify-write cycles and drop entries.
  protected writeChains: Map<string, Promise<void>> = new Map();
  protected currentAESKey: Buffer;
  protected logger = new Logger('file-system');

  constructor(protected config: Config) {
    super();
    this.currentAESKey = config.getAESKey();
  }

  /**
   * Appends contents to a file-path for persistance. File contents are
   * encrypted before being saved to disk. Reads happen via the in-memory
   * lookup of the internal map. Appends to the same path are serialized.
   *
   * @param path The filepath to persist contents to
   * @param newContent A string of new content to add to the file
   * @param shouldEncode Whether contents are AES encoded on disk
   * @param maxEntries When set (a positive integer), only the most recent N
   * entries are kept, bounding both the file and its in-memory cache. Throws
   * for a non-integer or non-positive value — a negative count would splice
   * away the entry just appended (silent data loss) and 0 would disable the
   * cap it was meant to enforce.
   * @returns void
   */
  public async append(
    path: string,
    newContent: string,
    shouldEncode: boolean,
    maxEntries?: number,
  ): Promise<void> {
    if (
      maxEntries !== undefined &&
      (!Number.isInteger(maxEntries) || maxEntries < 1)
    ) {
      throw new Error(
        `maxEntries must be a positive integer when set, got "${maxEntries}"`,
      );
    }

    const prior = this.writeChains.get(path) ?? Promise.resolve();
    const task = prior.then(async () => {
      // Work on a copy — read() returns the live cached array, and the
      // cache must only reflect the new entry once the disk write has
      // succeeded, or a failed write leaves cache and file diverged.
      const contents = [...(await this.read(path, shouldEncode))];

      contents.push(newContent);
      if (maxEntries && contents.length > maxEntries) {
        contents.splice(0, contents.length - maxEntries);
      }

      const encoded = shouldEncode
        ? await encrypt(contents.join('\n'), this.currentAESKey)
        : contents.join('\n');

      await writeFile(path, encoded.toString());
      this.fsMap.set(path, contents);
      await this.recordMtime(path);
    });

    // Keep the chain alive past failures so one bad write doesn't wedge
    // every subsequent append to this path.
    const chain = task.catch(() => undefined);
    this.writeChains.set(path, chain);
    // Reclaim the entry once this chain settles — unless a newer append for
    // the same path has already replaced it — so the map doesn't retain one
    // resolved promise per distinct path for the life of the process.
    void chain.finally(() => {
      if (this.writeChains.get(path) === chain) {
        this.writeChains.delete(path);
      }
    });

    return task;
  }

  /**
   * Reads contents from the local map, if any exist and the file hasn't
   * changed on disk since hydration, or loads from the file system and
   * hydrates the cache for the particular filepath
   *
   * @param path The filepath of the contents to read
   * @returns Promise of the contents separated by newlines
   */
  public async read(path: string, encoded: boolean): Promise<string[]> {
    const mtime = await this.getMtime(path);

    if (this.fsMap.has(path) && this.mtimes.get(path) === mtime) {
      return this.fsMap.get(path) as string[];
    }
    const contents = (await readFile(path).catch(() => '')).toString();
    const decoded =
      encoded && contents.length
        ? await decrypt(contents, this.currentAESKey)
        : contents;
    const splitContents = decoded.length ? decoded.split('\n') : [];

    this.fsMap.set(path, splitContents);
    if (mtime !== null) {
      this.mtimes.set(path, mtime);
    } else {
      this.mtimes.delete(path);
    }

    return splitContents;
  }

  protected async getMtime(path: string): Promise<number | null> {
    return stat(path).then(
      (s) => s.mtimeMs,
      () => null,
    );
  }

  protected async recordMtime(path: string): Promise<void> {
    const mtime = await this.getMtime(path);
    if (mtime !== null) {
      this.mtimes.set(path, mtime);
    }
  }

  /**
   * Implement any browserless-core-specific shutdown logic here.
   * Calls the empty-SDK stop method for downstream implementations.
   */
  public async shutdown() {
    return await this.stop();
  }

  /**
   * Left blank for downstream SDK modules to optionally implement.
   */
  public stop() {}
}
