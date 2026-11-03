import { mkdtemp, readFile, rm } from 'fs/promises';
import { AddressInfo } from 'net';
import { createServer } from 'https';
import { execFile } from 'child_process';
import { join } from 'path';
import { promisify } from 'util';
import { tmpdir } from 'os';

const execFileAsync = promisify(execFile);

export interface SelfSignedServer {
  close: () => Promise<void>;
  /** Text served by the page, for asserting the content came through. */
  marker: string;
  url: string;
}

const generateCertificate = async (): Promise<{
  cert: Buffer;
  key: Buffer;
}> => {
  const dir = await mkdtemp(join(tmpdir(), 'browserless-self-signed-'));
  const keyPath = join(dir, 'key.pem');
  const certPath = join(dir, 'cert.pem');

  try {
    await execFileAsync('openssl', [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=DNS:localhost,IP:127.0.0.1',
      '-keyout',
      keyPath,
      '-out',
      certPath,
    ]);

    return {
      cert: await readFile(certPath),
      key: await readFile(keyPath),
    };
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
};

/**
 * Starts a local HTTPS server whose certificate is self-signed and generated
 * on the fly, so tests for `acceptInsecureCerts` do not depend on an external
 * host. The key and certificate only touch disk while openssl writes them;
 * nothing is checked in.
 */
export const startSelfSignedServer = async (): Promise<SelfSignedServer> => {
  const marker = 'self-signed certificate accepted';
  const server = createServer(await generateCertificate(), (_req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(`<html><body>${marker}</body></html>`);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
    marker,
    url: `https://localhost:${port}/`,
  };
};
