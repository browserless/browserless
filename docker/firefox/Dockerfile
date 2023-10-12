ARG VERSION=latest
FROM ghcr.io/browserless/foundation:$VERSION
LABEL org.opencontainers.image.source https://github.com/browserless/chrome

# Install browser(s)
RUN npx --yes playwright install firefox &&\
  npx --yes playwright install-deps firefox

# Install Fonts
COPY fonts/* /usr/share/fonts/truetype/

# Install source
COPY src src/
RUN rm -r src/routes/

# Only bundle routes for this build
COPY src/routes/firefox src/routes/firefox/

# Install fonts
RUN echo "ttf-mscorefonts-installer msttcorefonts/accepted-mscorefonts-eula select true" | debconf-set-selections && \
  apt-get -y -qq install software-properties-common &&\
  apt-add-repository "deb http://archive.canonical.com/ubuntu $(lsb_release -sc) partner" && \
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

# Build and cleanup the app
RUN fc-cache -f -v && \
  npm run build &&\
  npm prune production &&\
  chown -R blessuser:blessuser $APP_DIR &&\
  apt-get -qq clean && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/* /usr/share/fonts/truetype/noto

# Run everything after as non-privileged user.
USER blessuser

CMD ["./start.sh"]
