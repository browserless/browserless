# Browserless development commands

# INFRA_DIR must be set in ~/.zshenv (NOT .zshrc — non-interactive shells skip .zshrc).
# Points to the SST/Pulumi project that builds the Docker image.
# Example: export INFRA_DIR="/path/to/your/sst-project"
infra_dir := env_var_or_default('INFRA_DIR', '')

# List available commands
default:
    @just --list

# Deploy this browserless worktree to production
deploy:
    #!/usr/bin/env bash
    set -euo pipefail
    if [ -z "{{infra_dir}}" ]; then
        echo "ERROR: INFRA_DIR is not set. Add to ~/.zshenv:"
        echo '  export INFRA_DIR="/path/to/your/sst-project"'
        exit 1
    fi
    echo "Deploying browserless from: {{justfile_directory()}}"
    BROWSERLESS_SOURCE_DIR="{{justfile_directory()}}" bun --cwd "{{infra_dir}}" prod

# Build TypeScript
build:
    npm run build

# Build rrweb extension bundle
build-ext:
    bun extensions/replay/build.js

# Run tests
test:
    npm test

# TypeScript check
typecheck:
    npx tsc --noEmit

# Start local Browserless server with auto-restart on rebuild
# MUST use node, NOT bun — bun breaks WebSocket proxying (handshake timeouts)
dev port="3000":
    PORT={{port}} npx env-cmd -f .env.dev node --watch build/index.js

# Run TypeScript compiler in watch mode (separate terminal)
watch:
    npx tsc --watch --preserveWatchOutput

# One-time dev setup: build everything needed for local dev
dev-setup: build build-ext
    npm run build:function
    npm run install:debugger

# Build + deploy in one step
ship: build build-ext deploy
