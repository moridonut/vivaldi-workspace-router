#!/bin/bash
# Vivaldi に workspace-router を組み込む。何度実行しても同じ結果になる。
#
#   ./install.sh              ビルドして組み込む
#   ./install.sh --uninstall  組み込みを外し、window.html を元に戻す
#   ./install.sh --agent      Vivaldi の更新を検知して自動で組み込み直す LaunchAgent を登録する
#   ./install.sh --remove-agent  LaunchAgent を外す
#   ./install.sh --status     状態を表示する
#
# LaunchAgent からは --auto で呼ばれる（ビルドせず、失敗したら通知を出す）。
set -euo pipefail

REPO="$(cd "$(dirname "$0")" && pwd)"
APP="${VIVALDI_APP:-/Applications/Vivaldi.app}"
VERSIONS="$APP/Contents/Frameworks/Vivaldi Framework.framework/Versions"
JS_NAME="workspace-router.js"
MARKER="<!-- vivaldi-workspace-router -->"
TAG="$MARKER<script src=\"$JS_NAME\"></script>"
LABEL="com.github.moridonut.vivaldi-workspace-router"
AGENTS_DIR="${LAUNCH_AGENTS_DIR:-$HOME/Library/LaunchAgents}"
PLIST="$AGENTS_DIR/$LABEL.plist"
LOG="${WSR_LOG:-$HOME/Library/Logs/vivaldi-workspace-router.log}"

MODE="install"
case "${1:-}" in
  "") ;;
  --uninstall) MODE="uninstall" ;;
  --agent) MODE="agent" ;;
  --remove-agent) MODE="remove-agent" ;;
  --status) MODE="status" ;;
  --auto) MODE="auto" ;;
  *) echo "unknown option: $1" >&2; exit 2 ;;
esac

say() { echo "$*"; }

notify() {
  if command -v osascript >/dev/null 2>&1; then
    osascript -e "display notification \"$1\" with title \"Vivaldi Workspace Router\"" >/dev/null 2>&1 || true
  fi
}

# 最新バージョンの Resources/vivaldi を返す（Current のリンクがあれば優先）
resources_dir() {
  local v=""
  if [ -L "$VERSIONS/Current" ]; then
    v="$(basename "$(readlink "$VERSIONS/Current")")"
  fi
  if [ -z "$v" ] || [ ! -d "$VERSIONS/$v" ]; then
    v="$(ls -1 "$VERSIONS" 2>/dev/null | grep -E '^[0-9]+(\.[0-9]+)+$' | sort -t. -k1,1n -k2,2n -k3,3n -k4,4n | tail -1 || true)"
  fi
  [ -n "$v" ] && echo "$VERSIONS/$v/Resources/vivaldi"
}

vivaldi_running() {
  command -v pgrep >/dev/null 2>&1 && pgrep -x Vivaldi >/dev/null 2>&1
}

# window.html の </body> の直前にタグを入れる（すでにあれば何もしない）
inject() {
  local html="$1"
  if grep -qF "$MARKER" "$html"; then
    return 1
  fi
  if ! grep -q '</body>' "$html"; then
    echo "error: </body> が見つかりません: $html" >&2
    exit 1
  fi
  local tmp
  tmp="$(mktemp)"
  awk -v tag="$TAG" '!done && /<\/body>/ { sub(/<\/body>/, tag "\n</body>"); done = 1 } { print }' "$html" >"$tmp"
  if ! cat "$tmp" >"$html"; then
    rm -f "$tmp"
    return 2
  fi
  rm -f "$tmp"
}

do_install() {
  local build="$1"
  local res
  res="$(resources_dir)"
  if [ -z "$res" ] || [ ! -f "$res/window.html" ]; then
    echo "error: Vivaldi の window.html が見つかりません（$VERSIONS）" >&2
    return 1
  fi
  if [ "$build" = "yes" ]; then
    "$REPO/build.sh"
  fi
  if [ ! -f "$REPO/dist/$JS_NAME" ]; then
    echo "error: dist/$JS_NAME がありません。先に ./build.sh を実行してください" >&2
    return 1
  fi

  local html="$res/window.html"
  local changed="no"
  # アプリ管理の権限がないと、ここで Operation not permitted になる（docs/findings.md #10）
  if ! cmp -s "$REPO/dist/$JS_NAME" "$res/$JS_NAME" 2>/dev/null; then
    cp "$REPO/dist/$JS_NAME" "$res/$JS_NAME" || return 1
    changed="yes"
  fi
  if ! grep -qF "$MARKER" "$html"; then
    if [ ! -f "$html.bak" ]; then
      cp "$html" "$html.bak" || return 1
    fi
    inject "$html" || return 1
    changed="yes"
  fi

  if [ "$changed" = "yes" ]; then
    say "installed: $res"
    if vivaldi_running; then
      say "Vivaldi を再起動すると反映されます"
      return 10
    fi
  else
    say "already installed: $res"
  fi
}

do_uninstall() {
  local res
  res="$(resources_dir)"
  if [ -z "$res" ]; then
    echo "error: Vivaldi が見つかりません（$VERSIONS）" >&2
    exit 1
  fi
  local html="$res/window.html"
  if [ -f "$html.bak" ]; then
    cat "$html.bak" >"$html"
    rm -f "$html.bak"
  elif [ -f "$html" ] && grep -qF "$MARKER" "$html"; then
    local tmp
    tmp="$(mktemp)"
    grep -vF "$MARKER" "$html" >"$tmp" || true
    cat "$tmp" >"$html"
    rm -f "$tmp"
  fi
  rm -f "$res/$JS_NAME"
  say "uninstalled: $res"
  vivaldi_running && say "Vivaldi を再起動すると反映されます" || true
}

write_plist() {
  mkdir -p "$AGENTS_DIR" "$(dirname "$LOG")"
  cat >"$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$REPO/install.sh</string>
    <string>--auto</string>
  </array>
  <key>WatchPaths</key>
  <array>
    <string>$VERSIONS</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>3600</integer>
  <key>StandardOutPath</key>
  <string>$LOG</string>
  <key>StandardErrorPath</key>
  <string>$LOG</string>
</dict>
</plist>
PLIST_EOF
}

case "$MODE" in
  install)
    set +e
    do_install yes
    rc=$?
    set -e
    [ $rc -eq 10 ] && rc=0
    exit $rc
    ;;
  auto)
    # 更新の途中で呼ばれることがあるので、window.html ができるまで少し待つ
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] auto"
    for _ in $(seq 1 "${WSR_WAIT_TRIES:-12}"); do
      res="$(resources_dir || true)"
      [ -n "$res" ] && [ -f "$res/window.html" ] && break
      sleep "${WSR_WAIT_SEC:-5}"
    done
    set +e
    out="$(do_install no 2>&1)"
    rc=$?
    set -e
    echo "$out"
    if [ $rc -eq 10 ]; then
      notify "Vivaldi の更新後に組み込み直しました。Vivaldi を再起動すると有効になります"
    elif [ $rc -ne 0 ]; then
      notify "自動で組み込み直せませんでした。ターミナルで install.sh を実行してください"
      exit 1
    fi
    ;;
  uninstall)
    do_uninstall
    ;;
  agent)
    write_plist
    if [ -z "${WSR_NO_LAUNCHCTL:-}" ]; then
      launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
      launchctl bootstrap "gui/$(id -u)" "$PLIST"
    fi
    say "LaunchAgent を登録しました: $PLIST"
    say "ログ: $LOG"
    ;;
  remove-agent)
    if [ -z "${WSR_NO_LAUNCHCTL:-}" ]; then
      launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
    fi
    rm -f "$PLIST"
    say "LaunchAgent を外しました"
    ;;
  status)
    res="$(resources_dir || true)"
    say "Vivaldi:   ${res:-not found}"
    if [ -n "$res" ] && [ -f "$res/window.html" ] && grep -qF "$MARKER" "$res/window.html"; then
      say "mod:       installed"
      if cmp -s "$REPO/dist/$JS_NAME" "$res/$JS_NAME" 2>/dev/null; then
        say "script:    up to date"
      else
        say "script:    differs from dist/ (./install.sh で更新)"
      fi
    else
      say "mod:       not installed"
    fi
    if [ -f "$PLIST" ]; then say "agent:     $PLIST"; else say "agent:     not registered"; fi
    ;;
esac
