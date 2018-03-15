FROM node:8-slim

# Application parameters and variables
ENV NODE_ENV=production
ENV PORT=3000
ENV application_directory /usr/src/app
ENV font_directory /usr/share/fonts/noto

# Configuration for Chrome
ENV CONNECTION_TIMEOUT=60000
ENV CHROME_PATH=/usr/bin/google-chrome

RUN mkdir -p $application_directory
RUN mkdir -p $font_directory

WORKDIR $application_directory

# Install app dependencies
COPY package.json .
COPY tsconfig.json .

# Bundle app source
COPY . .

# Dependencies needed for packages downstream
RUN apt-get update && apt-get install -y \
  unzip \
  fontconfig \
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
  fonts-liberation \
  libappindicator1 \
  libnss3 \
  lsb-release \
  xdg-utils \
  wget \
  fonts-ipafont-gothic \
  fonts-ipafont-mincho

# It's a good idea to use dumb-init to help prevent zombie chrome processes.
ADD https://github.com/Yelp/dumb-init/releases/download/v1.2.0/dumb-init_1.2.0_amd64 /usr/local/bin/dumb-init
RUN chmod +x /usr/local/bin/dumb-init

# Install emoji's
RUN cd $font_directory &&\
  wget https://github.com/emojione/emojione-assets/releases/download/3.1.2/emojione-android.ttf &&\
  fc-cache -f -v

# Build
RUN npm install -g typescript @types/node &&\
  npm install &&\
  npm run build

# Cleanup
RUN apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Expose the web-socket and HTTP ports
EXPOSE 3000
ENTRYPOINT ["dumb-init", "--"]
CMD [ "npm", "start" ]
