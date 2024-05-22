import { Config, Logger, decrypt, encrypt } from '@browserless.io/browserless';
import { readFile, writeFile } from 'fs/promises';
import { EventEmitter } from 'events';

export class FileSystem extends EventEmitter {
  protected fsMap: Map<string, string[]> = new Map();
  protected currentAESKey: Buffer;
  protected logger = new Logger('file-system');

  constructor(protected config: Config) {
    super();
    this.currentAESKey = config.getAESKey();
  }

  /**
   * Appends contents to a file-path for persistance. File contents are
   * encrypted before being saved to disk. Reads happen via the in-memory
   * lookup of the internal map.
   *
   * @param path The filepath to persist contents to
   * @param newContent A string of new content to add to the file
   * @returns void
   */
  public async append(
    path: string,
    newContent: string,
    shouldEncode: boolean,
  ): Promise<void> {
    const contents = await this.read(path, shouldEncode);

    contents.push(newContent);
    this.fsMap.set(path, contents);

    const encoded = shouldEncode
      ? await encrypt(contents.join('\n'), this.currentAESKey)
      : contents.join('\n');

    return writeFile(path, encoded.toString());
  }

  /**
   * Reads contents from the local map, if any exist, or loads
   * from the file system and hydrates the cache for the particular filepath
   *
   * @param path The filepath of the contents to read
   * @returns Promise of the contents separated by newlines
   */
  public async read(path: string, encoded: boolean): Promise<string[]> {
    const hasKey = this.fsMap.has(path);

    if (hasKey) {
      return this.fsMap.get(path) as string[];
    }
    const contents = (await readFile(path).catch(() => '')).toString();
    const decoded =
      encoded && contents.length
        ? await decrypt(contents, this.currentAESKey)
        : contents;
    const splitContents = decoded.length ? decoded.split('\n') : [];

    this.fsMap.set(path, splitContents);

    return splitContents;
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
