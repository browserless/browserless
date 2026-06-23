import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Extract a `.zip` using the system `unzip` binary instead of a yauzl-based
 * Node extractor (e.g. the `extract-zip` package).
 *
 * yauzl/fd-slicer rely on a stream `'close'` event that no longer fires after
 * EOF on Node >= 24.16.0 (nodejs/node#63487), which deadlocks mid-extraction on
 * larger archives. As a standalone build script the deadlocked promise just lets
 * the event loop drain, so the process exits 0 with the target left empty — a
 * silent failure. This is the same Node 24.16 bug, and the same `unzip`
 * workaround, as scripts/install-versioned-browsers.sh (commit a261f381).
 * `unzip` is installed in the base Docker image and ships with macOS and most
 * Linux dev environments.
 *
 * @param {string} zipPath Path to the `.zip` archive
 * @param {string} destDir Directory to extract into (created if missing)
 */
export const extractZip = async (zipPath, destDir) => {
  try {
    // -q: quiet; -o: overwrite existing files without prompting (an interactive
    // prompt would hang a non-interactive build).
    await execFileAsync('unzip', ['-q', '-o', zipPath, '-d', destDir]);
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(
        `Cannot extract "${zipPath}": the "unzip" binary was not found on PATH. ` +
          `Install it and re-run — e.g. "brew install unzip" (macOS), ` +
          `"apt-get install unzip" (Debian/Ubuntu), or "apk add unzip" (Alpine).`,
      );
    }
    // Non-zero exit (e.g. a corrupt/partial download): surface unzip's own
    // stderr so the cause is visible rather than a bare exit code.
    const detail = (err.stderr || err.message || '').toString().trim();
    throw new Error(
      `Failed to unzip "${zipPath}" into "${destDir}": ${detail}`,
    );
  }
};
