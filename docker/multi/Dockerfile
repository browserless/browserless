ARG VERSION=latest
FROM ghcr.io/browserless/base:$VERSION
LABEL org.opencontainers.image.source https://github.com/browserless/browserless

ARG TARGETPLATFORM
ENV TARGETPLATFORM=${TARGETPLATFORM}

COPY fonts/* /usr/share/fonts/truetype/
COPY src src/
# Only use core as exports since routes are lazy loaded and not always present
COPY src/exports.core.ts src/exports.ts

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

# Chrome stable is only supported on non-ARM builds
# so it's installation is conditional on whether or not amd64
RUN if [ "$TARGETPLATFORM" = "linux/amd64" ]; then \
    npx --yes playwright install-deps chrome &&\
    npx --yes playwright install chrome; \
  else \
    rm -rf ./src/routes/chrome; \
  fi

RUN npx --yes playwright install chromium firefox webkit &&\
  npx --yes playwright install-deps chromium firefox webkit &&\
  npm run build &&\
  npm run build:function &&\
  npm prune production &&\
  chown -R blessuser:blessuser $APP_DIR &&\
  fc-cache -f -v &&\
  apt-get -qq clean && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/* /usr/share/fonts/truetype/noto

USER blessuser

CMD ["./scripts/start.sh"]
