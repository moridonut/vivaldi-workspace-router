# 検証結果（Phase 1: Spike）

`docs/design.md`「実装前に検証すべき事項」の実機確認結果。手順は `spike/README.md`。

- 検証日: 2026-10-24（1 回目、2 回目）
- Vivaldi バージョン: 8.2.4133.84（Chromium 152）
- macOS: Intel Mac（UA 上は 10_15_7 固定のため実バージョン不明）、Kandji の MDM 管理下（DEP 登録）
- UI DevTools の開き方: （未記録）

状態: ⬜ 未確認 / ✅ 設計どおり / ⚠️ 設計と違う（設計を更新） / ❌ 不可（代替案が必要）

| # | 検証事項 | 状態 | 結果 |
| --- | --- | --- | --- |
| 1 | mod を読み込む HTML のファイル名 | ✅ | `window.html`。中身は CSS の `<link>` だけで `<script>` は 1 つもない。React 本体（`bundle.js`）は、画面に出ない `main.html` が読み込んでいる。`chrome.tabs` と `vivaldi.*` は `window.html` の文脈で使えたので、mod の挿入先は設計どおり `window.html` でよい。ウィンドウごとに読み込まれるか（G）は未確認 |
| 2 | タブの拡張データのプロパティ名と `workspaceId` の形 | ✅ | `tab.vivExtData`、JSON 文字列。`workspaceId` は number（例 `1768800948103`、作成時刻のミリ秒と思われる）。ほかのキーは `ext_id`、`parent_ext_id`、`restoreStatus`、`panelId` |
| 3 | ワークスペース一覧の設定キーと構造、変更の購読 | ⚠️ | キーは `vivaldi.workspaces.list`。戻り値は `{ value, defaultValue, store }` で、一覧は `.value`。要素は `{ id: number, name: string, icon: string }`、6 件。`vivaldi.prefs.onChanged` は切替時に発火するが、通知の中身はまだ分からない（2 回目のスニペットでは読めなかった。修正済み） |
| 4 | `workspaceId` を書き換えたとき、タブバーが即座に追従するか | ⬜ | `chrome.tabs.update(id, { vivExtData })` はエラーなく成功し、値も残った（`persisted: true`）。タブバーの見え方は未記録 |
| 5 | 別ワークスペースのタブを `active: true` にするとワークスペースも切り替わるか | ⬜ | アクティブなタブの `workspaceId` は、移動先のものに変わった（before `1768800948103` → after `1790727420515`）。画面のワークスペース表示も切り替わったかは未記録 |
| 6 | ハイバネート中のタブでも URL とタイトルが取れるか | ✅ | 7/7 件で `url`・`title`・`workspaceId` が取れた。`status` は `"unloaded"` |
| 7 | ウェブパネルとアプリウィンドウを `chrome.tabs` の情報だけで除外できるか | ⚠️ | アプリ（PWA）ウィンドウは `window.type === "app"`、DevTools は `"devtools"` で除外できる。ウェブパネルは通常ウィンドウの中のタブとして見え、`vivExtData.panelId` を持つ（`workspaceId` はない）。設計書の除外条件を更新済み |
| 8 | 実タイトルに顧客名が入るか（Salesforce 商談 / Slides / Celonis） | ⚠️ | **6 つのワークスペース名のどれも、17 件（Slides 10、Salesforce 商談 3、Celonis 4）のタイトルに出てこなかった**。表記の違い（日本語の名前と英語のタイトルなど）なのか、そもそも顧客名がタイトルに入らないのかは、`nameCoverage()` とユーザーの目視で確かめる。どちらにしても、F3 の別名（英語名・略称・`url:`）は必須と考えたほうがよい |
| 9 | Celonis の URL 構造（重複キーに使う部分） | ⬜ | 開いていた 3 件は、どれも `https://<team>.<region>.celonis.cloud/package-manager/ui/views/ui/spaces` というスペース一覧ページで、ID を含まなかった。タイトルも 14 文字の共通の名前と思われる。個別のビューやダッシュボードを開いた状態で再取得する |
| 10 | アプリバンドルへの書き込みが会社の Mac で許可されるか | ❌ | `touch` が `Operation not permitted`。フォルダの所有者は本人なので、macOS の「アプリ管理」保護に止められている。Kandji の MDM 管理下。ターミナルに「アプリ管理」の権限を付けられるかが未確認 |

## 追加で確認する事項

| # | 検証事項 | 状態 | 結果 |
| --- | --- | --- | --- |
| A | 手動でワークスペースを移したとき `onUpdated` が拡張データの変化を通知するか（F6 の検出経路） | ✅ | 手動で移すと、`changeInfo` のキーが `["vivExtData"]` だけのイベントが来て、中の `workspaceId` が変わっている。`onUpdated` だけで検出できる |
| B | Salesforce / Slides でタイトルが確定するまでの時間 | ✅ | Salesforce 商談は、作成から 0.9 秒で仮のタイトル（20 文字）、4.7 秒で本来のタイトル（86 文字）が来た。Slides は 1.3 秒で確定した。タイトルが変わるたびに 800ms デバウンスして判定し直す設計で足りる。30 秒の受付時間にも十分収まる |
| C | 今アクティブなワークスペースの取得方法 | ✅ | ウィンドウの `vivExtData` には workspace 関連のキーがない。アクティブなタブの `workspaceId` を使えば取れる（#5 の before/after で値が変わった） |
| D | `vivaldi.prefs.get` がコールバック形式か Promise 形式か | ✅ | どちらかで値が返る（どちらかは区別していない）。両対応の呼び方にしておく |
| E | `workspaceId` を持たないタブ | ✅ | 通常ウィンドウで `workspaceId` がないのは、`chrome://` のタブとウェブパネルだけだった。https の通常タブは、すべてどこかのワークスペースに属していた |
| F | 新しいタブの作成直後のイベント | ✅ | `onCreated` の 1〜7ms 後に、キーが `["vivExtData"]` だけの `onUpdated` が必ず来る（`workspaceId` は作成時のまま）。Vivaldi が作成直後に拡張データを付ける動きと思われる。このイベントを F6 の手動移動と取り違えないよう、`workspaceId` が実際に変わったかで判断する |
| G | `window.html` はブラウザウィンドウごとに読み込まれるか | ⬜ | `<!-- Vivaldi window document -->` とあるので、ウィンドウごとに 1 つずつ読み込まれる可能性が高い。そうなら mod も複数動くことになり、それぞれが自分のウィンドウのタブだけを扱う必要がある |
| H | Vivaldi 独自 API の候補 | 参考 | `vivaldi.tabsPrivate` に `onExtDataChanged`、`notifyActiveWorkspace`、`update`、`move` がある。#4 の目視で表示が追従しなかった場合に調べる候補。引数が分からないため、今は呼ばない |

## 詳細

### #1 window.html と main.html

```html
<!-- window.html -->
<!-- Vivaldi window document -->
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>Vivaldi</title>
  <link rel="stylesheet" href="style/common.css" />
  <link rel="stylesheet" href="chrome://vivaldi-data/css-mods/css" />
</head>
<body>
</body>
</html>
```

`main.html` は「Loads in an invisible document, holds the react framework and windows.」というコメントがあり、`background-common-bundle.js` と `bundle.js` を読み込んでいる。`browser.html` はない。

### #3 `vivaldi.prefs.get('vivaldi.workspaces.list')` の戻り値

```js
{
  value: [ { id: number, name: string, icon: string /* 567 文字。SVG か data URL と思われる */ }, ... ],
  defaultValue: [],
  store: string, // 4 文字。"user" と思われる
}
```

### #7 ウィンドウ種別

| window.type | 中身 | 扱い |
| --- | --- | --- |
| `normal` | 通常タブ、`chrome://` タブ 3 件、ウェブパネル 1 件（`panelId` あり） | 対象。ただしパネルと内部ページは除外する |
| `app` | PWA 1 タブずつ（`vivExtData` は `ext_id` のみ） | 除外 |
| `devtools` | `devtools://` | 除外 |

### #9 Celonis の URL（2 回目）

- ホスト: `<team>.<region>.celonis.cloud`（`<team>` は伏せた部分）
- パス: `/package-manager/ui/views/ui/spaces`（スペース一覧ページ）

### #10 アプリバンドルへの書き込み

- 結果: `Operation not permitted`
- 署名: `Identifier=com.vivaldi.Vivaldi`、`TeamIdentifier=4XF3XNRN6Y`
- MDM: Kandji（`Enrolled via DEP: Yes`、`MDM enrollment: Yes (User Approved)`）

## 設計への反映

- 「全体アーキテクチャ」の使う API：`vivaldi.prefs.get` の戻り値の形を追記した（#3）
- 「振り分けロジック」の対象外：ウェブパネルは `vivExtData.panelId` で除外するよう変えた（#7）
- 「手動移動の検出」：作成直後の拡張データ通知（F）を手動移動と取り違えない旨を追記した
- 未反映：#8（別名の位置づけ）、#10（インストール方法）、G（ウィンドウごとに読み込まれる場合の扱い）は、結果が出てから反映する
