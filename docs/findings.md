# 検証結果（Phase 1: Spike）

`docs/design.md`「実装前に検証すべき事項」の実機確認結果。手順は `spike/README.md`。

- 検証日: 2026-10-24（1〜3 回目と個別の確認）
- Vivaldi バージョン: 8.2.4133.84（Chromium 152）
- macOS: Intel Mac（UA 上は 10_15_7 固定のため実バージョン不明）、Kandji の MDM 管理下（DEP 登録）
- UI DevTools の開き方: （未記録）

状態: ⬜ 未確認 / ✅ 設計どおり / ⚠️ 設計と違う（設計を更新） / ❌ 不可（代替案が必要）

| # | 検証事項 | 状態 | 結果 |
| --- | --- | --- | --- |
| 1 | mod を読み込む HTML のファイル名 | ✅ | `window.html`。中身は CSS の `<link>` だけで `<script>` は 1 つもない。React 本体（`bundle.js`）は、画面に出ない `main.html` が読み込んでいる。`chrome.tabs` と `vivaldi.*` は `window.html` の文脈で使えたので、mod の挿入先は設計どおり `window.html` でよい。ウィンドウごとに読み込まれるか（G）は未確認 |
| 2 | タブの拡張データのプロパティ名と `workspaceId` の形 | ✅ | `tab.vivExtData`、JSON 文字列。`workspaceId` は number（例 `1768800948103`、作成時刻のミリ秒と思われる）。ほかのキーは `ext_id`、`parent_ext_id`、`restoreStatus`、`panelId` |
| 3 | ワークスペース一覧の設定キーと構造、変更の購読 | ⚠️ | キーは `vivaldi.workspaces.list`。戻り値は `{ value, defaultValue, store }` で、一覧は `.value`。要素は `{ id: number, name: string, icon: string }`、6 件。`vivaldi.prefs.onChanged` は切替時に発火するが、通知の中身はまだ分からない（2 回目のスニペットでは読めなかった。修正済み） |
| 4 | `workspaceId` を書き換えたとき、タブバーが即座に追従するか | ✅ | `chrome.tabs.update(id, { vivExtData: JSON.stringify({...ext, workspaceId}) })` で、タブは即座に今のタブバーから消え、移動先のワークスペースに表示された。移動にはこの方法を使う |
| 5 | 別ワークスペースのタブを `active: true` にするとワークスペースも切り替わるか | ✅ | 即座に切り替わった。F7（移動先へ切替）と F5（既存タブを前に出す）は `chrome.tabs.update(id, { active: true })` だけで実現できる |
| 6 | ハイバネート中のタブでも URL とタイトルが取れるか | ✅ | 7/7 件で `url`・`title`・`workspaceId` が取れた。`status` は `"unloaded"` |
| 7 | ウェブパネルとアプリウィンドウを `chrome.tabs` の情報だけで除外できるか | ⚠️ | アプリ（PWA）ウィンドウは `window.type === "app"`、DevTools は `"devtools"` で除外できる。ウェブパネルは通常ウィンドウの中のタブとして見え、`vivExtData.panelId` を持つ（`workspaceId` はない）。設計書の除外条件を更新済み |
| 8 | 実タイトルに顧客名が入るか（Salesforce 商談 / Slides / Celonis） | ⚠️ | 3 回目に目視で確かめた結果は次のとおり。Slides は、日本語の顧客名＋「様」（例：`2026/10/14 <顧客名>様向け…`）か、英語名・ハイフンつなぎの英語名（例：`<customer>-…`）が入る。Salesforce 商談は、英大文字の社名＋法人格（例：`<CUSTOMER> LTD.-…`）が入り、英語名と同じ表記のワークスペースでは一致した。**Celonis のアプリはタイトルが `Celonis \| Apps` 固定で、顧客名が入らない**ため、`url:` 別名が必須になる。ほかの案件は、英語名・略称の別名を足せば拾える |
| 9 | Celonis の URL 構造（重複キーに使う部分） | ⚠️ | ホストは `<team>.<region>.celonis.cloud`。URL の中に案件ごとに異なる部分があれば、別名 `url:<その部分>` で振り分けられる。一方、取れた URL は 3 件とも `/package-manager/ui/views/ui/spaces` で、リソース ID がなかった。個別アプリを開いたときに URL が変わるかは未確認。重複キーは、パスにリソース ID がある場合だけ使い、ない場合は重複処理をしない（同じチームの別アプリを誤って閉じないため） |
| 10 | アプリバンドルへの書き込みが会社の Mac で許可されるか | ✅ | 初回は `Operation not permitted` で拒否された。システム設定 → プライバシーとセキュリティ → アプリ管理 でターミナルを許可したところ、書き込めるようになった（Kandji の MDM は、この権限を固定していなかった）。ただし、この許可はターミナルに付くもので、launchd から動かす `install.sh` には効かない可能性がある（I） |

## 追加で確認する事項

| # | 検証事項 | 状態 | 結果 |
| --- | --- | --- | --- |
| A | 手動でワークスペースを移したとき `onUpdated` が拡張データの変化を通知するか（F6 の検出経路） | ✅ | 手動で移すと、`changeInfo` のキーが `["vivExtData"]` だけのイベントが来て、中の `workspaceId` が変わっている。`onUpdated` だけで検出できる |
| B | Salesforce / Slides でタイトルが確定するまでの時間 | ✅ | Salesforce 商談は、作成から 0.9 秒で仮のタイトル（20 文字）、4.7 秒で本来のタイトル（86 文字）が来た。Slides は 1.3 秒で確定した。タイトルが変わるたびに 800ms デバウンスして判定し直す設計で足りる。30 秒の受付時間にも十分収まる |
| C | 今アクティブなワークスペースの取得方法 | ✅ | ウィンドウの `vivExtData` には workspace 関連のキーがない。アクティブなタブの `workspaceId` を使えば取れる（#5 の before/after で値が変わった） |
| D | `vivaldi.prefs.get` がコールバック形式か Promise 形式か | ✅ | どちらかで値が返る（どちらかは区別していない）。両対応の呼び方にしておく |
| J | ハイバネート中の Salesforce タブのタイトル | 参考 | ハイバネート中の商談タブは、タイトルが仮の `Lightning Experience` のまま残る。自動移動は作成から 30 秒以内のタブに限るため、判定には影響しない |
| L | 別ワークスペースの既存タブを直接アクティブにしたとき、タブ一覧も切り替わるか | ⚠️ | Phase 3 の実機試験で、元のワークスペースにいる状態から、重複処理で別ワークスペースの既存タブを `chrome.tabs.update({active:true})` すると、ページの中身は切り替わったがタブ一覧は元のワークスペースのままだった（`active` は true を返す）。一方、`vivExtData` で移動した直後のタブをアクティブにする経路（#4、#5、通常の移動）では、タブ一覧も切り替わる。重複処理は、まず新しいタブを移動先へ移して切り替え、同じワークスペースの中で既存タブを前に出してから新しいタブを閉じる順にした。この順番で、タブ一覧も既存タブも正しく移動先になることを実機で確認した |
| M | 一時停止のショートカットが UI（`window.html`）まで届くか | ✅ | 届く経路はフォーカスの場所で分かれる。アドレスバーなど UI にフォーカスがあるときは、`document` の `keydown` だけに届く（`code: "F12"`, `shiftKey: true`）。ページ（`WEBVIEW`）にフォーカスがあるときは、`vivaldi.tabsPrivate.onKeyboardShortcut` だけに届き、引数は `(windowId, "Shift+F12", false, false, false)`。`windowId` は押したウィンドウの ID。3 つの真偽値の意味は不明で、使わない。両方を受けて、自分のウィンドウ ID のものだけ扱う。別の経路から 0.3 秒以内に重ねて届いたら 1 回とする |
| E | `workspaceId` を持たないタブ | ✅ | 通常ウィンドウで `workspaceId` がないのは、`chrome://` のタブとウェブパネルだけだった。https の通常タブは、すべてどこかのワークスペースに属していた |
| F | 新しいタブの作成直後のイベント | ✅ | `onCreated` の 1〜7ms 後に、キーが `["vivExtData"]` だけの `onUpdated` が必ず来る（`workspaceId` は作成時のまま）。Vivaldi が作成直後に拡張データを付ける動きと思われる。このイベントを F6 の手動移動と取り違えないよう、`workspaceId` が実際に変わったかで判断する |
| G | `window.html` はブラウザウィンドウごとに読み込まれるか | ⚠️ | ウィンドウを 2 つ開くと、`vivaldi://inspect/#apps` に `window.html` が 2 つ並んだ。**mod はウィンドウの数だけ動く**。`chrome.tabs` のイベントはブラウザ全体のタブについて全員に届くため、何もしないと同じタブを複数の mod が同時に判定してしまう。各 mod は自分のウィンドウ（`tab.windowId`）のタブだけを扱う。自分のウィンドウ ID の取り方は K で確かめる |
| K | mod が自分のウィンドウ ID を取る方法 | ✅ | ウィンドウ 2 つのそれぞれの DevTools で、`chrome.windows.getCurrent` と `vivaldi.windowPrivate.getCurrentId` が、どちらも自分のウィンドウの ID を返した（`1895453107` と `1895453310`）。標準 API の `chrome.windows.getCurrent` を使う |
| H | Vivaldi 独自 API の候補 | 参考 | `vivaldi.tabsPrivate` に `onExtDataChanged`、`notifyActiveWorkspace`、`update`、`move` がある。#4 の目視で表示が追従しなかった場合に調べる候補。引数が分からないため、今は呼ばない |
| I | launchd（LaunchAgent）から動かした `install.sh` も、アプリバンドルに書き込めるか | ❌ | 書き込めない。`./install.sh --uninstall` の後に `launchctl kickstart` で `install.sh --auto` を動かすと、`cp: …/Resources/vivaldi/workspace-router.js: Operation not permitted` になった（2026-10-24、Vivaldi 8.2.4133.94）。「アプリ管理」の許可はターミナルに付いているので、launchd が直接起動した `/bin/bash` には効かない。組み込み済みかどうかの確認（読み取り）はできるので、LaunchAgent は「入れ直しが必要」と検知して知らせる役にとどめる |

## Phase 1 のまとめ

設計の前提は、実機の Vivaldi 8.2 ですべて成り立った。Phase 2 に進める。

- 移動・切替・既存タブを前に出す処理は、どれも標準の `chrome.tabs.update` だけでできる（#4、#5）
- 手動移動は `onUpdated` の `changeInfo.vivExtData` で検出できる（A、F）
- mod は `window.html` に入れる。ウィンドウごとに動くので、自分のウィンドウ（`chrome.windows.getCurrent`）のタブだけを扱う（#1、G、K）
- タイトルには英語名や略称で顧客名が入るので、別名はほぼ全案件で書く。Celonis のようにタイトルに顧客名が出ないページは `url:` 別名で振り分ける（#8、#9）
- アプリバンドルへの書き込みは、ターミナルに「アプリ管理」を許可すれば通る（#10）

残っている未確認事項と、確かめるフェーズは次のとおり。

| 項目 | 確かめるフェーズ | 結果が悪かった場合 |
| --- | --- | --- |
| I：launchd から動かした `install.sh` が書き込めるか | Phase 4 | 更新を検知したら通知だけ出し、ユーザーが手で実行する |
| #9：個別の Celonis アプリで URL にリソース ID が出るか | Phase 3 のドライラン | ID がなければ Celonis は重複処理しない（設計済み） |
| #3：`vivaldi.prefs.onChanged` の通知の中身 | 使わない | 判定のたびに `vivaldi.prefs.get` で一覧を読み直す（イベント駆動の判定時に 1 回だけなので負荷は小さい） |

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
- 「設定ファイル仕様」：実際のタイトルは英語名・略称が多く、別名はほぼ全案件で書く前提だと明記した（#8）
- 「インストールとアップデート追従」：アプリ管理の許可が必要なこと、launchd から動かす場合は別途確認が必要なことを追記した（#10、I）
- 「全体アーキテクチャ」：ワークスペース一覧は購読せず、判定のたびに読み直すことにした（#3）
- 「全体アーキテクチャ」「振り分けロジック」：mod がウィンドウごとに動くので、自分のウィンドウのタブだけを扱うと追記した（G）

## Phase 3 の実機確認（2026-10-24）

DevTools に貼り付けた mod で、`dryRun: false` にして確認した。

| 確認したこと | 結果 |
| --- | --- |
| 別の案件のワークスペースから、案件 B の Slides を開く | B へ移動し、B に切り替わる |
| 同じ資料をもう一度開く（`#slide=` 違いも含む） | 新しいタブが閉じ、B の既存タブが前に出る。タブ一覧も B になる（L の順番に直した後） |
| 2 つの案件の名前を含む資料を開く | 動かない |
| 自動で移ったタブを手で戻し、そのタブ内で別のページへ移動する | 戻した先に留まる |
| 手で戻したタブを残して Vivaldi を再起動し、mod を貼り直してから別の案件のページを開く | 動かない（`vivExtData` の独自キー `wsrManual` が再起動後も残る） |
| Salesforce の商談を開く | タイトル確定後に正しい案件へ移動する |
| タブを複製する | 複製したタブが残る |
| 重複として閉じられた資料を 1 分以内に開き直す | 2 回目は残る |
| Shift+F12（アドレスバー / ページ本文） | どちらでも一時停止・再開が切り替わる |

未確認：一時停止のウィンドウ間の共有（`BroadcastChannel`）。貼り付けた mod は 1 つのウィンドウでしか動かないため、Phase 4 でインストールした後に確かめる。

## Phase 4 の実機確認（2026-10-24）

| 確認したこと | 結果 |
| --- | --- |
| `./install.sh` → Vivaldi 再起動 | 貼り付けなしで mod が動く |
| 再起動時に Vivaldi が更新された場合（8.2.4133.87 → .94） | 組み込んだ版が使われなくなり mod が外れた。`./install.sh` を再実行して直った（更新のたびに外れることを実機で確認） |
| LaunchAgent から `install.sh --auto`（mod を外した状態） | 書き込みは `Operation not permitted`（I）。「入れ直しますか？」のダイアログ → 「入れ直す」で iTerm2 が開き、`install.sh` で入れ直せた |
