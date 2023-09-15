FROM ubuntu:lunar

ARG DEBIAN_FRONTEND=noninteractive
ARG TZ=America/Los_Angeles
ARG BLESS_USER_ID=999
ARG APP_DIR=/usr/src/app

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

# Setup
RUN mkdir -p $APP_DIR

# Working Dir
WORKDIR $APP_DIR

# Copy Shared assets
COPY static static
COPY extensions extensions
COPY package.json .
COPY package-lock.json .
COPY tsconfig.json .
COPY gulpfile.js .
COPY gulp.utils.js .
COPY README.md .
COPY CHANGELOG.md .
COPY LICENSE .
COPY NOTICE.txt .
COPY start.sh .
COPY test.sh .
COPY .mocharc.json .

# Install node16/dumb-init
RUN apt-get update && apt-get install -y curl && \
  curl -sL https://deb.nodesource.com/setup_18.x | bash - && \
  apt-get install -y nodejs dumb-init xvfb

# Feature-parity with node.js base images.
RUN apt-get update && apt-get install -y --no-install-recommends \
  git \
  ssh \
  wget \
  libu2f-udev \
  software-properties-common

# Install Python 3.10
RUN add-apt-repository universe && apt-get update && \
  apt-get install -y python3.10 python3-pip && \
  update-alternatives --install /usr/bin/pip pip /usr/bin/pip3 1 && \
  update-alternatives --install /usr/bin/python python /usr/bin/python3 1

# Add the browserless user (blessuser)
RUN groupadd -r blessuser && useradd --uid ${BLESS_USER_ID} -r -g blessuser -G audio,video blessuser && \
  mkdir -p /home/blessuser/Downloads && \
  chown -R blessuser:blessuser /home/blessuser

# Install all dependencies
RUN npm i --production=false
