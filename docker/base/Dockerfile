FROM ubuntu:20.04

LABEL org.opencontainers.image.source https://github.com/browserless/chrome

ARG DEBIAN_FRONTEND=noninteractive
ARG TZ=America/Los_Angeles
ARG BLESS_USER_ID=999
ARG APP_DIR=/usr/src/app
ARG NODE_VERSION=v18.18.0

ENV NODE_VERSION=$NODE_VERSION
ENV NVM_DIR /usr/src/.nvm
ENV NODE_PATH $NVM_DIR/versions/node/$NODE_VERSION/bin
ENV PATH $NODE_PATH:$PATH
ENV APP_DIR=$APP_DIR
ENV TZ=$TZ
ENV DEBIAN_FRONTEND=$DEBIAN_FRONTEND
ENV HOST=0.0.0.0
ENV PORT=3000
ENV LANG="C.UTF-8"
ENV NODE_ENV=production
ENV DEBUG_COLORS=true
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PLAYWRIGHT_BROWSERS_PATH=$APP_DIR/installed-browsers

RUN mkdir -p $APP_DIR $NVM_DIR

WORKDIR $APP_DIR

COPY assets assets
COPY bin bin
COPY extensions extensions
COPY external external
COPY scripts scripts
COPY static static

COPY CHANGELOG.md .
COPY LICENSE .
COPY NOTICE.txt .
COPY package.json .
COPY package-lock.json .
COPY README.md .
COPY tsconfig.json .

RUN apt-get update && apt-get install -y \
  ca-certificates \
  curl \
  dumb-init \
  git \
  gnupg \
  libu2f-udev \
  software-properties-common \
  ssh \
  wget \
  xvfb

RUN curl -sL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.3/install.sh | bash &&\
  . $NVM_DIR/nvm.sh &&\
  nvm install $NODE_VERSION

RUN add-apt-repository universe && apt-get update && \
  apt-get install -y python3.10 python3-pip && \
  update-alternatives --install /usr/bin/pip pip /usr/bin/pip3 1 && \
  update-alternatives --install /usr/bin/python python /usr/bin/python3 1

RUN groupadd -r blessuser && useradd --uid ${BLESS_USER_ID} -r -g blessuser -G audio,video blessuser && \
  mkdir -p /home/blessuser/Downloads && \
  chown -R blessuser:blessuser /home/blessuser

RUN npm i --production=false
