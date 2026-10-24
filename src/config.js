// 既定の設定。リポジトリは public なので、実際の顧客名・別名はここに書かない。
// 自分の設定は src/config.local.js（Git に入らない）に書くと、ビルド時にこの内容を上書きする。
// 例は src/config.local.example.js。

export default {
  enabled: true,
  dryRun: true,              // true の間は移動・切替・クローズをせず、判定をログに出すだけ
  switchOnMove: true,        // F7: 移動したら移動先ワークスペースへ切替
  dedupe: true,              // F5: 移動先での重複処理
  dedupeUnmatched: false,    // 一致なしタブも現ワークスペース内で重複処理
  dedupeReopenGraceMs: 60000, // 重複として閉じた直後にもう一度開いたら、わざととみなして閉じない時間
  routeWindowMs: 30000,      // 作成/ナビゲーション後、自動移動を許す時間
  debounceMs: 800,
  ignoreWorkspaces: [],      // 振り分け先にしないワークスペース
  minKeywordLength: 3,       // 英字だけのキーワードの最短の長さ
  minKeywordLengthNonAscii: 2, // 日本語を含むキーワードの最短の長さ
  aliases: {
    // ワークスペース名: 追加キーワード（url: 始まりは URL にだけ照合）
  },
  debug: false,              // true で判定ログを UI の DevTools コンソールへ
};
