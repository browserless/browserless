# syntax=edrevo/dockerfile-plus
INCLUDE+ base/Dockerfile

# Build Args
ARG USE_CHROME_STABLE
ARG PUPPETEER_CHROMIUM_REVISION
ARG PUPPETEER_VERSION

# Application parameters and variables
ENV APP_DIR=/usr/src/app
ENV CONNECTION_TIMEOUT=60000
ENV CHROME_PATH=/usr/bin/google-chrome
ENV HOST=0.0.0.0
ENV IS_DOCKER=true
ENV LANG="C.UTF-8"
ENV NODE_ENV=production
ENV PORT=3000
ENV PUPPETEER_CHROMIUM_REVISION=${PUPPETEER_CHROMIUM_REVISION}
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV USE_CHROME_STABLE=${USE_CHROME_STABLE}
ENV WORKSPACE_DIR=$APP_DIR/workspace

RUN mkdir -p $APP_DIR $WORKSPACE_DIR

WORKDIR $APP_DIR

# Bundle code
COPY . .

# Install Chrome Stable when specified
RUN if [ "$USE_CHROME_STABLE" = "true" ]; then \
    if [ "$(dpkg --print-architecture)" != "amd64" ]; then echo "Chrome Stable is only available for amd64" && exit 1; fi && \
    cd /tmp &&\
    wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb &&\
    dpkg -i google-chrome-stable_current_amd64.deb;\
  fi

# Install Chromium on non-amd64 architectures
# From https://askubuntu.com/a/1206153
RUN if [ "$(dpkg --print-architecture)" != "amd64" ]; then \
    cp docker/debian.list /etc/apt/sources.list.d/ && \
    cp docker/chromium.pref /etc/apt/preferences.d/ && \
    apt-key adv --keyserver keyserver.ubuntu.com --recv-keys DCC9EFBF77E11517 && \
    apt-key adv --keyserver keyserver.ubuntu.com --recv-keys 648ACFD622F3D138 && \
    apt-key adv --keyserver keyserver.ubuntu.com --recv-keys AA8E81B4331F7F50 && \
    apt-key adv --keyserver keyserver.ubuntu.com --recv-keys 112695A0E562B32A && \
    apt-get -qq update && apt-get -qq install chromium; \
  fi

# Build and install external binaries + assets
RUN if [ "$USE_CHROME_STABLE" = "true" ]; then \
    export CHROMEDRIVER_SKIP_DOWNLOAD=false; \
  else \
    export CHROMEDRIVER_SKIP_DOWNLOAD=true; \
  fi; \
  npm ci && \
  npm i puppeteer@$PUPPETEER_VERSION && \
  npm run postinstall && \
  npm run build && \
  chown -R blessuser:blessuser $APP_DIR

# Cleanup
RUN fc-cache -f -v && \
  apt-get -qq clean && \
  rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Run everything after as non-privileged user.
USER blessuser

# Expose the web-socket and HTTP ports
EXPOSE 3000

CMD ["./start.sh"]
