# Phase 3: 実機での試運転（ドライラン）

router 本体を、移動・切替・クローズを一切しない「ドライラン」で動かし、判定が正しいかをコンソールのログで確かめる。インストーラ（Phase 4）はまだないので、Phase 1 と同じく UI の DevTools に貼り付けて動かす。

## 1. 自分の設定を書く

```sh
git pull
cp src/config.local.example.js src/config.local.js
```

`src/config.local.js` を開き、`aliases` に案件ごとの別名を書く。`config.local.js` は Git に入らない（`.gitignore` 済み）ので、顧客名を書いてよい。

```js
export default {
  dryRun: true,   // 試運転の間は true のまま
  debug: true,    // 判定ごとにログを出す
  ignoreWorkspaces: ['個人'],
  aliases: {
    'ワークスペース名': ['English Name', '略称', 'url:sampleind.bi.example.com'],
  },
};
```

## 2. ビルドしてコピーする

```sh
./build.sh
pbcopy < dist/workspace-router.js
```

## 3. DevTools に貼り付ける

1. `vivaldi://inspect/#apps` から `window.html` の inspect を開く（ウィンドウが複数あれば、試したいウィンドウのもの）
2. Console に貼り付けて Enter
3. `[workspace-router] started (window …, DRY RUN); N workspaces: …` と出て、各ワークスペースのキーワードが並ぶことを確かめる
   - `config warning too-short` や `unknown-workspace` が出たら、別名の書き方を見直す

貼り付けた mod は、そのウィンドウだけで、Vivaldi を再起動するまで動く。貼り直すと前のものは自動で止まる。

## 4. 試すこと

`docs/design.md`「テスト計画と受け入れ基準」の実機シナリオのうち、ドライランで確かめられるもの。

| # | 操作 | 期待するログ |
| --- | --- | --- |
| 1 | 別の案件のワークスペースにいる状態で、Slack から案件 B の Slides を開く | `[dry-run] move … → B` |
| 2 | B にすでに開いている Slides と同じものを開く（`#slide=` 違いも） | `[dry-run] close duplicate … → activate existing …` |
| 4 | 顧客名を含まない社内資料を開く | `decide … none` |
| 5 | 2 つの案件の名前を含む資料を開く | `conflict; not moving … candidates: A, B` |
| 6 | 開いたタブを手で別のワークスペースへ移す | `manual move detected` |
| 7 | Salesforce の商談を開く | 最初は `none` でも、タイトル確定後に `[dry-run] move … → 正しい案件` |
| 8 | Celonis のアプリを開く | `url:` 別名で `[dry-run] move` |
| 9 | ウェブパネルや PWA でページを開く | 何も出ない（`debug: true` なら `skip … web panel`） |

誤った判定があれば、そのログ行（顧客名は伏せて構わない）を Claude Code に貼る。

## コンソールで使えるコマンド

```js
workspaceRouter.status()        // 状態
workspaceRouter.toggle()        // 一時停止 / 再開（F8）
workspaceRouter.setDryRun(false) // 実際に動かす（ドライランで問題がないと確かめてから）
workspaceRouter.stop()          // 止める
```
