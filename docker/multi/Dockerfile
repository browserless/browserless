ARG VERSION=latest
FROM ghcr.io/browserless/base:$VERSION
LABEL org.opencontainers.image.source https://github.com/browserless/chrome

COPY fonts/* /usr/share/fonts/truetype/
COPY src src/

RUN echo "ttf-mscorefonts-installer msttcorefonts/accepted-mscorefonts-eula select true" | debconf-set-selections &&\
  apt-get -y -qq install software-properties-common &&\
  apt-add-repository "deb http://archive.canonical.com/ubuntu $(lsb_release -sc) partner" &&\
  apt-get -y -qq --no-install-recommends install \
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
    fonts-wqy-zenhei

RUN npx --yes playwright install chromium firefox webkit &&\
  npx --yes playwright install-deps chromium firefox webkit &&\
  npm run build &&\
  npm run build:client &&\
  npm prune production &&\
  chown -R blessuser:blessuser $APP_DIR &&\
  fc-cache -f -v &&\
  apt-get -qq clean && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/* /usr/share/fonts/truetype/noto

USER blessuser

CMD ["./start.sh"]
