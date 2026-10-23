#!/bin/bash
# Phase 1 (Spike) 検証事項 [1][10]: mod を読み込む HTML の確認と、アプリバンドルへの書き込み可否。
# 何も書き換えない。書き込みテストは一時ファイルを作ってすぐ消すだけ。
set -u

APP="${VIVALDI_APP:-/Applications/Vivaldi.app}"
VERSIONS="$APP/Contents/Frameworks/Vivaldi Framework.framework/Versions"

echo "== Vivaldi"
defaults read "$APP/Contents/Info" CFBundleShortVersionString 2>/dev/null || echo "(バージョン取得失敗)"

echo "== Versions/"
if [ ! -d "$VERSIONS" ]; then
  echo "見つかりません: $VERSIONS"
  exit 1
fi
ls -la "$VERSIONS"

LATEST=$(ls -1 "$VERSIONS" | grep -E '^[0-9]+(\.[0-9]+)+$' | sort -t. -k1,1n -k2,2n -k3,3n -k4,4n | tail -1)
RES="$VERSIONS/$LATEST/Resources/vivaldi"
echo "== 最新バージョン: $LATEST"
echo "== $RES の HTML"
ls -la "$RES"/*.html 2>/dev/null || echo "(HTML なし)"

for f in window.html browser.html; do
  if [ -f "$RES/$f" ]; then
    echo "-- $f: script タグ"
    grep -o '<script[^>]*>' "$RES/$f"
  fi
done

echo "== 書き込みテスト"
TEST="$RES/.spike-write-test"
if touch "$TEST" 2>/tmp/spike-touch-err; then
  rm -f "$TEST"
  echo "OK: 書き込み可能"
else
  echo "NG: $(cat /tmp/spike-touch-err)"
  echo "  → システム設定 > プライバシーとセキュリティ > アプリ管理 でターミナルを許可して再実行"
fi
rm -f /tmp/spike-touch-err

echo "== 所有者と署名"
stat -f '%Su:%Sg %Sp' "$RES"
codesign -dv "$APP" 2>&1 | grep -E 'Identifier|TeamIdentifier|Signature'

echo "== MDM プロファイル（会社管理か）"
profiles status -type enrollment 2>/dev/null || echo "(profiles コマンド失敗)"
