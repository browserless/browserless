ARG VERSION=latest
FROM ghcr.io/browserless/foundation:$VERSION
LABEL org.opencontainers.image.source https://github.com/browserless/chrome

# Install browser(s) and generate CDP JSON stub
RUN npx --yes playwright install chromium &&\
  npx --yes playwright install-deps chromium
