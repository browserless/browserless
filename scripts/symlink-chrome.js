const fs = require('fs');
const { promisify } = require('util');
const { exec: nodeExec } = require('child_process');
const execAsync = promisify(nodeExec);

const {
  IS_DOCKER,
  CHROME_BINARY_LOCATION,
  PUPPETEER_BINARY_LOCATION
} = require('../env');

const exec = async (command) => {
  const { stdout, stderr } = await execAsync(command);

  if (stderr.trim().length) {
    console.error(stderr);
    return process.exit(1);
  }

  return stdout.trim();
};

// If we're in docker, and this isn't a chrome-stable build,
// symlink where chrome-stable should be back to puppeteer's build
if (IS_DOCKER && !fs.existsSync(CHROME_BINARY_LOCATION)) {
  (async () => {
    console.log(`Symlinking chrome from ${CHROME_BINARY_LOCATION} to ${PUPPETEER_BINARY_LOCATION}`);
    await exec(`ln -s ${PUPPETEER_BINARY_LOCATION} ${CHROME_BINARY_LOCATION}`);
  })();
}
