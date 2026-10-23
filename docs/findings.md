# 検証結果（Phase 1: Spike）

`docs/design.md`「実装前に検証すべき事項」の実機確認結果。手順は `spike/README.md`。

- 検証日:
- Vivaldi バージョン:
- macOS バージョン:
- UI DevTools の開き方: （`vivaldi://inspect/#apps` のみ / 起動フラグが必要）

状態: ⬜ 未確認 / ✅ 設計どおり / ⚠️ 設計と違う（設計を更新） / ❌ 不可（代替案が必要）

| # | 検証事項 | 確認方法 | 状態 | 結果 |
| --- | --- | --- | --- | --- |
| 1 | mod を読み込む HTML のファイル名 | `spike.env()`、`check-bundle.sh` | ⬜ | |
| 2 | タブの拡張データのプロパティ名と `workspaceId` の形 | `spike.tabs()` | ⬜ | |
| 3 | ワークスペース一覧の設定キーと構造、変更の購読 | `spike.workspaces()`、`spike.watchPrefs()` | ⬜ | |
| 4 | `workspaceId` を書き換えたとき、タブバーが即座に追従するか | `spike.moveTest()` + 目視 | ⬜ | |
| 5 | 別ワークスペースのタブを `active: true` にするとワークスペースも切り替わるか | `spike.activateTest()` + 目視 | ⬜ | |
| 6 | ハイバネート中のタブでも URL とタイトルが取れるか | `spike.hibernated()` | ⬜ | |
| 7 | ウェブパネルとアプリウィンドウを `chrome.tabs` の情報だけで除外できるか | `spike.windows()`、`spike.watch()` | ⬜ | |
| 8 | 実タイトルに顧客名が入るか（Salesforce 商談 / Slides / Celonis） | `spike.titles()` | ⬜ | |
| 9 | Celonis の URL 構造（重複キーに使う部分） | `spike.titles()` | ⬜ | |
| 10 | アプリバンドルへの書き込みが会社の Mac で許可されるか | `check-bundle.sh` | ⬜ | |

## 追加で確認する事項

設計書の一覧にはないが、実装に必要なため同じスニペットで確かめる。

| # | 検証事項 | 確認方法 | 状態 | 結果 |
| --- | --- | --- | --- | --- |
| A | 手動でワークスペースを移したとき `onUpdated` が拡張データの変化を通知するか（F6 の検出経路） | `spike.watch()` 中に手動移動 | ⬜ | |
| B | Salesforce / Slides でタイトルが確定するまでの時間（デバウンス 800ms と自動移動 30 秒の妥当性） | `spike.watch()` | ⬜ | |
| C | 今アクティブなワークスペースの取得方法（window の拡張データか設定値か） | `spike.activateTest()`、`spike.watchPrefs()` | ⬜ | |
| D | `vivaldi.prefs.get` がコールバック形式か Promise 形式か | `spike.workspaces()` | ⬜ | |

## 詳細

（`spike.report()` の JSON と `check-bundle.sh` の出力から、項目ごとに要点を書く）

## 設計への反映

（設計と食い違った点と、`docs/design.md` で変えた箇所）
