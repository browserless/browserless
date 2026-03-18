ARG VERSION=latest
FROM ghcr.io/browserless/base:$VERSION
LABEL org.opencontainers.image.source=https://github.com/browserless/browserless

ARG TARGETPLATFORM
ENV TARGETPLATFORM=${TARGETPLATFORM}
ARG INSTALL_WEBKIT_VERSIONS=false

COPY src src/

# Chrome stable and Edge is only supported on non-ARM builds
# so it's installation is conditional on whether or not amd64
RUN if [ "$TARGETPLATFORM" = "linux/amd64" ]; then \
    ./node_modules/playwright-core/cli.js install --with-deps chrome msedge; \
  else \
    rm -rf ./src/routes/chrome ./src/routes/edge; \
  fi && \
  # NOTE it's important to not use npx playwright-core here since it'll likely install
  # a more recent version than we potentially have in our own package.json
  node node_modules/playwright-core/cli.js install chromium firefox && \

  if [ "$INSTALL_WEBKIT_VERSIONS" = "true" ]; then \
    bash ./scripts/install-versioned-browsers.sh webkit; \
  else \
    node node_modules/playwright-core/cli.js install --with-deps webkit; \
  fi && \
  npm run build &&\
  npm run build:function &&\
  npm prune production &&\
  npm run install:debugger &&\
  chown -R blessuser:blessuser $APP_DIR &&\
  apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

USER blessuser

CMD ["./scripts/start.sh"]
