import { Config, FileSystem, sleep } from '@browserless.io/browserless';
import { readFile, unlink } from 'fs/promises';
import { expect } from 'chai';

const filePath = '/tmp/_browserless_test_fs_';

describe('File-System', () => {
  afterEach(async () => unlink(filePath));

  it('saves and encodes files', async () => {
    const mySecretContents = 'pony-foo';
    const config = new Config();
    config.setToken('browserless.io');
    const f = new FileSystem(config);

    await f.append(filePath, mySecretContents);

    expect(await f.read(filePath)).to.eql([mySecretContents]);
    const rawText = (await readFile(filePath)).toString();

    expect(rawText.toString()).to.not.include(mySecretContents);
  });

  it('appends newlines to files', async () => {
    const mySecretContents = 'pony-foo';
    const moreSecretContents = 'pony-pony-foo-foo';
    const config = new Config();
    config.setToken('browserless.io');
    const f = new FileSystem(config);

    await f.append(filePath, mySecretContents);

    expect(await f.read(filePath)).to.eql([mySecretContents]);

    await f.append(filePath, moreSecretContents);

    expect(await f.read(filePath)).to.eql([
      mySecretContents,
      moreSecretContents,
    ]);
  });

  it('re-encodes files on token changes', async () => {
    const config = new Config();
    config.setToken('browserless.io');
    const f = new FileSystem(config);
    const mySecretContents = 'pony-foo';

    await f.append(filePath, mySecretContents);
    const oldText = (await readFile(filePath)).toString();
    config.setToken('super-browserless-64');
    await sleep(200);
    const newText = (await readFile(filePath)).toString();

    expect(oldText).to.not.equal(newText);
    expect(await f.read(filePath)).to.eql([mySecretContents]);
  });
});
