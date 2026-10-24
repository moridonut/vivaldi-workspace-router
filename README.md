# vivaldi-workspace-router

新しく開いたタブを、タイトルや URL に含まれる顧客名で見分けて、案件ごとの Vivaldi ワークスペースへ自動で移す mod です。同じ資料をもう一度開いたときは、新しいタブを閉じて既存のタブを前に出します。

- Slack やメールのリンクを開いても、今いるワークスペースではなく、その案件のワークスペースに入る
- 同じ Slides や Salesforce の商談が何枚も開かない
- 外部との通信はなく、判定も設定もすべて手元の Mac の中で完結する

対象は macOS 版 Vivaldi です（8.2 で確認）。設計と検証の記録は [`docs/design.md`](docs/design.md) と [`docs/findings.md`](docs/findings.md) にあります。

## しくみ

Vivaldi の画面（UI）は HTML と JavaScript でできています。この mod は、アプリの中の `window.html` に 1 本のスクリプトを読み込ませ、タブが開いたりタイトルが変わったりするたびに判定します。

1. タイトルと URL を、ワークスペース名と設定した別名（`aliases`）に照らし合わせる
2. ちょうど 1 つのワークスペースに一致したら、そこへ移して切り替える
3. 移動先に同じ資料がすでにあれば、新しいタブを閉じて既存のタブを前に出す

一致しないタブや、2 つ以上の案件に一致したタブは動かしません。

## 導入

### 1. ターミナルに「アプリ管理」を許可する

mod はアプリ（`/Applications/Vivaldi.app`）の中を書き換えるため、macOS の許可が要ります。

**システム設定 → プライバシーとセキュリティ → アプリ管理** で、使っているターミナル（iTerm2 など）をオンにします。会社の Mac で項目がグレーアウトしている場合は、MDM で禁止されているので導入できません。

### 2. 取得して設定を書く

```sh
git clone https://github.com/moridonut/vivaldi-workspace-router.git
cd vivaldi-workspace-router
cp src/config.local.example.js src/config.local.js
```

`src/config.local.js` に、案件ごとの別名を書きます（書き方は次の「設定」）。このファイルは Git に入らないので、顧客名を書いて構いません。

最初は `dryRun: true` のままにしておくと、実際には動かさず、判定をログに出すだけになります（「試運転」）。

### 3. 組み込む

```sh
./install.sh
```

Vivaldi を再起動すると有効になります。設定を変えたときも、もう一度 `./install.sh` を実行して再起動します。

### 4. Vivaldi の更新に備える

Vivaldi が更新されるとアプリの中身が入れ替わり、mod が外れます。次を一度実行しておくと、更新のたびに知らせてくれます。

```sh
./install.sh --agent
```

更新後に mod が外れていると、「Workspace Router を入れ直しますか？」というダイアログが出ます。「入れ直す」を押すと iTerm2 が開いて `install.sh` が実行されるので、終わったら Vivaldi を再起動します。初回だけ、macOS が「iTerm を制御しようとしています」と確認するので許可します。

自動で入れ直さずにダイアログを挟むのは、裏で動く仕組み（launchd）にはアプリ管理の許可が効かず、アプリの中を書き換えられないためです。

## 設定

`src/config.local.js` に書いた項目だけが、既定値（[`src/config.js`](src/config.js)）を上書きします。

```js
export default {
  dryRun: false,
  ignoreWorkspaces: ['個人'],
  aliases: {
    'サンプル工業': ['Sample Industries', 'SMPL', 'url:sampleind.bi.example.com'],
    'アクメ':       ['ACME', 'アクメ', 'url:acme.bi.example.com'],
  },
};
```

### 別名（aliases）の書き方

- **左側**：Vivaldi のワークスペース名を、画面に出ているとおりに書く（大文字と小文字の違いは問わない）
- **右側**：そのワークスペースだと分かる目印を並べる
  - ふつうの文字は、タイトルと URL の両方から探す
  - `url:` で始まるものは、URL の中だけを探す。タイトルに顧客名が出ないページ（Celonis のアプリなど）に使う
- ワークスペース名そのものは、書かなくても自動で目印になる

照合のきまりは次のとおりです。

| きまり | 例 |
| --- | --- |
| 全角と半角、大文字と小文字は区別しない | `ＳＭＰＬ` も `smpl` も `SMPL` に一致 |
| 「株式会社」「(株)」「Inc.」「Ltd.」などの法人格は無視する | `サンプル工業株式会社` は `サンプル工業` に一致 |
| 英字は単語単位で一致する | `ABC` は `ABC-提案` に一致するが、`ABCD` には一致しない |
| 日本語は文中のどこにあっても一致する | `サンプル工業様向け` は `サンプル工業` に一致 |
| 短すぎる目印は無視する | 英字は 3 文字未満、日本語は 2 文字未満 |
| 名前が重なる案件は長い方を優先する | `帝都` と `帝都物流` があると、`帝都物流様` は `帝都物流` だけに一致 |

### 目印の選び方

ふだん開くタブのタイトルを見て、**その案件にしか出てこない文字**を選びます。

- Salesforce の商談名に入る英語の社名（例：`SAMPLE INDUSTRIES`）
- Slides のファイル名でよく使う略称（例：`SMPL`）
- 案件ごとに異なる URL の一部。サブドメインやレコード ID など（例：`url:sampleind.bi.example.com`）

`Celonis`、`QBR`、`提案` のように、どの案件にも出てくる言葉は避けます。`SCREEN` のような一般的な英単語や、担当者の名字も、ほかのページに当たることがあるので、試運転で様子を見てから決めます。

起動時のログに `config warning unknown-workspace` が出たら、左側のワークスペース名が Vivaldi の名前と合っていません。

### そのほかの設定

| 項目 | 既定値 | 内容 |
| --- | --- | --- |
| `dryRun` | `true` | `true` の間は移動・切替・クローズをせず、判定をログに出すだけ |
| `switchOnMove` | `true` | 移動したら、移動先のワークスペースに切り替える |
| `dedupe` | `true` | 移動先に同じ資料があれば、新しいタブを閉じる |
| `dedupeUnmatched` | `false` | どの案件にも一致しないタブも、今のワークスペースの中で重複処理する |
| `dedupeReopenGraceMs` | `60000` | 重複として閉じた資料をこの時間内に開き直したら、わざととみなして残す |
| `routeWindowMs` | `30000` | タブを開いて（またはページを移動して）からこの時間を過ぎたら、自動では動かさない |
| `debounceMs` | `800` | タイトルの変化が落ち着くまで待つ時間 |
| `ignoreWorkspaces` | `[]` | 振り分け先にしないワークスペース |
| `minKeywordLength` | `3` | 英字の目印の最短の長さ |
| `minKeywordLengthNonAscii` | `2` | 日本語の目印の最短の長さ |
| `toggleShortcut` | `'Shift+F12'` | 一時停止・再開のショートカット（Cmd / Alt / Shift / Ctrl と、英数字 1 文字か F1〜F24） |
| `debug` | `false` | 判定ごとの詳しいログを出す |

## 日々の使い方

- **一時停止・再開**：Shift+F12（キーボードによっては fn+Shift+F12）。画面の右下に「一時停止」「再開」と出て、全ウィンドウに効きます。Vivaldi を再起動すると再開した状態に戻ります。
- **手で移したタブ**：自動で移ったタブを手で別のワークスペースに移すと、そのタブは以後自動では動かしません。再起動しても覚えています。
- **わざと同じ資料を開きたいとき**：タブを右クリックして「タブを複製」したものは閉じません。Slack などから開いて閉じられた直後（1 分以内）に開き直した場合も残ります。
- **状態の確認**：`./install.sh --status`

### ログを見る

判定の様子は、Vivaldi の UI の DevTools で見られます。`vivaldi://inspect/#apps` を開き、`window.html` の **inspect** を押します（一覧に出ない場合は、Vivaldi を `open -a Vivaldi --args --debug-packed-apps --silent-debugger-extension-api` で起動し直します）。

Console に `[workspace-router]` で始まる行が出ます。次のコマンドも使えます。

```js
workspaceRouter.status()          // 状態
workspaceRouter.toggle()          // 一時停止 / 再開
workspaceRouter.setDryRun(true)   // Vivaldi を再起動するまで試運転にする
```

試運転で確かめる項目は [`docs/dry-run.md`](docs/dry-run.md) にまとめてあります。

## アンインストール

```sh
./install.sh --remove-agent   # 更新時のダイアログを止める
./install.sh --uninstall      # window.html を元に戻し、スクリプトを消す
```

Vivaldi を再起動すると、mod のない状態に戻ります。リポジトリのフォルダは消して構いません（`~/Library/Logs/vivaldi-workspace-router.*` も不要なら消します）。

## 既知の制約

- **Vivaldi の更新のたびに入れ直しが要る**：ダイアログから入れ直し、Vivaldi を再起動します。再起動のタイミングで更新が入ると、直後に mod が外れることがあります。
- **macOS の許可と会社のポリシー**：アプリの中を書き換えるため、ターミナルに「アプリ管理」の許可が要ります。MDM で禁止されている Mac では使えません。導入前に社内ポリシーを確認してください。
- **Celonis の重複判定**：URL に資料の ID が入らないページ（スペース一覧など）は、重複かどうか判断できないので閉じません。
- **2 つ以上の案件に一致したタブ**：動かさず、ログに候補を出すだけです（タイトルに印を付ける機能は見送りました）。
- **手で移したタブは二度と自動では動かない**：そのタブで別の案件のページを開いても動きません。
- **起動時に開いていたタブ**：Vivaldi を起動したときにすでにあるタブは、ページを移動するまで扱いません。重複として閉じることもありません。
- **閉じるのは新しいタブだけ**：mod が読み込まれた後に開いた、開いてから 30 秒以内のタブしか閉じません。既存のタブは閉じません。
- **対象外**：ピン留めタブ、ウェブパネル、PWA などのアプリウィンドウ、`vivaldi://` などの内部ページ。
- **Vivaldi の内部の仕組みに依存**：公開されていない API（タブの拡張データなど）を使っているので、Vivaldi の大きな更新で動かなくなる可能性があります。そのときは `docs/findings.md` の検証をやり直します。

## 開発

```sh
npm test        # node --test（外部ライブラリは使わない）
./build.sh      # src/ を dist/workspace-router.js に 1 ファイルにまとめる
```

| パス | 内容 |
| --- | --- |
| `src/matcher.js` | タイトルと URL から振り分け先を決める純粋関数 |
| `src/normalize.js` | URL から重複判定のキーを作る純粋関数 |
| `src/router.js` | イベント処理と判定の流れ。Vivaldi 固有の呼び出しは末尾の `createVivaldiAdapter()` だけ |
| `src/config.js` | 既定の設定（public なので顧客名は書かない） |
| `install.sh` | 組み込み、アンインストール、LaunchAgent |
| `spike/` | Vivaldi の内部 API を確かめた検証スニペット |
| `test/` | 単体テスト。router は偽のアダプタ、install.sh は偽の Vivaldi.app で確かめる |
