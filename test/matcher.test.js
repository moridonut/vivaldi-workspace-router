import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeText, buildIndex, matchTab, decide } from '../src/matcher.js';

const ws = (id, name) => ({ id, name });

const ids = (index, tab) => matchTab(index, tab).map((m) => m.workspaceId);

// ---- normalizeText ---------------------------------------------------------

test('normalizeText: 全角英数を半角に、小文字に', () => {
  assert.equal(normalizeText('ＡＣＭＥ　Ｃｏｒｐ１２３'), 'acme corp123');
});

test('normalizeText: 日本語の法人格を除く', () => {
  assert.equal(normalizeText('株式会社サンプル工業'), 'サンプル工業');
  assert.equal(normalizeText('サンプル工業株式会社'), 'サンプル工業');
  assert.equal(normalizeText('(株)サンプル工業'), 'サンプル工業');
  assert.equal(normalizeText('㈱サンプル工業'), 'サンプル工業');
  assert.equal(normalizeText('（株）サンプル工業'), 'サンプル工業');
  assert.equal(normalizeText('有限会社サンプル'), 'サンプル');
  assert.equal(normalizeText('合同会社サンプル'), 'サンプル');
});

test('normalizeText: 英語の法人格を除く', () => {
  assert.equal(normalizeText('Acme Inc.'), 'acme');
  assert.equal(normalizeText('ACME LTD.-Direct Deal'), 'acme -direct deal');
  assert.equal(normalizeText('Acme Corporation'), 'acme');
  assert.equal(normalizeText('Acme, LLC'), 'acme,');
});

test('normalizeText: 法人格に似た単語の一部は消さない', () => {
  assert.equal(normalizeText('Incredible Ltdx'), 'incredible ltdx');
});

test('normalizeText: 連続する空白を 1 つにまとめる', () => {
  assert.equal(normalizeText('  Sample   Industries '), 'sample industries');
});

// ---- 英字キーワードの単語境界 ----------------------------------------------

test('英字: 大文字小文字を区別しない', () => {
  const index = buildIndex([ws(1, 'Acme')]);
  assert.deepEqual(ids(index, { title: 'ACME QBR deck', url: 'https://example.com/' }), [1]);
  assert.deepEqual(ids(index, { title: 'acme qbr deck', url: 'https://example.com/' }), [1]);
});

test('英字: 全角で書かれたタイトルにも一致する', () => {
  const index = buildIndex([ws(1, 'Acme')]);
  assert.deepEqual(ids(index, { title: 'ＡＣＭＥ 定例', url: 'https://example.com/' }), [1]);
});

test('英字: 単語の一部には一致しない', () => {
  const index = buildIndex([ws(1, 'ABC')]);
  assert.deepEqual(ids(index, { title: 'ABCD kickoff', url: 'https://example.com/' }), []);
  assert.deepEqual(ids(index, { title: 'XABC kickoff', url: 'https://example.com/' }), []);
  assert.deepEqual(ids(index, { title: 'ABC1 kickoff', url: 'https://example.com/' }), []);
});

test('英字: 記号や日本語に挟まれていれば一致する', () => {
  const index = buildIndex([ws(1, 'ABC')]);
  for (const title of ['ABC-kickoff', '[ABC] kickoff', 'abc_kickoff', '2026/10/14 ABC様向け', 'ABC']) {
    assert.deepEqual(ids(index, { title, url: 'https://example.com/' }), [1], title);
  }
});

test('英字: 空白を含むキーワード', () => {
  const index = buildIndex([ws(1, 'Sample Industries')]);
  assert.deepEqual(ids(index, { title: 'Sample  Industries - Opportunity', url: 'https://example.com/' }), [1]);
  assert.deepEqual(ids(index, { title: 'Sample Industriesx', url: 'https://example.com/' }), []);
});

test('英字: URL の中でも単語境界で一致する', () => {
  const index = buildIndex([ws(1, 'acme')]);
  assert.deepEqual(ids(index, { title: 'Home', url: 'https://www.acme.co.jp/ir/' }), [1]);
  assert.deepEqual(ids(index, { title: 'Home', url: 'https://docs.google.com/d/1xAcmeZ9/edit' }), []);
});

// ---- 日本語キーワードの部分一致 --------------------------------------------

test('日本語: 部分一致する', () => {
  const index = buildIndex([ws(1, 'サンプル工業')]);
  assert.deepEqual(ids(index, { title: '2026/10/14 サンプル工業様向け提案', url: 'https://example.com/' }), [1]);
  assert.deepEqual(ids(index, { title: 'サンプル工業株式会社_定例', url: 'https://example.com/' }), [1]);
});

test('日本語: 法人格の有無が違っても一致する', () => {
  const index = buildIndex([ws(1, '株式会社サンプル工業')]);
  assert.deepEqual(ids(index, { title: 'サンプル工業様 定例', url: 'https://example.com/' }), [1]);
  assert.deepEqual(ids(index, { title: '(株)サンプル工業 提案', url: 'https://example.com/' }), [1]);
});

test('日本語: 半角カナと全角カナを同一視する', () => {
  const index = buildIndex([ws(1, 'サンプル工業')]);
  assert.deepEqual(ids(index, { title: 'ｻﾝﾌﾟﾙ工業 提案', url: 'https://example.com/' }), [1]);
});

test('日本語: URL エンコードされた URL にも一致する', () => {
  const index = buildIndex([ws(1, 'サンプル工業')]);
  const url = 'https://example.com/search?q=' + encodeURIComponent('サンプル工業');
  assert.deepEqual(ids(index, { title: 'Search', url }), [1]);
});

// ---- 別名 ------------------------------------------------------------------

test('別名: ワークスペース名に加えて別名でも一致する', () => {
  const index = buildIndex([ws(1, 'サンプル工業')], { aliases: { 'サンプル工業': ['Sample Industries', 'SMPL'] } });
  assert.deepEqual(ids(index, { title: 'SAMPLE INDUSTRIES LTD.-Renewal', url: 'https://example.com/' }), [1]);
  assert.deepEqual(ids(index, { title: 'SMPL QBR', url: 'https://example.com/' }), [1]);
  assert.deepEqual(ids(index, { title: 'サンプル工業様', url: 'https://example.com/' }), [1]);
});

test('別名: 名前と別名の両方に一致しても 1 件として数える', () => {
  const index = buildIndex([ws(1, 'サンプル工業')], { aliases: { 'サンプル工業': ['SMPL'] } });
  const m = matchTab(index, { title: 'サンプル工業 SMPL', url: 'https://example.com/' });
  assert.equal(m.length, 1);
  assert.deepEqual(m[0].keywords.sort(), ['smpl', 'サンプル工業']);
});

test('別名: 設定のキーは正規化して照合する（全角や法人格の違いを許す）', () => {
  const index = buildIndex([ws(1, '株式会社サンプル工業')], { aliases: { 'サンプル工業': ['SMPL'] } });
  assert.deepEqual(ids(index, { title: 'SMPL QBR', url: 'https://example.com/' }), [1]);
});

// ---- url: 別名 -------------------------------------------------------------

test('url: 別名は URL にだけ照合する', () => {
  const index = buildIndex([ws(1, 'アクメ')], { aliases: { 'アクメ': ['url:acme.bi.example.com'] } });
  assert.deepEqual(
    ids(index, { title: 'Celonis | Apps', url: 'https://acme.bi.example.com/package-manager/ui/views/ui/spaces' }),
    [1]
  );
  assert.deepEqual(ids(index, { title: 'acme.bi.example.com のメモ', url: 'https://example.com/' }), []);
});

test('url: 別名は大文字小文字を区別しない', () => {
  const index = buildIndex([ws(1, 'アクメ')], { aliases: { 'アクメ': ['url:Opportunity/006ABC'] } });
  assert.deepEqual(
    ids(index, { title: 'Lightning Experience', url: 'https://x.lightning.force.com/lightning/r/opportunity/006abc0000001/view' }),
    [1]
  );
});

test('url: 別名は部分一致（ID の一部でも拾う）', () => {
  const index = buildIndex([ws(1, 'アクメ')], { aliases: { 'アクメ': ['url:space=abc123'] } });
  assert.deepEqual(ids(index, { title: 'x', url: 'https://example.com/?space=abc123&x=1' }), [1]);
});

// ---- 短いキーワードと除外 --------------------------------------------------

test('2 文字以下のキーワードは無視して警告を返す', () => {
  const index = buildIndex([ws(1, 'AB'), ws(2, 'サンプル工業')], { aliases: { 'サンプル工業': ['SM', 'url:ab'] } });
  assert.deepEqual(ids(index, { title: 'AB SM', url: 'https://ab.example.com/' }), []);
  assert.equal(index.warnings.length, 3);
  assert.ok(index.warnings.every((w) => w.reason === 'too-short'));
});

test('法人格を除いた結果が短すぎるキーワードも無視する', () => {
  const index = buildIndex([ws(1, '株式会社AB')]);
  assert.deepEqual(ids(index, { title: 'AB 提案', url: 'https://example.com/' }), []);
  assert.equal(index.warnings.length, 1);
});

test('日本語を含むキーワードは 2 文字から有効', () => {
  const index = buildIndex([ws(1, '帝都'), ws(2, '株式会社帝')]);
  assert.deepEqual(ids(index, { title: '帝都様 定例', url: 'https://example.com/' }), [1]);
  assert.equal(index.warnings.length, 1);
  assert.equal(index.warnings[0].workspace, '株式会社帝');
});

test('minKeywordLength / minKeywordLengthNonAscii で最短の長さを変えられる', () => {
  const index = buildIndex([ws(1, 'AB'), ws(2, '帝都')], { minKeywordLength: 2, minKeywordLengthNonAscii: 3 });
  assert.deepEqual(ids(index, { title: 'AB 帝都', url: 'https://example.com/' }), [1]);
});

test('ignoreWorkspaces のワークスペースは振り分け先にしない', () => {
  const index = buildIndex([ws(1, 'Inbox'), ws(2, '個人用メモ')], { ignoreWorkspaces: ['Inbox', '個人用メモ'] });
  assert.deepEqual(ids(index, { title: 'Inbox (3) 個人用メモ', url: 'https://example.com/' }), []);
});

test('ワークスペースが存在しない別名の設定は警告を返す', () => {
  const index = buildIndex([ws(1, 'サンプル工業')], { aliases: { '存在しない案件': ['ZZZZ'] } });
  assert.equal(index.warnings.length, 1);
  assert.equal(index.warnings[0].reason, 'unknown-workspace');
});

test('タイトルや URL が空でも落ちない', () => {
  const index = buildIndex([ws(1, 'Acme')]);
  assert.deepEqual(ids(index, {}), []);
  assert.deepEqual(ids(index, { title: null, url: undefined }), []);
  assert.deepEqual(ids(index, { title: 'Acme', url: '%E0%A4%A' }), [1]);
});

// ---- 一致数 ----------------------------------------------------------------

test('一致 0 / 1 / 2 件', () => {
  const index = buildIndex([ws(1, 'Acme'), ws(2, 'Globex'), ws(3, 'サンプル工業')]);
  assert.deepEqual(ids(index, { title: '社内勉強会', url: 'https://example.com/' }), []);
  assert.deepEqual(ids(index, { title: 'Globex renewal', url: 'https://example.com/' }), [2]);
  assert.deepEqual(ids(index, { title: 'Acme vs Globex 比較', url: 'https://example.com/' }).sort(), [1, 2]);
  assert.deepEqual(ids(index, { title: 'Acme 向け', url: 'https://x.example.com/サンプル工業' }).sort(), [1, 3]);
});

// ---- 名前が重なる案件は長い方を優先 ----------------------------------------

test('重なり: 短い名前が長い名前の一部としてだけ出ていれば長い方だけに一致', () => {
  const index = buildIndex([ws(1, '帝都'), ws(2, '帝都物流')]);
  assert.deepEqual(ids(index, { title: '帝都物流様 定例', url: 'https://example.com/' }), [2]);
  assert.deepEqual(ids(index, { title: '帝都様 定例', url: 'https://example.com/' }), [1]);
});

test('重なり: 短い名前が単独でも出ていれば両方に一致（conflict）', () => {
  const index = buildIndex([ws(1, '帝都'), ws(2, '帝都物流')]);
  assert.deepEqual(ids(index, { title: '帝都 / 帝都物流 合同定例', url: 'https://example.com/' }).sort(), [1, 2]);
});

test('重なり: 英字キーワードでも長い方を優先', () => {
  const index = buildIndex([ws(1, 'Acme'), ws(2, 'Acme Japan')]);
  assert.deepEqual(ids(index, { title: 'ACME JAPAN QBR', url: 'https://example.com/' }), [2]);
  assert.deepEqual(ids(index, { title: 'ACME QBR', url: 'https://example.com/' }), [1]);
});

test('重なり: 別名同士でも長い方を優先', () => {
  const index = buildIndex([ws(1, 'アクメ'), ws(2, 'アクメ物流')], {
    aliases: { 'アクメ': ['ACME'], 'アクメ物流': ['ACME Logistics'] },
  });
  assert.deepEqual(ids(index, { title: 'ACME Logistics 提案', url: 'https://example.com/' }), [2]);
});

test('重なり: タイトルと URL は別々に判定する', () => {
  const index = buildIndex([ws(1, 'アクメ'), ws(2, 'アクメ物流')], {
    aliases: { 'アクメ': ['url:acme.bi.example.com'] },
  });
  // URL では アクメ、タイトルでは アクメ物流 → 別の場所なので両方残る
  assert.deepEqual(
    ids(index, { title: 'アクメ物流 資料', url: 'https://acme.bi.example.com/x' }).sort(),
    [1, 2]
  );
});

test('重なり: 同じ長さの同じキーワードが 2 つのワークスペースにあれば conflict', () => {
  const index = buildIndex([ws(1, 'アクメ'), ws(2, 'アクメ物流')], { aliases: { 'アクメ物流': ['アクメ'] } });
  assert.deepEqual(ids(index, { title: 'アクメ 提案', url: 'https://example.com/' }).sort(), [1, 2]);
});

// ---- decide ----------------------------------------------------------------

test('decide: 0 件は none', () => {
  assert.deepEqual(decide([], 10), { action: 'none' });
});

test('decide: 1 件で今のワークスペースなら stay', () => {
  assert.deepEqual(decide([{ workspaceId: 10, name: 'A', keywords: ['a'] }], 10), { action: 'stay', target: 10 });
});

test('decide: 1 件で別のワークスペースなら move', () => {
  assert.deepEqual(decide([{ workspaceId: 20, name: 'B', keywords: ['b'] }], 10), { action: 'move', target: 20 });
});

test('decide: 今のワークスペースが不明（未所属）でも 1 件なら move', () => {
  assert.deepEqual(decide([{ workspaceId: 20, name: 'B', keywords: ['b'] }], undefined), { action: 'move', target: 20 });
});

test('decide: 2 件以上は conflict で候補名を返す', () => {
  const r = decide(
    [
      { workspaceId: 10, name: 'A', keywords: ['a'] },
      { workspaceId: 20, name: 'B', keywords: ['b'] },
    ],
    10
  );
  assert.deepEqual(r, { action: 'conflict', candidates: ['A', 'B'] });
});
