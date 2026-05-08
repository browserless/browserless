ARG VERSION=latest

# ============================================================
# Builder stage: compile TypeScript, generate static + extension
# assets, install the debugger. Inherits the full toolchain
# (devDependencies) from the base image.
# ============================================================
FROM ghcr.io/browserless/base:$VERSION AS builder
LABEL org.opencontainers.image.source=https://github.com/browserless/browserless

COPY src src/

RUN npm run build && \
    npm run build:function && \
    npm run install:debugger

# ============================================================
# Runtime stage: production-only deps + Chrome + built artifacts.
# ============================================================
FROM ghcr.io/browserless/base:$VERSION
LABEL org.opencontainers.image.source=https://github.com/browserless/browserless

# Drop devDependencies — base installs the full tree so the builder stage
# can compile, but the runtime image only needs runtime deps.
RUN npm prune --omit=dev

# NOTE it's important to not use npx playwright-core here since it'll likely install
# a more recent version than we potentially have in our own package.json
RUN ./node_modules/playwright-core/cli.js install --with-deps chrome && \
    apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

COPY --from=builder $APP_DIR/build ./build
COPY --from=builder $APP_DIR/static ./static
COPY --from=builder $APP_DIR/extensions ./extensions

RUN chown -R blessuser:blessuser $APP_DIR

USER blessuser

CMD ["./scripts/start.sh"]
