ARG FROM=ghcr.io/browserless/multi
ARG VERSION=latest

FROM ${FROM}:${VERSION}

# Change to root for install
USER root

# Cleanup
RUN rm -rf $APP_DIR
RUN mkdir -p $APP_DIR

WORKDIR $APP_DIR

# Copy src
COPY src src
COPY package.json .
COPY package-lock.json .
COPY tsconfig.json .

# Optional files that might not always be there
COPY *browserless.io-browserless-*.tgz .
COPY *README.md .

# Install dependencies
RUN npm install

# Build Source files
RUN npm run build

# Back to non-privileged user
USER blessuser

CMD ["npm", "start"]
