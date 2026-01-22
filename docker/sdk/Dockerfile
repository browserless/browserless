ARG FROM=ghcr.io/divmode/browserless-multi:latest
FROM ${FROM}

ARG FROM
ARG TARGETPLATFORM

# Change to root for install
USER root

# Needed for determining if Chrome is eligible for install
ENV TARGETPLATFORM=${TARGETPLATFORM}
ENV FROM=${FROM}
ENV BLESS_INSTALL_NODE_MODULES=${APP_DIR}/node_modules/@browserless.io/browserless
ENV BLESS_ROUTES=${BLESS_INSTALL_NODE_MODULES}/build/routes

# Cleanup
RUN rm -rf $APP_DIR
RUN mkdir -p $APP_DIR

WORKDIR $APP_DIR

# Copy src
COPY src src
COPY package.json .
COPY package-lock.json .
COPY tsconfig.json .
COPY *README.md .

# Install dependencies
RUN npm clean-install

# Build Source files
RUN npm run build

# Delete Chrome Open Source Routes on linux/arm64
RUN if [ "$TARGETPLATFORM" = "linux/arm64" ]; then \
  rm -rf $BLESS_ROUTES/chrome;\
  fi

# Delete unsupported routes
RUN if  [ -z "${FROM##*chrome*}" ]; then \
  rm -rf $BLESS_ROUTES/chromium;\
  rm -rf $BLESS_ROUTES/edge;\
  rm -rf $BLESS_ROUTES/firefox;\
  rm -rf $BLESS_ROUTES/webkit;\
  fi
RUN if  [ -z "${FROM##*chromium*}" ]; then \
  rm -rf $BLESS_ROUTES/chrome;\
  rm -rf $BLESS_ROUTES/edge;\
  rm -rf $BLESS_ROUTES/firefox;\
  rm -rf $BLESS_ROUTES/webkit;\
  fi
RUN if  [ -z "${FROM##*firefox*}" ]; then \
  rm -rf $BLESS_ROUTES/chrome;\
  rm -rf $BLESS_ROUTES/chromium;\
  rm -rf $BLESS_ROUTES/edge;\
  rm -rf $BLESS_ROUTES/webkit;\
  fi
RUN if  [ -z "${FROM##*webkit*}" ]; then \
  rm -rf $BLESS_ROUTES/chrome;\
  rm -rf $BLESS_ROUTES/chromium;\
  rm -rf $BLESS_ROUTES/edge;\
  rm -rf $BLESS_ROUTES/firefox;\
  fi
RUN if  [ -z "${FROM##*edge*}" ]; then \
  rm -rf $BLESS_ROUTES/chrome;\
  rm -rf $BLESS_ROUTES/chromium;\
  rm -rf $BLESS_ROUTES/firefox;\
  rm -rf $BLESS_ROUTES/webkit;\
  fi

# Back to non-privileged user
USER blessuser

CMD ["npm", "start"]
