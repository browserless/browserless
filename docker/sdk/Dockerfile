ARG FROM=ghcr.io/browserless/multi:latest
FROM ${FROM}
LABEL org.opencontainers.image.source=https://github.com/browserless/browserless

ARG FROM
ARG TARGETPLATFORM

# Change to root for install
USER root

# Needed for determining if Chrome is eligible for install
ENV TARGETPLATFORM=${TARGETPLATFORM}
ENV FROM=${FROM}
ENV BLESS_INSTALL_NODE_MODULES=${APP_DIR}/node_modules/@browserless.io/browserless
ENV BLESS_ROUTES=${BLESS_INSTALL_NODE_MODULES}/build/routes

RUN rm -rf $APP_DIR && mkdir -p $APP_DIR

WORKDIR $APP_DIR

COPY src src
COPY package.json package-lock.json tsconfig.json README.md ./

# Delete unsupported routes based on base image and platform
RUN npm clean-install && npm run build && \
    if [ "$TARGETPLATFORM" = "linux/arm64" ]; then rm -rf $BLESS_ROUTES/chrome; fi && \
    case "$FROM" in \
      *chromium*) rm -rf $BLESS_ROUTES/chrome $BLESS_ROUTES/edge $BLESS_ROUTES/firefox $BLESS_ROUTES/webkit ;; \
      *chrome*) rm -rf $BLESS_ROUTES/chromium $BLESS_ROUTES/edge $BLESS_ROUTES/firefox $BLESS_ROUTES/webkit ;; \
      *firefox*) rm -rf $BLESS_ROUTES/chrome $BLESS_ROUTES/chromium $BLESS_ROUTES/edge $BLESS_ROUTES/webkit ;; \
      *webkit*) rm -rf $BLESS_ROUTES/chrome $BLESS_ROUTES/chromium $BLESS_ROUTES/edge $BLESS_ROUTES/firefox ;; \
      *edge*) rm -rf $BLESS_ROUTES/chrome $BLESS_ROUTES/chromium $BLESS_ROUTES/firefox $BLESS_ROUTES/webkit ;; \
    esac

USER blessuser

CMD ["npm", "start"]
