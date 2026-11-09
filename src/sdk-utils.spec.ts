import { expect } from 'chai';
import fs from 'fs/promises';
import getPort from 'get-port';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import os from 'os';
import path from 'path';

import { buildTypeScript } from '@browserless.io/browserless';

describe('SDK utils', () => {
  let workspaceDir: string;
  let projectDir: string;

  beforeEach(async () => {
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'browserless-sdk-'));
    const absoluteProjectDir = path.join(workspaceDir, 'packages', 'sdk');
    await fs.mkdir(absoluteProjectDir, { recursive: true });
    projectDir = path.relative(process.cwd(), absoluteProjectDir);
  });

  afterEach(async () => {
    await fs.rm(workspaceDir, { force: true, recursive: true });
  });

  it('resolves TypeScript from a relative project and passes arguments literally', async () => {
    const tscDir = path.join(workspaceDir, 'node_modules', 'typescript', 'bin');
    const argsFile = path.join(workspaceDir, 'args.json');
    const marker = path.join(workspaceDir, 'injected');
    const buildDir = `build; touch ${marker}; #`;

    await fs.mkdir(tscDir, { recursive: true });
    await fs.writeFile(
      path.join(tscDir, 'tsc'),
      `require('fs').writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));\n`,
    );

    await buildTypeScript(buildDir, projectDir);

    const markerExists = await fs.stat(marker).then(
      () => true,
      () => false,
    );
    expect(markerExists).to.equal(false);
    expect(JSON.parse(await fs.readFile(argsFile, 'utf8'))).to.deep.equal([
      '--outDir',
      buildDir,
    ]);
  });

  for (const customHooks of [true, false]) {
    it(`runs queued CLI routes with a custom Limiter and ${customHooks ? 'custom' : 'default'} hooks`, async () => {
      const sdk = JSON.stringify(
        pathToFileURL(path.resolve('build/exports.js')).href,
      );
      const buildDir = path.join(projectDir, 'build');
      const routesDir = path.resolve(projectDir, 'empty-routes');
      const results = path.resolve(projectDir, 'after.json');
      await fs.mkdir(buildDir);
      await fs.mkdir(routesDir);
      await fs.writeFile(
        path.join(projectDir, 'package.json'),
        JSON.stringify({
          type: 'module',
          browserless: { webhooks: 'notifications.ts' },
        }),
      );
      for (const [file, name] of [
        ['config', 'Config'],
        ['metrics', 'Metrics'],
        ['monitoring', 'Monitoring'],
        ['notifications', 'WebHooks'],
      ]) {
        await fs.writeFile(
          path.join(buildDir, `${file}.js`),
          `export { ${name} as default } from ${sdk};`,
        );
      }
      await fs.writeFile(
        path.join(buildDir, 'limiter.js'),
        `import { Limiter } from ${sdk};
       export default class CustomLimiter extends Limiter {}`,
      );
      if (customHooks)
        await fs.writeFile(
          path.join(buildDir, 'hooks.js'),
          `import { Hooks } from ${sdk};
       import { writeFile } from 'node:fs/promises';
       export default class CustomHooks extends Hooks {
         async after({ status }) {
           await writeFile(${JSON.stringify(results)}, JSON.stringify(status));
         }
       }`,
        );
      await fs.writeFile(
        path.join(buildDir, 'test.http.js'),
        `import { HTTPRoute, Methods, contentTypes, writeResponse } from ${sdk};
       export default class TestRoute extends HTTPRoute {
         name = 'TestRoute'; path = '/sdk-test'; method = Methods.get;
         accepts = [contentTypes.any]; contentTypes = [contentTypes.text];
         auth = true; browser = null; concurrency = true;
         async handler(req, res) {
           if (req.url.includes('fail')) throw new Error('Test route failure');
           writeResponse(res, 200, 'ok', contentTypes.text);
         }
       }`,
      );
      const port = await getPort();
      const child = spawn(
        process.execPath,
        [path.resolve('bin/browserless.js'), 'start'],
        {
          cwd: projectDir,
          env: {
            ...process.env,
            PORT: String(port),
            HOST: '127.0.0.1',
            TOKEN: 'sdk-test',
            ROUTES: routesDir,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      let output = '';
      child.stdout.on('data', (data) => (output += data));
      child.stderr.on('data', (data) => (output += data));
      const exited = once(child, 'exit');
      const waitFor = async (check: () => Promise<boolean>) => {
        const deadline = Date.now() + 10_000;
        while (!(await check())) {
          if (child.exitCode !== null || Date.now() > deadline) {
            throw new Error(
              `CLI did not complete the request/after hook:\n${output}`,
            );
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      };
      try {
        for (const [query, status, after] of [
          ['', 200, 'successful'],
          ['&fail=1', 500, 'error'],
        ] as const) {
          await fs.rm(results, { force: true });
          let response: Response | undefined;
          await waitFor(async () => {
            response = await fetch(
              `http://127.0.0.1:${port}/sdk-test?token=sdk-test${query}`,
              {
                signal: AbortSignal.timeout(1000),
              },
            ).catch(() => undefined);
            return response !== undefined;
          });
          const body = await response!.text();
          expect(response!.status, `${body}\n${output}`).to.equal(status);
          if (customHooks)
            await waitFor(() =>
              fs.readFile(results, 'utf8').then(
                (value) => value === JSON.stringify(after),
                () => false,
              ),
            );
        }
        expect(child.exitCode, output).to.equal(null);
      } finally {
        child.kill('SIGKILL');
        await exited;
      }
    });
  }
});
