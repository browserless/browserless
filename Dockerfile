FROM browserless/base:latest

# Build Args
ARG USE_CHROME_STABLE

# Application parameters and variables
ENV APP_DIR=/usr/src/app
ENV CONNECTION_TIMEOUT=60000
ENV CHROME_PATH=/usr/bin/google-chrome
ENV ENABLE_XVBF=true
ENV HOST=0.0.0.0
ENV IS_DOCKER=true
ENV NODE_ENV=production
ENV PORT=3000
ENV USE_CHROME_STABLE=${USE_CHROME_STABLE}
ENV WORKSPACE_DIR=$APP_DIR/workspace
ENV LANG="C.UTF-8"

RUN mkdir -p $APP_DIR $WORKSPACE_DIR

WORKDIR $APP_DIR

# Install app dependencies
COPY package.json .
COPY tsconfig.json .
COPY . .

# Install Chrome Stable when specified
RUN if [ "$USE_CHROME_STABLE" = "true" ]; then \
    cd /tmp &&\
    wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb &&\
    dpkg -i google-chrome-stable_current_amd64.deb;\
  fi

# Build
RUN if [ "$USE_CHROME_STABLE" = "true" ]; then \
    export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true;\
    export CHROMEDRIVER_SKIP_DOWNLOAD=false;\
  else \
    export CHROMEDRIVER_SKIP_DOWNLOAD=true;\
  fi &&\
  npm install &&\
  npm run post-install &&\
  npm run build &&\
  chown -R blessuser:blessuser $APP_DIR

# Run everything after as non-privileged user.
USER blessuser

# Expose the web-socket and HTTP ports
EXPOSE 3000
ENTRYPOINT ["dumb-init", "--"]
CMD [ "node", "./build/index.js" ]
