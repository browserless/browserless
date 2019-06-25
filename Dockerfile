FROM ubuntu:18.04

# Application parameters and variables
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV application_directory=/usr/src/app
ENV ENABLE_XVBF=true
ENV CHROMEDRIVER_SKIP_DOWNLOAD=true

# Build Args
ARG USE_CHROME_STABLE

# Configuration for Chrome
ENV CONNECTION_TIMEOUT=60000
ENV CHROME_PATH=/usr/bin/google-chrome
ENV USE_CHROME_STABLE=${USE_CHROME_STABLE}

RUN mkdir -p $application_directory

WORKDIR $application_directory

# Install app dependencies
COPY package.json .
COPY tsconfig.json .

# Bundle app source
COPY . .

# Dependencies + NodeJS
RUN apt-get -qq update && \
  echo "ttf-mscorefonts-installer msttcorefonts/accepted-mscorefonts-eula select true" | debconf-set-selections && \
  apt-get -y -qq install software-properties-common &&\
  apt-add-repository "deb http://archive.canonical.com/ubuntu $(lsb_release -sc) partner" && \
  apt-add-repository ppa:malteworld/ppa && apt-get -qq update && apt-get -y -qq install \
  adobe-flashplugin \
  msttcorefonts \
  fonts-noto-color-emoji \
  fonts-noto-cjk \
  fonts-liberation \
  fonts-thai-tlwg \
  fonts-indic \
  fontconfig \
  libappindicator3-1 \
  pdftk \
  unzip \
  locales \
  gconf-service \
  libasound2 \
  libatk1.0-0 \
  libc6 \
  libcairo2 \
  libcups2 \
  libdbus-1-3 \
  libexpat1 \
  libfontconfig1 \
  libgcc1 \
  libgconf-2-4 \
  libgdk-pixbuf2.0-0 \
  libglib2.0-0 \
  libgtk-3-0 \
  libnspr4 \
  libpango-1.0-0 \
  libpangocairo-1.0-0 \
  libstdc++6 \
  libx11-6 \
  libx11-xcb1 \
  libxcb1 \
  libxcomposite1 \
  libxcursor1 \
  libxdamage1 \
  libxext6 \
  libxfixes3 \
  libxi6 \
  libxrandr2 \
  libxrender1 \
  libxss1 \
  libxtst6 \
  ca-certificates \
  libappindicator1 \
  libnss3 \
  lsb-release \
  xdg-utils \
  wget \
  xvfb \
  curl &&\
  # Install Node
  curl --silent --location https://deb.nodesource.com/setup_10.x | bash - &&\
  apt-get -y -qq install nodejs &&\
  apt-get -y -qq install build-essential &&\
  # Fonts
  fc-cache -f -v

# It's a good idea to use dumb-init to help prevent zombie chrome processes.
ADD https://github.com/Yelp/dumb-init/releases/download/v1.2.0/dumb-init_1.2.0_amd64 /usr/local/bin/dumb-init
RUN chmod +x /usr/local/bin/dumb-init

# Install Chrome Stable when specified
RUN if [ "$USE_CHROME_STABLE" = "true" ]; then \
    cd /tmp &&\
    wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb &&\
    dpkg -i google-chrome-stable_current_amd64.deb;\
  fi

# Build
RUN if [ "$USE_CHROME_STABLE" = "true" ]; then \
    export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true;\
  fi &&\
  npm install -g typescript @types/node &&\
  npm install &&\
  npm run build &&\
  npm run symlink-chrome &&\
  npm run install-chromedriver &&\
  npm run meta

# Cleanup
RUN apt-get -qq clean && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Add user
RUN groupadd -r blessuser && useradd -r -g blessuser -G audio,video blessuser \
  && mkdir -p /home/blessuser/Downloads \
  && chown -R blessuser:blessuser /home/blessuser \
  && chown -R blessuser:blessuser $application_directory

# Run everything after as non-privileged user.
USER blessuser

# Expose the web-socket and HTTP ports
EXPOSE 3000
ENTRYPOINT ["dumb-init", "--"]
CMD [ "node", "./build/index.js" ]
