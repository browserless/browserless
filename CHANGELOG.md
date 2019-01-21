# 1.1.0

With 1.1.0 we offer a refined way of dealing with both downloads and uploads. Both use-cases are tightly coupled to the file-system, and can leave you scratching your head as to what's going one. For more information and detailed documentation, please refer to our doc-site at https://docs.browserless.io/

## Minor Changes
- New `WORKSPACE_DIR` variable for controlling where browserless stores files and uploads.
- New `/workspace` API for doing RESTful operations on the downloads/uploads file-system.
- New `/download` API for running a puppeteer-script, and responding with the resulting downloaded file.

## Internal Changes
- Moved routes out of the browserless module and into their own file/module.
- Renamed the `browserless-web-service` module to just `browserless` for simplicity.
- Moved the `DOWNLOAD_DIR` to `WORKSPACE_DIR` since it handles both uploads and downloads.

# 1.0.0

🥁 -- Stable version 1.0 is here! While this doesn't include major functionality changes, it _does_ change how the docker builds are generated going forward. The versioning will now contain two pieces of crucial information: the version of the _browserless_ service + the version of Chrome under-the-hood. For instance `1.2.3-puppeteer-1.10.0` is browserless at `1.2.3`, exposing puppeteer at `1.10.0`.

Similar to how NodeJS itself does docker releases, we'll now provide releases in 3 distinct ways:

- An _immutable_, pinned version release: `1.0.0-puppeteer-1.11.0`
- A mutable minor version release: `1.1-puppeteer-1.12.0`
- A mutable major version release: `1-puppeteer-1.9.0`

For production deployments, we recommend using _pinned_ version releases as they won't change once released. The mutable minor/major releases will receive on-going updates whenever we do changes that are bug-fixes or feature release. Even with the best intentions it's possible that instability can be introduced with these mutable images, hence why recommend the pinned version releases.

Finally, we'll continue to ship support for the last 5 minor versions of Puppeteer + the Google Chrome (stable). Old images will remain, but newer versions of browserless won't be included.

We'll continue to keep this changelog up-to-date anytime we do docker releases.
