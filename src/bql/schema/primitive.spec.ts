import assert from 'node:assert/strict';
import { BQLBrowserAPI } from '../api/browser-api.js';
import { BrowserQL } from '../browserql.js';
import { BadRequest } from '../../utils.js';
import Sinon from 'sinon';

const options = {} as ConstructorParameters<typeof BQLBrowserAPI>[0];

class API extends BQLBrowserAPI {
  evaluations: unknown[] = [];
  delay = 0;
  override async start() {}
  override async close() {}
  override preferences() {
    return { timeout: 37 };
  }
  override async evaluate(args: Parameters<BQLBrowserAPI['evaluate']>[0]) {
    this.evaluations.push(args);
    if (this.delay)
      await new Promise((resolve) => setTimeout(resolve, this.delay));
    return { value: 'ok', time: 1 };
  }
  override async fulfill() {
    return { time: 1 };
  }
}

describe('BrowserQL primitive contracts', () => {
  it('separates script fetch and execution deadlines and normalizes nullable sources', async () => {
    const api = new API(options);
    const service = new BrowserQL({ apiFactory: () => api });
    const context = service.createContext(options);
    for (const [argument, timeout, executionTimeout] of [
      ['', undefined, 37],
      [', timeout: null', undefined, 37],
      [', timeout: 0', undefined, 0],
      [', timeout: 19', 19, 19],
    ] as const) {
      const result = await service.execute(
        {
          query: `mutation { evaluate(content: null, url: "https://example.com/script.js"${argument}) { value } }`,
        },
        context,
      );
      assert.equal(result.errors, undefined);
      assert.deepEqual(api.evaluations.at(-1), {
        content: undefined,
        url: 'https://example.com/script.js',
        timeout,
        executionTimeout,
      });
    }
    await context.close();
  });

  it('bounds the whole evaluation but leaves explicit zero unbounded', async () => {
    const api = new API(options);
    api.delay = 25;
    const service = new BrowserQL({ apiFactory: () => api });
    const context = service.createContext(options);
    const bounded = await service.execute(
      { query: 'mutation { evaluate(content:"1",timeout:1) { value } }' },
      context,
    );
    assert.match(bounded.errors?.[0].message ?? '', /timed out/);
    const unbounded = await service.execute(
      { query: 'mutation { evaluate(content:"1",timeout:0) { value } }' },
      context,
    );
    assert.equal(unbounded.errors, undefined);
    assert.equal((unbounded.data?.evaluate as { value: string }).value, 'ok');
    await context.close();
  });

  it('does not apply the script-fetch deadline to page evaluation', async () => {
    class RuntimeAPI extends BQLBrowserAPI {
      override async start() {
        this.mainCDP = {
          send: async () => {
            await new Promise((resolve) => setTimeout(resolve, 15_000));
            return { result: { value: 'finished' } };
          },
        } as unknown as BQLBrowserAPI['mainCDP'];
      }
      override async close() {}
    }
    const clock = Sinon.useFakeTimers();
    try {
      for (const argument of ['', ', timeout: 0', ', timeout: 12000']) {
        const service = new BrowserQL({
          apiFactory: () => new RuntimeAPI(options),
        });
        const context = service.createContext(options);
        const pending = service.execute(
          {
            query: `mutation { evaluate(content: "'finished'"${argument}) { value } }`,
          },
          context,
        );
        await clock.tickAsync(15_000);
        const result = await pending;
        if (argument === ', timeout: 12000') {
          assert.match(
            result.errors?.[0].message ?? '',
            /timed out after 12000ms/,
          );
        } else {
          assert.equal(result.errors, undefined);
          assert.equal(
            (result.data?.evaluate as { value: string }).value,
            'finished',
          );
        }
        await context.close();
      }
    } finally {
      clock.restore();
    }
  });

  it('retains typed input errors and rejects empty injection content before API startup', async () => {
    let created = 0;
    const service = new BrowserQL({
      apiFactory: () => {
        created++;
        return new API(options);
      },
    });
    const context = service.createContext(options);
    for (const field of [
      'evaluate { value }',
      'evaluate(content:"1",timeout:-1) { value }',
      'addScriptTag(content:"") { time }',
      'addStyleTag(content:"") { time }',
      'waitForSelector(selector:"body",visible:true,hidden:true) { time }',
      'fulfill { time }',
    ]) {
      const result = await service.execute(
        { query: `mutation { ${field} }` },
        context,
      );
      assert.ok(result.errors?.[0].originalError instanceof BadRequest, field);
    }
    assert.equal(created, 0);
    await context.close();
  });

  it('accepts explicitly supplied empty fulfill filters', async () => {
    const service = new BrowserQL({ apiFactory: () => new API(options) });
    const context = service.createContext(options);
    const result = await service.execute(
      { query: 'mutation { fulfill(url:[]) { time } }' },
      context,
    );
    assert.equal(result.errors, undefined);
    assert.equal((result.data?.fulfill as { time: number }).time, 1);
    await context.close();
  });
});
