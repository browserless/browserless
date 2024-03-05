import {
  Config,
  createLogger,
  decrypt,
  encrypt,
} from '@browserless.io/browserless';
import { readFile, writeFile } from 'fs/promises';

export class FileSystem {
  protected fsMap: Map<string, string[]> = new Map();
  protected currentAESKey: Buffer;
  protected log = createLogger('file-system');

  constructor(protected config: Config) {
    this.currentAESKey = config.getAESKey();
    this.config.on('token', this.handleTokenChange);
  }

  private handleTokenChange = async () => {
    this.log(`Token has changed, updating file-system contents`);
    const start = Date.now();
    const newAESKey = this.config.getAESKey();
    await Promise.all(
      Array.from(this.fsMap).map(async ([filePath, contents]) => {
        const newlyEncoded = encrypt(
          contents.join('\n'),
          Buffer.from(newAESKey),
        );
        return writeFile(filePath, newlyEncoded);
      }),
    ).catch((e) => {
      this.log(`Error in setting new token: "${e}"`);
    });
    this.log(`Successfully updated file encodings in ${Date.now() - start}ms`);
    this.currentAESKey = this.config.getAESKey();
  };

  /**
   * Appends contents to a file-path for persistance. File contents are
   * encrypted before being saved to disk. Reads happen via the in-memory
   * lookup of the internal map.
   *
   * @param path The filepath to persist contents to
   * @param newContent A string of new content to add to the file
   * @returns void
   */
  append = async (path: string, newContent: string): Promise<void> => {
    const contents = await this.read(path);

    contents.push(newContent);
    this.fsMap.set(path, contents);
    const encoded = await encrypt(
      contents.join('\n'),
      Buffer.from(this.currentAESKey),
    );

    return writeFile(path, encoded.toString());
  };

  /**
   * Reads contents from the local map, if any exist, or loads
   * from the file system and hydrates the cache for the particular filepath
   *
   * @param path The filepath of the contents to read
   * @returns Promise of the contents separated by newlines
   */
  read = async (path: string): Promise<string[]> => {
    const hasKey = this.fsMap.has(path);

    if (hasKey) {
      return this.fsMap.get(path) as string[];
    }
    const contents = (await readFile(path).catch(() => '')).toString();
    const splitContents = contents.length
      ? (await decrypt(contents, Buffer.from(this.currentAESKey))).split('\n')
      : [];

    this.fsMap.set(path, splitContents);

    return splitContents;
  };

  /**
   * Implement any browserless-core-specific shutdown logic here.
   * Calls the empty-SDK stop method for downstream implementations.
   */
  public shutdown = async() => {
    await this.stop();
  };

  /**
   * Left blank for downstream SDK modules to optionally implement.
   */
  public stop = () => {};
}
