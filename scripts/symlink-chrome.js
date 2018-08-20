const fs = require('fs');
const { exec } = require('child_process');

const { createBrowserFetcher } = require('puppeteer');
const packageJson = require('puppeteer/package.json');
const CHROME_BINARY_LOCATION = '/usr/bin/google-chrome';

if (fs.existsSync(CHROME_BINARY_LOCATION)) {
  console.log('Chrome binary found, exiting');
  process.exit(0);
} else {
  // Use puppeteer's copy otherwise
  const browserFetcher = createBrowserFetcher();
  const revisionInfo = browserFetcher.revisionInfo(packageJson.puppeteer.chromium_revision);
  executablePath = revisionInfo.executablePath;

  exec(`ln -s ${executablePath} ${CHROME_BINARY_LOCATION}`, (error, stdout, stderr) => {
    if (error || stderr) {
      console.error(`Error establishing symlink: ${error || stderr}`);
      process.exit(1);
    }
    console.log(`Successful symlink of Chrome: ${stdout}`);
    process.exit(0);
  });
}
