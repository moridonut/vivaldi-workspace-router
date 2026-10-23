# Phase 1: 検証（Spike）の手順

`docs/design.md` の「実装前に検証すべき事項」を実機の Vivaldi で確かめるためのスニペットです。
結果は `docs/findings.md` にまとめます。

## 0. 準備

検証用に、ワークスペースを2つ以上用意してください（中身は何でも構いません）。可能なら次も開いておくと、1回で全部確かめられます。

- 案件ワークスペースに Salesforce 商談、Google Slides、Celonis ダッシュボードのタブを各 2〜3 件
- ハイバネートしたタブ 1 件以上（タブを右クリック → ハイバネート）
- ウェブパネル 1 つ、インストールしたアプリ（Gmail の PWA など）のウィンドウ 1 つ

## 1. UI の DevTools を開く

1. Vivaldi のアドレスバーで `vivaldi://inspect/#apps` を開く
2. 一覧の Vivaldi の項目（`window.html` か `browser.html`）の **inspect** を押す
3. 一覧に出ない場合は Vivaldi を終了し、ターミナルから次で起動してもう一度試す

   ```sh
   open -a Vivaldi --args --debug-packed-apps --silent-debugger-extension-api
   ```

（どちらの方法で開けたかも findings に書くので覚えておいてください）

## 2. スニペットを貼り付ける

`spike/spike.js` の中身をすべてコピーし、開いた DevTools の Console に貼り付けて Enter。
貼り付けを止める警告が出たら、指示どおり `allow pasting` と入力してから貼り直してください。

## 3. 順に実行する

Console に1行ずつ入力します。各コマンドは結果を Console に出し、`spike.results` に貯めます。

```js
await spike.env()          // [1] HTML ファイル名、API の有無
await spike.tabs()         // [2] タブの拡張データ
await spike.workspaces()   // [3] ワークスペース一覧
await spike.moveTest()     // [4] example.com のテストタブを作り、別ワークスペースへ移す
spike.visual('moveTest', '見たままを書く')     // 例: 即座にタブバーから消え、移動先に出た
await spike.activateTest() // [5] 別ワークスペースにあるテストタブをアクティブにする
spike.visual('activateTest', '見たままを書く') // 例: ワークスペースも切り替わった
await spike.hibernated()   // [6] ハイバネート中のタブ
await spike.windows()      // [7] ウィンドウ種別とウェブパネル
await spike.titles()       // [8][9] タイトルに顧客名が入るか、URL 構造
spike.watch(90)            // 90 秒間タブイベントを記録（表示される指示どおり操作する）
spike.watchPrefs(30)       // 30 秒間ワークスペース関連の設定変更を記録（ワークスペースを切り替えてみる）
spike.report()             // 全結果の JSON をクリップボードへ
```

`spike.moveTest()` が作る example.com のタブは確認が終わったら手で閉じてください。スニペットは既存タブを閉じたり動かしたりしません。

## 4. ターミナルで確認する（[1][10]）

```sh
bash spike/check-bundle.sh
```

HTML のファイル名、アプリバンドル内に書き込めるか、会社の MDM 管理下かを表示します。何も書き換えません。

## 5. 結果を渡す

- `spike.report()` でコピーした JSON
- `check-bundle.sh` の出力
- 目視で気づいたこと（特に [4][5]）

を Claude Code に貼り付けてください。`docs/findings.md` にまとめ、設計と食い違う点があれば `docs/design.md` を更新します。

## プライバシー

リポジトリは public です。`spike.report()` の JSON には、顧客名・タブのタイトル・URL の実値を入れていません（文字数、キー名、ID を伏せた URL の形だけ）。実際のタイトルや名前は Console の「ローカル表示のみ」の行にだけ出ます。貼り付ける前に念のため JSON を見てください。
