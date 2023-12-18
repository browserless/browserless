# This file is auto-generated and shouldn't be edited directly
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
COPY *README.md .
COPY tsconfig.json .

# Install dependencies
RUN npm install

# Build Source files
RUN npm run build

# Back to non-privileged user
USER blessuser

CMD ["npm", "start"]
