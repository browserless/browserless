ARG VERSION=latest
FROM registry.browserless.io/foundation:$VERSION

# Install browser(s) and generate CDP JSON stub
RUN npx --yes playwright install chromium &&\
  npx --yes playwright install-deps chromium
