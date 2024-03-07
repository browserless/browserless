import { Config, FileSystem, noop } from '@browserless.io/browserless';
import { readFile, unlink } from 'fs/promises';
import { expect } from 'chai';

const filePath = '/tmp/_browserless_test_fs_';

describe('File-System', () => {
  afterEach(async () => unlink(filePath).catch(noop));

  it('saves and encodes files', async () => {
    const mySecretContents = 'pony-foo';
    const config = new Config();
    config.setToken('browserless.io');
    const f = new FileSystem(config);

    await f.append(filePath, mySecretContents, true);

    expect(await f.read(filePath, true)).to.eql([mySecretContents]);
    const rawText = (await readFile(filePath)).toString();

    expect(rawText.toString()).to.not.include(mySecretContents);
  });

  it('saves files without encoding', async () => {
    const mySecretContents = 'pony-foo';
    const config = new Config();
    config.setToken('browserless.io');
    const f = new FileSystem(config);

    await f.append(filePath, mySecretContents, false);

    expect(await f.read(filePath, false)).to.eql([mySecretContents]);
    const rawText = (await readFile(filePath)).toString();

    expect(rawText.toString()).to.include(mySecretContents);
  });

  it('appends newlines to files and encodes them', async () => {
    const mySecretContents = 'pony-foo';
    const moreSecretContents = 'pony-pony-foo-foo';
    const config = new Config();
    config.setToken('browserless.io');
    const f = new FileSystem(config);

    await f.append(filePath, mySecretContents, true);

    expect(await f.read(filePath, true)).to.eql([mySecretContents]);

    await f.append(filePath, moreSecretContents, true);

    expect(await f.read(filePath, true)).to.eql([
      mySecretContents,
      moreSecretContents,
    ]);
    const rawText = (await readFile(filePath)).toString();

    expect(rawText).to.not.include(mySecretContents);
    expect(rawText).to.not.include(moreSecretContents);
  });

  it('appends newlines to files and does not encode them', async () => {
    const mySecretContents = 'pony-foo';
    const moreSecretContents = 'pony-pony-foo-foo';
    const config = new Config();
    config.setToken('browserless.io');
    const f = new FileSystem(config);

    await f.append(filePath, mySecretContents, false);

    expect(await f.read(filePath, false)).to.eql([mySecretContents]);

    await f.append(filePath, moreSecretContents, false);

    expect(await f.read(filePath, false)).to.eql([
      mySecretContents,
      moreSecretContents,
    ]);
    const rawText = (await readFile(filePath)).toString();

    expect(rawText).to.include(mySecretContents);
    expect(rawText).to.include(moreSecretContents);
  });
});
