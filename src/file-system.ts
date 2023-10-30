import { writeFile, readFile } from 'fs/promises';

import { Config } from './config.js';
import { encrypt, decrypt } from './utils.js';

export class FileSystem {
  private fsMap: Map<string, string[]> = new Map();

  constructor(private config: Config) {}

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

    const key = this.config.getAESKey();
    const encoded = await encrypt(contents.join('\n'), Buffer.from(key));

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

    const key = this.config.getAESKey();
    const contents = (await readFile(path).catch(() => '')).toString();
    const splitContents = contents.length
      ? (await decrypt(contents, Buffer.from(key))).split('\n')
      : [];

    this.fsMap.set(path, splitContents);

    return splitContents;
  };
}
