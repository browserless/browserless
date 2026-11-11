ARG VERSION=latest

# ============================================================
# Builder stage: compile TypeScript, generate assets, install
# the debugger. Inherits the full toolchain (devDependencies)
# from the base image.
#
# Edge has no arm64 Linux build, so we strip its route folder on
# other platforms and the schema generators skip it.
# ============================================================
FROM ghcr.io/browserless/base:$VERSION AS builder
LABEL org.opencontainers.image.source=https://github.com/browserless/browserless

ARG TARGETPLATFORM
ENV TARGETPLATFORM=${TARGETPLATFORM}

COPY src src/

RUN if [ "$TARGETPLATFORM" != "linux/amd64" ]; then \
      rm -rf ./src/routes/edge; \
    fi && \
    npm run build && \
    npm run build:function && \
    npm run install:debugger

# ============================================================
# Runtime stage: production-only deps + all browsers + artifacts.
# ============================================================
FROM ghcr.io/browserless/base:$VERSION
LABEL org.opencontainers.image.source=https://github.com/browserless/browserless

ARG TARGETPLATFORM
ENV TARGETPLATFORM=${TARGETPLATFORM}
ARG INSTALL_WEBKIT_VERSIONS=false

RUN npm prune --omit=dev

# NOTE it's important to not use npx playwright-core here since it'll likely install
# a more recent version than we potentially have in our own package.json
RUN node node_modules/playwright-core/cli.js install chromium firefox && \
    bash ./scripts/install-chrome.sh && \
    if [ "$TARGETPLATFORM" = "linux/amd64" ]; then \
      ./node_modules/playwright-core/cli.js install --with-deps msedge; \
    fi && \
    if [ "$INSTALL_WEBKIT_VERSIONS" = "true" ]; then \
      bash ./scripts/install-versioned-browsers.sh webkit; \
    else \
      node node_modules/playwright-core/cli.js install --with-deps webkit; \
    fi && \
    apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

COPY --from=builder $APP_DIR/build ./build
COPY --from=builder $APP_DIR/static ./static
COPY --from=builder $APP_DIR/extensions ./extensions

RUN chown -R blessuser:blessuser $APP_DIR

USER blessuser

CMD ["./scripts/start.sh"]
