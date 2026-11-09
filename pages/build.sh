#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
DIST_DIR="$ROOT_DIR/dist"

mkdir -p "$DIST_DIR/pages" "$DIST_DIR/resource"
cp "$ROOT_DIR/index.html" "$ROOT_DIR/_routes.json" "$DIST_DIR/"
cp -R "$ROOT_DIR/pages/css" "$ROOT_DIR/pages/html" "$ROOT_DIR/pages/js" "$DIST_DIR/pages/"
cp "$ROOT_DIR/resource/README.md" "$DIST_DIR/resource/README.md"
