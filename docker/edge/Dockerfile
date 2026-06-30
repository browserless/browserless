ARG VERSION=latest

# ============================================================
# Builder stage: compile TypeScript, generate static + extension
# assets, install the debugger.
# ============================================================
FROM ghcr.io/browserless/base:$VERSION AS builder
LABEL org.opencontainers.image.source=https://github.com/browserless/browserless

COPY src src/

RUN npm run build && \
    npm run build:function && \
    npm run install:debugger

# ============================================================
# Runtime stage: production-only deps + Edge + built artifacts.
# ============================================================
FROM ghcr.io/browserless/base:$VERSION
LABEL org.opencontainers.image.source=https://github.com/browserless/browserless

RUN npm prune --omit=dev

# NOTE it's important to not use npx playwright-core here since it'll likely install
# a more recent version than we potentially have in our own package.json
RUN ./node_modules/playwright-core/cli.js install --with-deps msedge && \
    apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

COPY --from=builder $APP_DIR/build ./build
COPY --from=builder $APP_DIR/static ./static
COPY --from=builder $APP_DIR/extensions ./extensions

RUN chown -R blessuser:blessuser $APP_DIR

USER blessuser

CMD ["./scripts/start.sh"]
