# 検証結果（Phase 1: Spike）

`docs/design.md`「実装前に検証すべき事項」の実機確認結果。手順は `spike/README.md`。

- 検証日: 2026-10-24（1 回目）
- Vivaldi バージョン: 8.2.4133.84（Chromium 152）
- macOS: Intel Mac（UA 上は 10_15_7 固定のため実バージョン不明）、Kandji の MDM 管理下（DEP 登録）
- UI DevTools の開き方: （未記録）

状態: ⬜ 未確認 / ✅ 設計どおり / ⚠️ 設計と違う（設計を更新） / ❌ 不可（代替案が必要）

| # | 検証事項 | 状態 | 結果 |
| --- | --- | --- | --- |
| 1 | mod を読み込む HTML のファイル名 | ✅ | `window.html`（UI は `chrome-extension://mpognobbkildjkofajifpdfhcoklimli/window.html`）。同じフォルダに `main.html` もある。`window.html` に `<script>` タグが見つからなかったため、中身を 2 回目で確認する |
| 2 | タブの拡張データのプロパティ名と `workspaceId` の形 | ✅ | `tab.vivExtData`、JSON 文字列。`workspaceId` は number（例 `1768800948103`、ミリ秒時刻のような値）。ほかのキーは `ext_id`、`parent_ext_id`、`restoreStatus`、`panelId` |
| 3 | ワークスペース一覧の設定キーと構造、変更の購読 | ⚠️ | キーは `vivaldi.workspaces.list` で合っている。ただし `vivaldi.prefs.get` は配列そのものではなく `{ value, defaultValue, store }` を返し、一覧は `.value`。要素は `{ id: number, name: string, icon: string }`。`vivaldi.prefs.onChanged` はある。通知の中身は未確認 |
| 4 | `workspaceId` を書き換えたとき、タブバーが即座に追従するか | ⬜ | 1 回目は #3 の包み形式をスニペットが読めず中止。修正済みのため再実行する |
| 5 | 別ワークスペースのタブを `active: true` にするとワークスペースも切り替わるか | ⬜ | #4 が中止したため、同じワークスペースのタブで試してしまい判定できず。再実行する |
| 6 | ハイバネート中のタブでも URL とタイトルが取れるか | ✅ | 7/7 件で `url`・`title`・`workspaceId` が取れた。`status` は `"unloaded"`、`discarded: true` |
| 7 | ウェブパネルとアプリウィンドウを `chrome.tabs` の情報だけで除外できるか | ⚠️ | アプリ（PWA）ウィンドウは `window.type === "app"`、DevTools は `"devtools"` で除外できる。**ウェブパネルは通常ウィンドウの中のタブ**として出てきて、`vivExtData.panelId` を持つ（`workspaceId` はない）。「通常ウィンドウ以外」の条件だけでは除外できない |
| 8 | 実タイトルに顧客名が入るか（Salesforce 商談 / Slides / Celonis） | ⬜ | 1 回目は #3 の不具合でワークスペース名を照合できず。Slides 10 件、Salesforce 商談 3 件は開いていた。再実行する |
| 9 | Celonis の URL 構造（重複キーに使う部分） | ⬜ | 1 回目で拾えたのは社内 Confluenceだけで、EMS のダッシュボードは含まれていなかった。Celonis のダッシュボードを開いた状態で再実行する |
| 10 | アプリバンドルへの書き込みが会社の Mac で許可されるか | ❌ | `touch` が `Operation not permitted`。フォルダの所有者は本人（`<user>:admin drwxr-xr-x`）なので、通常のファイル権限ではなく macOS の「アプリ管理」保護に止められている。Kandji の MDM 管理下なので、この権限が会社ポリシーで固定されている可能性がある |

## 追加で確認する事項

| # | 検証事項 | 状態 | 結果 |
| --- | --- | --- | --- |
| A | 手動でワークスペースを移したとき `onUpdated` が拡張データの変化を通知するか（F6 の検出経路） | ⬜ | 1 回目の `watch` では `activated` が 2 件だけで、タブの作成・更新は記録されなかった（操作しなかったのか、イベントが来なかったのかは不明）。再実行する |
| B | Salesforce / Slides でタイトルが確定するまでの時間 | ⬜ | 同上 |
| C | 今アクティブなワークスペースの取得方法 | ⬜ | ウィンドウの `vivExtData` には workspace 関連のキーがない（キーは `PANEL_WIDTH`、`SELECTED_PANEL`、`SHOW_PANEL`、`SHOW_PANEL_CONTENT`、`ext_id`、`fullScreen`、`visibleUI`）。アクティブなタブの `workspaceId` から求める方法を 2 回目で確かめる |
| D | `vivaldi.prefs.get` がコールバック形式か Promise 形式か | ✅ | どちらかで値が返った（スニペットは両対応のため、どちらかは区別していない）。値が包み形式である点は #3 |
| E | `workspaceId` を持たないタブ | ⬜ | 通常ウィンドウの 29 タブのうち 2 件に `workspaceId` がない。1 件はウェブパネル。もう 1 件が「どのワークスペースにも属さないタブ」なのかを 2 回目で確かめる |

## 詳細

### #3 `vivaldi.prefs.get('vivaldi.workspaces.list')` の戻り値

```js
{
  value: [ { id: number, name: string, icon: string /* 長い文字列。SVG か data URL と思われる */ }, ... ],
  defaultValue: [],
  store: string, // 4 文字。"user" と思われる
}
```

`vivaldi.prefs` には `get` のほかに `getForCache`、`set`、`onChanged` がある。

### #7 ウィンドウ種別

| window.type | 中身 | 扱い |
| --- | --- | --- |
| `normal` | 通常タブ、`chrome://` タブ 3 件、ウェブパネル 1 件（`panelId` あり） | 対象。ただしパネルと内部ページは除外する |
| `app` | PWA 1 タブずつ（`vivExtData` は `ext_id` のみ） | 除外 |
| `devtools` | `devtools://` | 除外 |

### #10 アプリバンドルへの書き込み

- 結果: `Operation not permitted`
- 署名: `Identifier=com.vivaldi.Vivaldi`、`TeamIdentifier=4XF3XNRN6Y`
- MDM: Kandji（`Enrolled via DEP: Yes`、`MDM enrollment: Yes (User Approved)`）

次の順で確かめる。

1. システム設定 → プライバシーとセキュリティ → アプリ管理 で、ターミナル（または iTerm）をオンにできるか。項目がグレーアウトしていれば、MDM が固定している
2. 許可できた場合は `bash spike/check-bundle.sh` を再実行して OK になるか
3. 許可できない場合は、mod の導入方法を考え直す必要がある（設計の「インストールとアップデート追従」に影響）。社内 IT ポリシーとの確認も必要

## 設計への反映

- 「全体アーキテクチャ」の使う API：`vivaldi.prefs.get` の戻り値は `.value` に一覧が入る形式だと追記した（#3）
- 「振り分けロジック」の対象外：ウェブパネルは「通常ウィンドウ以外」ではなく、`vivExtData.panelId` を持つタブとして除外するよう変えた（#7）
- #10 の結果次第で「インストールとアップデート追従」の見直しが必要。未反映
