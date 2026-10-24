// このファイルを src/config.local.js にコピーして編集する（config.local.js は Git に入らない）。
// ここに書いた項目だけが src/config.js の既定値を上書きする。

export default {
  dryRun: true,
  debug: true,
  ignoreWorkspaces: ['個人', 'Inbox'],
  aliases: {
    'サンプル工業': ['Sample Industries', 'SMPL', 'url:sampleind.bi.example.com'],
  },
};
