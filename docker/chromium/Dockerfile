ARG VERSION=latest

# ============================================================
# Builder stage: compile TypeScript, generate static + extension
# assets, install the debugger. Inherits the full toolchain
# (devDependencies + optionalDependencies) from the base image.
# ============================================================
FROM ghcr.io/browserless/base:$VERSION AS builder
LABEL org.opencontainers.image.source=https://github.com/browserless/browserless

COPY src src/

RUN npm run build && \
    npm run build:function && \
    npm run install:debugger

# ============================================================
# Runtime stage: production-only deps + Chromium + built artifacts.
# `npm prune --omit=dev` strips ~100 MB of build/lint/test tooling.
# ============================================================
FROM ghcr.io/browserless/base:$VERSION
LABEL org.opencontainers.image.source=https://github.com/browserless/browserless

# Drop devDependencies — the base image installs the full tree so the
# builder stage can compile, but the runtime image only needs runtime deps.
RUN npm prune --omit=dev

# NOTE it's important to not use npx playwright-core here since it'll likely install
# a more recent version than we potentially have in our own package.json
RUN ./node_modules/playwright-core/cli.js install --with-deps chromium && \
    apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Pull built artifacts from builder. `static/` and `extensions/` are
# enriched by `npm run build` (adblock filters, devtools, function
# bundle, debugger payload).
COPY --from=builder $APP_DIR/build ./build
COPY --from=builder $APP_DIR/static ./static
COPY --from=builder $APP_DIR/extensions ./extensions

RUN chown -R blessuser:blessuser $APP_DIR

USER blessuser

CMD ["./scripts/start.sh"]
