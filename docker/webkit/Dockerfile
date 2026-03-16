ARG VERSION=latest
FROM ghcr.io/browserless/base:$VERSION
LABEL org.opencontainers.image.source=https://github.com/browserless/browserless

ARG INSTALL_WEBKIT_VERSIONS=false

COPY src src/

# NOTE it's important to not use npx playwright-core here since it'll likely install
# a more recent version than we potentially have in our own package.json
RUN if [ "$INSTALL_WEBKIT_VERSIONS" = "true" ]; then \
    bash ./scripts/install-versioned-browsers.sh webkit; \
  else \
    node node_modules/playwright-core/cli.js install webkit; \
  fi && \
    npm run build && \
    npm prune production && \
    chown -R blessuser:blessuser $APP_DIR && \
    apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

USER blessuser

CMD ["./scripts/start.sh"]
