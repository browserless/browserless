FROM ubuntu:18.04

# Dependencies + NodeJS
RUN apt-get -qq update && \
  echo "ttf-mscorefonts-installer msttcorefonts/accepted-mscorefonts-eula select true" | debconf-set-selections && \
  apt-get -y -qq install software-properties-common &&\
  apt-add-repository "deb http://archive.canonical.com/ubuntu $(lsb_release -sc) partner" && \
  apt-add-repository ppa:malteworld/ppa && apt-get -qq update && apt-get -y -qq --no-install-recommends install \
  dumb-init \
  adobe-flashplugin \
  msttcorefonts \
  ffmpeg \
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
  libllvm8 \
  libgbm-dev \
  ca-certificates \
  libappindicator1 \
  libnss3 \
  lsb-release \
  xdg-utils \
  wget \
  xvfb \
  curl &&\
  curl --silent --location https://deb.nodesource.com/setup_12.x | bash - &&\
  apt-get -y -qq install nodejs &&\
  apt-get -y -qq install build-essential &&\
  fc-cache -f -v

# Pin old GL libs
RUN wget -q https://launchpadlibrarian.net/445014413/libglapi-mesa_19.0.8-0ubuntu0~18.04.3_amd64.deb &&\
  wget -q https://launchpadlibrarian.net/445014412/libgl1-mesa-dri_19.0.8-0ubuntu0~18.04.3_amd64.deb &&\
  wget -q https://launchpadlibrarian.net/445014393/libgl1-mesa-glx_19.0.8-0ubuntu0~18.04.3_amd64.deb &&\
  wget -q https://launchpadlibrarian.net/445014414/libglx-mesa0_19.0.8-0ubuntu0~18.04.3_amd64.deb &&\
  wget -q https://launchpadlibrarian.net/445014418/mesa-va-drivers_19.0.8-0ubuntu0~18.04.3_amd64.deb &&\
  wget -q https://launchpadlibrarian.net/445014419/mesa-vdpau-drivers_19.0.8-0ubuntu0~18.04.3_amd64.deb &&\
  dpkg -i libglapi-mesa_19.0.8-0ubuntu0~18.04.3_amd64.deb &&\
  dpkg -i libgl1-mesa-dri_19.0.8-0ubuntu0~18.04.3_amd64.deb &&\
  dpkg -i libgl1-mesa-glx_19.0.8-0ubuntu0~18.04.3_amd64.deb &&\
  dpkg -i libglx-mesa0_19.0.8-0ubuntu0~18.04.3_amd64.deb &&\
  dpkg -i mesa-va-drivers_19.0.8-0ubuntu0~18.04.3_amd64.deb &&\
  dpkg -i mesa-vdpau-drivers_19.0.8-0ubuntu0~18.04.3_amd64.deb

# Add the browserless user (blessuser)
RUN groupadd -r blessuser && useradd -r -g blessuser -G audio,video blessuser \
  && mkdir -p /home/blessuser/Downloads \
  && chown -R blessuser:blessuser /home/blessuser

# Install deps necessary to build
RUN npm install -g typescript @types/node

# Cleanup
RUN apt-get -qq clean && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*
