FROM ubuntu:20.04

ARG BLESS_USER_ID=999

COPY fonts.conf /etc/fonts/local.conf

# Update base image
RUN apt-get -qq update && \
  apt-get -qq dist-upgrade

# Add the partner repository
RUN apt-get -y -qq install software-properties-common && \
  apt-add-repository "deb http://archive.canonical.com/ubuntu $(lsb_release -sc) partner"

# Accept Microsoft EULA agreement for ttf-mscorefonts-installer
RUN echo "ttf-mscorefonts-installer msttcorefonts/accepted-mscorefonts-eula select true" | debconf-set-selections

# Install dependencies for Chrome / Chromium
RUN apt-get -y -qq --no-install-recommends install \
  build-essential \
  ca-certificates \
  curl \
  dumb-init \
  ffmpeg \
  fontconfig \
  fonts-freefont-ttf \
  fonts-gfs-neohellenic \
  fonts-indic \
  fonts-ipafont-gothic \
  fonts-kacst \
  fonts-liberation \
  fonts-noto-cjk \
  fonts-noto-color-emoji \
  fonts-roboto \
  fonts-thai-tlwg \
  fonts-ubuntu \
  fonts-wqy-zenhei \
  gconf-service \
  git \
  libappindicator1 \
  libappindicator3-1 \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libc6 \
  libcairo2 \
  libcups2 \
  libdbus-1-3 \
  libexpat1 \
  libfontconfig1 \
  libgbm-dev \
  libgbm1 \
  libgcc1 \
  libgconf-2-4 \
  libgdk-pixbuf2.0-0 \
  libglib2.0-0 \
  libgtk-3-0 \
  libnspr4 \
  libnss3 \
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
  locales \
  lsb-release \
  msttcorefonts \
  pdftk \
  unzip \
  wget \
  xdg-utils \
  xvfb

# Only install Adobe Flash on amd64 (not available for other architectures)
RUN if [ "$(dpkg --print-architecture)" = "amd64" ]; then apt-get -qq --no-install-recommends install adobe-flashplugin; fi

# Install NodeJS
RUN curl --silent --location https://deb.nodesource.com/setup_16.x | bash - && \
  apt-get -qq install nodejs && \
  npm install -g npm@latest

# Cleanup
RUN fc-cache -f -v && \
  apt-get -qq clean && \
  rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Add the browserless user (blessuser)
RUN groupadd -r blessuser && useradd --uid ${BLESS_USER_ID} -r -g blessuser -G audio,video blessuser && \
  mkdir -p /home/blessuser/Downloads && \
  chown -R blessuser:blessuser /home/blessuser
