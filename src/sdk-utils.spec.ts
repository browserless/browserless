import { expect } from 'chai';
import fs from 'fs/promises';
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
});
