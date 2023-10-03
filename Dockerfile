ARG BASE_VERSION=1.60.1
ARG BASE_REPO=browserless/base
FROM ${BASE_REPO}:${BASE_VERSION}

# Build Args
ARG USE_CHROME_STABLE
ARG CHROME_STABLE_VERSION
ARG PUPPETEER_CHROMIUM_REVISION
ARG PUPPETEER_VERSION
ARG PORT=3000

# Application parameters and variables
ENV APP_DIR=/usr/src/app
ENV PUPPETEER_CACHE_DIR=${APP_DIR}
ENV PLAYWRIGHT_BROWSERS_PATH=${APP_DIR}
ENV CONNECTION_TIMEOUT=60000
ENV CHROME_PATH=/usr/bin/google-chrome
ENV HOST=0.0.0.0
ENV IS_DOCKER=true
ENV LANG="C.UTF-8"
ENV NODE_ENV=production
ENV PORT=${PORT}
ENV PUPPETEER_CHROMIUM_REVISION=${PUPPETEER_CHROMIUM_REVISION}
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV USE_CHROME_STABLE=${USE_CHROME_STABLE}
ENV WORKSPACE_DIR=$APP_DIR/workspace

RUN mkdir -p $APP_DIR $WORKSPACE_DIR

WORKDIR $APP_DIR

# Install app dependencies
COPY . .

# Install Chrome Stable when specified
RUN if [ -n "$CHROME_STABLE_VERSION" ]; then \
    wget -q -O /tmp/chrome.deb https://dl.google.com/linux/chrome/deb/pool/main/g/google-chrome-stable/google-chrome-stable_${CHROME_STABLE_VERSION}-1_amd64.deb && \
    apt install -y /tmp/chrome.deb &&\
    rm /tmp/chrome.deb; \
  elif [ "$USE_CHROME_STABLE" = "true" ]; then \
    cd /tmp &&\
    wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb &&\
    dpkg -i google-chrome-stable_current_amd64.deb;\
  fi

# Build and install external binaries + assets
# NOTE: The `PUPPETEER_VERSION` is needed for production versions
# listed in package.json
RUN if [ "$USE_CHROME_STABLE" = "true" ]; then \
    export CHROMEDRIVER_SKIP_DOWNLOAD=false;\
  else \
    export CHROMEDRIVER_SKIP_DOWNLOAD=true;\
  fi &&\
  npm i puppeteer@$PUPPETEER_VERSION;\
  npm run postinstall &&\
  npm run build &&\
  npm prune --production &&\
  chown -R blessuser:blessuser $APP_DIR

# Run everything after as non-privileged user.
USER blessuser

# Expose the web-socket and HTTP ports
EXPOSE ${PORT}

CMD ["./start.sh"]
