#!/bin/bash
# src/ の ES モジュールを 1 つの素の JS（dist/workspace-router.js）に結合する。
# src/config.local.js があれば、src/config.js の既定値をその内容で上書きする。
set -euo pipefail
cd "$(dirname "$0")"

OUT=dist/workspace-router.js
mkdir -p dist

strip_module() {
  # import 行を消し、export を外す。export default は指定の変数名に置き換える
  sed -E -e '/^import /d' -e "s/^export default /const $2 = /" -e 's/^export //' "$1"
}

{
  echo "// vivaldi-workspace-router — built $(date -u +%Y-%m-%dT%H:%M:%SZ) from $(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
  echo "(() => {"
  echo "'use strict';"
  strip_module src/normalize.js _
  strip_module src/matcher.js _
  strip_module src/config.js CONFIG
  if [ -f src/config.local.js ]; then
    strip_module src/config.local.js CONFIG_LOCAL
    echo "Object.assign(CONFIG, CONFIG_LOCAL);"
  fi
  strip_module src/router.js _
  echo "})();"
} > "$OUT"

node --check "$OUT"
echo "built $OUT$([ -f src/config.local.js ] && echo ' (with src/config.local.js)')"
