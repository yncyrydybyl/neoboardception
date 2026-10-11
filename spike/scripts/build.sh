#!/usr/bin/env bash
# Reproducible build of the spike: NeoBoard fork (webrtc mode) + inner test widget.
# Usage: spike/scripts/build.sh   (from anywhere; needs node >= 20 and yarn 1)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
yarn install --frozen-lockfile
# Same build as the upstream/store build: legacy WebRTC transport, audited capability list.
# Spike code is only compiled in when the inner-widget origin allow-list is set.
VITE_NBC_SPIKE_INNER_ORIGINS="${VITE_NBC_SPIKE_INNER_ORIGINS:-https://localhost:5444}" \
  REACT_APP_RTC=webrtc yarn build
# Inner test widget: one bundled ES module + static index.html.
rm -rf spike/test-widget/dist && mkdir -p spike/test-widget/dist
node_modules/.bin/esbuild spike/test-widget/src/main.ts --bundle --format=esm \
  --target=es2020 --outfile=spike/test-widget/dist/main.js
cp spike/test-widget/index.html spike/test-widget/dist/index.html
echo "NeoBoard build: matrix-neoboard-widget/build   test widget: spike/test-widget/dist"
