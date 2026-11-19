import assert from 'node:assert/strict';
import { BrowserQL } from '@browserless.io/browserless';

describe('BQL module names', () => {
  for (const name of [
    '',
    ' ',
    'two names',
    'two,names',
    'bad\n',
    'bad\r',
    'bad\t',
    'bad\0',
    'café',
    '東京',
  ]) {
    it(`rejects ${JSON.stringify(name)} during construction`, () => {
      assert.throws(
        () => new BrowserQL({ modules: [{ name, typeDefs: '' }] }),
        /Invalid module name.*HTTP token/,
      );
    });
  }

  it('accepts HTTP token punctuation and preserves discovery names', async () => {
    const name = "a!#$%&'*+-.^_`|~09AZ";
    const service = new BrowserQL({ modules: [{ name, typeDefs: '' }] });
    assert.deepEqual(service.capabilities, ['core', name]);
  });

  it('still rejects reserved and duplicate module names', () => {
    for (const names of [['core'], ['same', 'same']]) {
      assert.throws(
        () =>
          new BrowserQL({
            modules: names.map((name) => ({ name, typeDefs: '' })),
          }),
        /Duplicate.*module name/,
      );
    }
  });
});

describe('BQL capability names', () => {
  for (const name of ['bad\n', '東京', 'two,names', '']) {
    it(`rejects ${JSON.stringify(name)} during construction`, () => {
      assert.throws(
        () => new BrowserQL({ capabilities: [name] }),
        /Invalid capability name.*HTTP token/,
      );
    });
  }
});
