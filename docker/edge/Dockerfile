ARG VERSION=latest
FROM ghcr.io/browserless/base:$VERSION
LABEL org.opencontainers.image.source=https://github.com/browserless/browserless

COPY src src/

# NOTE it's important to not use npx playwright-core here since it'll likely install
# a more recent version than we potentially have in our own package.json
RUN ./node_modules/playwright-core/cli.js install --with-deps msedge && \
    npm run build && \
    npm run build:function && \
    npm prune production && \
    npm run install:debugger && \
    chown -R blessuser:blessuser $APP_DIR && \
    apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

USER blessuser

CMD ["./scripts/start.sh"]
