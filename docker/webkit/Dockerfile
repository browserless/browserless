ARG VERSION=latest

# ============================================================
# Builder stage: compile TypeScript and generate assets.
# WebKit doesn't ship the function runner or debugger payload.
# ============================================================
FROM ghcr.io/browserless/base:$VERSION AS builder
LABEL org.opencontainers.image.source=https://github.com/browserless/browserless

COPY src src/

RUN npm run build

# ============================================================
# Runtime stage: production-only deps + WebKit + built artifacts.
# Honors INSTALL_WEBKIT_VERSIONS for installing multiple webkit
# versions side-by-side via the helper script.
# ============================================================
FROM ghcr.io/browserless/base:$VERSION
LABEL org.opencontainers.image.source=https://github.com/browserless/browserless

ARG INSTALL_WEBKIT_VERSIONS=false

RUN npm prune --omit=dev

# NOTE it's important to not use npx playwright-core here since it'll likely install
# a more recent version than we potentially have in our own package.json
RUN if [ "$INSTALL_WEBKIT_VERSIONS" = "true" ]; then \
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
