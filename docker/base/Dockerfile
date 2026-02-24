FROM ubuntu:24.04

LABEL org.opencontainers.image.source=https://github.com/browserless/browserless

ARG DEBIAN_FRONTEND=noninteractive
ARG TZ=America/Los_Angeles
ARG BLESS_USER_ID=999
ARG APP_DIR=/usr/src/app
ARG NODE_VERSION=v24.14.0
ARG NPM_VERSION=11.10.1

ENV NODE_VERSION=$NODE_VERSION
ENV NVM_DIR=/usr/src/.nvm
ENV NODE_PATH=$NVM_DIR/versions/node/$NODE_VERSION/bin
ENV PATH=$NODE_PATH:$PATH
ENV APP_DIR=$APP_DIR
ENV TZ=$TZ
ENV DEBIAN_FRONTEND=$DEBIAN_FRONTEND
ENV HOST=0.0.0.0
ENV PORT=3000
ENV LANG="C.UTF-8"
ENV NODE_ENV=production
ENV DEBUG_COLORS=true
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PLAYWRIGHT_BROWSERS_PATH=/usr/local/bin/playwright-browsers
ENV DBUS_SESSION_BUS_ADDRESS=autolaunch:

RUN mkdir -p $APP_DIR $NVM_DIR && \
  groupadd -r blessuser && useradd --uid ${BLESS_USER_ID} -r -g blessuser -G audio,video blessuser && \
  mkdir -p /home/blessuser/Downloads && \
  chown -R blessuser:blessuser /home/blessuser

WORKDIR $APP_DIR

COPY fonts/* /usr/share/fonts/truetype/

RUN apt-get update \
  && apt-get install -y --no-install-recommends software-properties-common \
  && add-apt-repository universe \
  && echo "ttf-mscorefonts-installer msttcorefonts/accepted-mscorefonts-eula select true" | debconf-set-selections \
  && add-apt-repository multiverse \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
  ca-certificates \
  curl \
  dumb-init \
  git \
  gnupg \
  libu2f-udev \
  ssh \
  wget \
  xvfb \
  dbus \
  dbus-x11 \
  libwebp-dev \
  python3 python3-pip python3-setuptools \
  # Font packages
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
  fonts-open-sans \
  && update-alternatives --install /usr/bin/pip pip /usr/bin/pip3 1 \
  && update-alternatives --install /usr/bin/python python /usr/bin/python3 1 \
  && fc-cache -f -v \
  && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/* /usr/share/fonts/truetype/noto

RUN curl -sL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | bash &&\
  . $NVM_DIR/nvm.sh &&\
  nvm install $NODE_VERSION &&\
  npm install -g npm@$NPM_VERSION

COPY package.json package-lock.json ./

RUN npm clean-install

COPY assets assets
COPY bin bin
COPY extensions extensions
COPY external external
COPY scripts scripts
COPY static static

COPY CHANGELOG.md LICENSE NOTICE.txt README.md tsconfig.json ./
