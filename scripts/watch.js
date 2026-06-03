#!/usr/bin/env node
/* global console, process */
'use strict';

import { spawn } from 'child_process';
import { watch } from 'fs';
import path from 'path';

/**
 * Live-rebuild dev loop.
 *
 * Routes are not hot-swappable: `getRouteFiles()` scans the `build/routes`
 * directory and `Browserless.start()` dynamically imports + registers every
 * route exactly once, at process startup (see src/browserless.ts). There is no
 * in-process route reload, so the only reliable way to pick up a new or changed
 * route is to restart the node process. This script wires up three watchers
 * that cooperate to make that fast and automatic:
 *
 *   1. `tsc --watch`    incrementally recompiles src/ -> build/.
 *   2. `node --watch`   restarts the server whenever anything under build/
 *                       changes, which re-runs the route scan with the fresh
 *                       compiled output.
 *   3. build-schemas    regenerates the per-route *.json validation/doc schemas
 *                       (debounced) when a route's *.ts source changes. Those
 *                       JSON writes land in build/ and therefore also trip the
 *                       node --watch restart, so the server picks them up too.
 *
 * Heavy one-time assets (adblock list, devtools snapshot, debugger, function
 * bundle) are produced by a one-shot `build:dev` that runs first, below. That
 * prep step is intentionally NOT a gate: if it fails (e.g. a TypeScript error),
 * we still bring up the watchers so the dev loop is available to fix the very
 * breakage that caused the failure. `node --watch` keeps the server process
 * alive across a crashing first boot and recovers once the tree compiles again.
 *
 * Set WATCH_SCHEMAS=false to skip schema regeneration (the slowest step) if you
 * are not touching request/response shapes.
 */

const cwd = process.cwd();
const isWin = process.platform === 'win32';
const watchSchemas = process.env.WATCH_SCHEMAS !== 'false';

// Resolve a binary installed by a dependency (e.g. tsc, env-cmd). On Windows
// npm installs `.cmd` shims, which must be run through a shell.
const localBin = (name) =>
  path.join(cwd, 'node_modules', '.bin', isWin ? `${name}.cmd` : name);

const children = [];

// Spawning with shell: true (required for Windows .cmd shims) means a plain
// child.kill() only reaches the shell wrapper, leaving the node/tsc descendants
// running and the dev port bound. Kill the whole tree instead: taskkill /t on
// Windows, and the child's process group (negative pid, enabled by detached)
// on POSIX.
const killTree = (child) => {
  if (!child || !child.pid) return;
  try {
    if (isWin) {
      spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
        stdio: 'ignore',
      });
    } else {
      process.kill(-child.pid, 'SIGTERM');
    }
  } catch {
    // The process (group) may already be gone; fall back to a direct kill.
    try {
      child.kill('SIGTERM');
    } catch {
      // Already dead.
    }
  }
};

const run = (label, command, args, { shell = false, onStdout } = {}) => {
  // When a caller wants to inspect output (e.g. to detect tsc's first compile)
  // we pipe stdout and forward it; otherwise inherit straight through.
  const stdio = onStdout ? ['inherit', 'pipe', 'inherit'] : 'inherit';
  // detached on POSIX puts the child in its own process group so killTree can
  // signal the entire group on shutdown; Windows relies on taskkill /t instead.
  const child = spawn(command, args, { cwd, detached: !isWin, shell, stdio });
  children.push(child);
  if (onStdout && child.stdout) {
    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk);
      onStdout(chunk.toString());
    });
  }
  child.on('error', (err) => {
    console.error(`[watch] failed to start ${label}: ${err.message}`);
  });
  child.on('exit', (code, signal) => {
    // tsc / the server exiting unexpectedly should bring the whole loop down
    // so the user isn't left with a half-running dev environment.
    if (shuttingDown) return;
    console.error(
      `[watch] ${label} exited (code=${code}, signal=${signal}); shutting down.`,
    );
    shutdown(code ?? 1);
  });
  return child;
};

let shuttingDown = false;
const shutdown = (code = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    killTree(child);
  }
  process.exit(code);
};

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

// 2. Run the server under node --watch so it restarts (and re-scans routes)
//    whenever build/ changes. --watch-path=./build watches the whole compiled
//    tree rather than only the modules reachable from the entrypoint, so newly
//    added route files are picked up too. env-cmd loads .env first.
//
//    The server is NOT started here: tsc's initial --watch compile re-emits
//    into build/ a moment after launch, which node --watch would see as a
//    change and restart on — booting the server twice. Instead we wait for
//    tsc's first compile to finish (see below) and start the server once,
//    after build/ has settled.
let serverStarted = false;
const startServer = () => {
  if (serverStarted || shuttingDown) return;
  serverStarted = true;
  run(
    'server',
    localBin('env-cmd'),
    [
      '-f',
      '.env',
      'node',
      '--watch-path=./build',
      '--watch-preserve-output',
      'build/index.js',
    ],
    { shell: isWin },
  );
};

const startWatchers = () => {
  if (shuttingDown) return;

  // 1. Keep build/ in sync with src/. --preserveWatchOutput stops tsc from
  //    clearing the screen on every recompile and stomping the server logs.
  //    We scan tsc's output for its "Watching for file changes" banner, which
  //    it prints once the (re)compile is done, and only then boot the server so
  //    the first build/ write doesn't trigger an immediate node --watch restart.
  run('tsc', localBin('tsc'), ['--watch', '--preserveWatchOutput'], {
    onStdout: (text) => {
      if (/Watching for file changes/.test(text)) startServer();
    },
    shell: isWin,
  });

  // Fallback: if tsc's banner never matches (e.g. a future flag change), start
  // the server anyway after a short grace period so the loop is never stuck.
  setTimeout(startServer, 15000);

  // 3. Regenerate per-route JSON schemas when route sources change. tsc needs a
  //    moment to emit the updated .d.ts files that build-schemas reads, so this
  //    is debounced; the resulting JSON writes also trigger the server restart.
  if (watchSchemas) {
    let timer = null;
    let running = false;
    let pending = false;

    const rebuildSchemas = () => {
      if (running) {
        pending = true;
        return;
      }
      running = true;
      console.error('[watch] regenerating route schemas...');
      const child = spawn(process.execPath, ['scripts/build-schemas.js'], {
        cwd,
        detached: !isWin,
        stdio: 'inherit',
      });
      children.push(child);
      child.on('exit', () => {
        running = false;
        if (pending) {
          pending = false;
          rebuildSchemas();
        }
      });
    };

    const onChange = (_event, filename) => {
      if (!filename || !filename.endsWith('.ts') || filename.endsWith('.d.ts')) {
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(rebuildSchemas, 2000);
    };

    watch(path.join(cwd, 'src', 'routes'), { recursive: true }, onChange);
    watch(path.join(cwd, 'src', 'shared'), { recursive: true }, onChange);
  }

  console.error(
    `[watch] watching src/ — edit a file to recompile & restart the server. ${
      watchSchemas ? '' : '(schema regen disabled) '
    }Ctrl-C to stop.`,
  );
};

// Build the heavy one-time assets and produce an initial compile before
// watching. This is deliberately not gated: even if it fails we proceed to
// startWatchers() so the dev loop comes up and can fix the breakage.
console.error('[watch] running initial build:dev (assets + compile)...');
const prep = spawn(isWin ? 'npm.cmd' : 'npm', ['run', 'build:dev'], {
  cwd,
  detached: !isWin,
  shell: isWin,
  stdio: 'inherit',
});
children.push(prep);
prep.on('error', (err) => {
  console.error(`[watch] failed to run build:dev: ${err.message}`);
  startWatchers();
});
prep.on('exit', (code) => {
  if (code !== 0) {
    console.error(
      `[watch] initial build:dev exited (code=${code}); starting watchers anyway.`,
    );
  }
  startWatchers();
});
