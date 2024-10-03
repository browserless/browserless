ARG FROM=ghcr.io/browserless/multi:latest
ARG TARGETPLATFORM

FROM ${FROM}

# Change to root for install
USER root

# Needed for determining if Chrome is eligible for install
ENV TARGETPLATFORM=${TARGETPLATFORM}
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
RUN npm install

# Build Source files
RUN npm run build

# Delete Chrome Open Source Routes on linux/arm64
RUN if [ "$TARGETPLATFORM" = "linux/arm64" ]; then \
  rm -rf $BLESS_ROUTES/chrome;\
  fi

# Back to non-privileged user
USER blessuser

CMD ["npm", "start"]
