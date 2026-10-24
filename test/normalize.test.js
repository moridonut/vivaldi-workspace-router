import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupeKey } from '../src/normalize.js';

const same = (a, b) => {
  const ka = dedupeKey(a);
  assert.ok(ka, `key should not be null: ${a}`);
  assert.equal(ka, dedupeKey(b), `${a}\n${b}`);
};
const differ = (a, b) => {
  const ka = dedupeKey(a);
  const kb = dedupeKey(b);
  assert.ok(ka && kb, `keys should not be null:\n${a}\n${b}`);
  assert.notEqual(ka, kb, `${a}\n${b}`);
};

// ---- Google Slides / Docs / Sheets -----------------------------------------

const SLIDE = 'https://docs.google.com/presentation/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789ABCDEFG';

test('Google: 同じファイルは #slide= や /edit の違いを無視する', () => {
  same(`${SLIDE}/edit#slide=id.p1`, `${SLIDE}/edit#slide=id.g2abc_0_12`);
  same(`${SLIDE}/edit?slide=id.p1`, `${SLIDE}/edit`);
  same(`${SLIDE}/edit`, `${SLIDE}/view`);
  same(`${SLIDE}/edit`, SLIDE);
  same(`${SLIDE}/edit?usp=sharing`, `${SLIDE}/edit?usp=drive_link#slide=id.p3`);
});

test('Google: /u/<n>/ のアカウント番号を無視する', () => {
  same(`https://docs.google.com/presentation/u/1/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789ABCDEFG/edit`, `${SLIDE}/edit`);
});

test('Google: ファイル ID や種類が違えば別物', () => {
  differ(`${SLIDE}/edit`, 'https://docs.google.com/presentation/d/1ZzZzZzZzZzZzZzZzZzZzZzZzZzZzZzZzZzZzZzZzZz/edit');
  differ(
    'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789ABCDEFG/edit',
    `${SLIDE}/edit`
  );
  differ(
    'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789ABCDEFG/edit#gid=0',
    'https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789ABCDEFG/edit'
  );
});

test('Google: ファイル ID の大文字小文字は区別する', () => {
  differ(`${SLIDE}/edit`, `${SLIDE.toLowerCase()}/edit`);
});

// ---- Salesforce Lightning --------------------------------------------------

const SF = 'https://acme.lightning.force.com/lightning/r';

test('Salesforce: 15 桁と 18 桁の ID を同一視する', () => {
  same(`${SF}/Opportunity/0065g00000ABCDE/view`, `${SF}/Opportunity/0065g00000ABCDEFGH/view`);
  same(`${SF}/Opportunity/0065g00000ABCDEFGH/view`, `${SF}/Opportunity/0065g00000ABCDEXYZ/view`);
});

test('Salesforce: /view とその他の末尾、クエリやハッシュを無視する', () => {
  same(`${SF}/Opportunity/0065g00000ABCDEFGH/view`, `${SF}/Opportunity/0065g00000ABCDEFGH/related/OpportunityLineItems/view`);
  same(`${SF}/Opportunity/0065g00000ABCDEFGH/view`, `${SF}/Opportunity/0065g00000ABCDEFGH/view?ws=%2Flightning%2Fr%2FAccount`);
  same(`${SF}/Opportunity/0065g00000ABCDEFGH/view`, `${SF}/opportunity/0065g00000ABCDEFGH/view`);
});

test('Salesforce: レコード ID やオブジェクト種別が違えば別物', () => {
  differ(`${SF}/Opportunity/0065g00000ABCDEFGH/view`, `${SF}/Opportunity/0065g00000ZZZZZFGH/view`);
  differ(`${SF}/Opportunity/0065g00000ABCDEFGH/view`, `${SF}/Account/0065g00000ABCDEFGH/view`);
  // 15 桁 ID は大文字小文字を区別する
  differ(`${SF}/Opportunity/0065g00000ABCDE/view`, `${SF}/Opportunity/0065g00000abcde/view`);
  differ(
    `${SF}/Opportunity/0065g00000ABCDEFGH/view`,
    'https://globex.lightning.force.com/lightning/r/Opportunity/0065g00000ABCDEFGH/view'
  );
});

test('Salesforce: レコード画面以外は「その他」の規則にする', () => {
  same(
    'https://acme.lightning.force.com/lightning/o/Opportunity/list?filterName=Recent',
    'https://acme.lightning.force.com/lightning/o/Opportunity/list?filterName=Recent#x'
  );
  differ(
    'https://acme.lightning.force.com/lightning/o/Opportunity/list?filterName=Recent',
    'https://acme.lightning.force.com/lightning/o/Opportunity/list?filterName=Mine'
  );
});

// ---- Celonis ---------------------------------------------------------------

const CEL = 'https://myteam.eu-1.celonis.cloud/package-manager/ui/views/ui/spaces';
const UUID1 = '3f2b8c1e-1a2b-4c3d-9e8f-0a1b2c3d4e5f';
const UUID2 = '7d6c5b4a-3e2f-4a1b-8c9d-0e1f2a3b4c5d';

test('Celonis: リソース ID のない一覧ページは重複処理しない（null）', () => {
  assert.equal(dedupeKey(CEL), null);
  assert.equal(dedupeKey(`${CEL}/`), null);
  assert.equal(dedupeKey(`${CEL}?x=1`), null);
});

test('Celonis: 同じリソースはクエリ・ハッシュ・末尾のスラッシュを無視する', () => {
  same(`${CEL}/${UUID1}/packages/sales-app/nodes/overview`, `${CEL}/${UUID1}/packages/sales-app/nodes/overview/`);
  same(`${CEL}/${UUID1}/packages/sales-app/nodes/overview?tab=1`, `${CEL}/${UUID1}/packages/sales-app/nodes/overview`);
  same(`${CEL}/${UUID1}/packages/sales-app/nodes/overview#top`, `${CEL}/${UUID1}/packages/sales-app/nodes/overview`);
});

test('Celonis: リソース ID・パス・チームが違えば別物', () => {
  differ(`${CEL}/${UUID1}/packages/sales-app/nodes/overview`, `${CEL}/${UUID2}/packages/sales-app/nodes/overview`);
  differ(`${CEL}/${UUID1}/packages/sales-app/nodes/overview`, `${CEL}/${UUID1}/packages/sales-app/nodes/details`);
  differ(
    `${CEL}/${UUID1}/packages/sales-app/nodes/overview`,
    `https://otherteam.eu-1.celonis.cloud/package-manager/ui/views/ui/spaces/${UUID1}/packages/sales-app/nodes/overview`
  );
});

// ---- その他 ----------------------------------------------------------------

test('その他: ハッシュと追跡パラメータを除く', () => {
  same('https://example.com/article?id=1#comments', 'https://example.com/article?id=1');
  same('https://example.com/article?id=1&utm_source=slack&utm_medium=chat', 'https://example.com/article?id=1');
  same('https://example.com/a?gclid=x&fbclid=y&id=1', 'https://example.com/a?id=1');
  same('https://Example.COM/a', 'https://example.com/a');
});

test('その他: パラメータの順番の違いを無視する', () => {
  same('https://example.com/a?b=2&a=1', 'https://example.com/a?a=1&b=2');
});

test('その他: パスや意味のあるパラメータが違えば別物', () => {
  differ('https://example.com/a', 'https://example.com/b');
  differ('https://example.com/a?id=1', 'https://example.com/a?id=2');
  differ('https://example.com/a', 'https://example.org/a');
  differ('http://example.com/a', 'https://example.com/a');
});

test('http(s) 以外や壊れた URL は null', () => {
  assert.equal(dedupeKey('chrome://settings'), null);
  assert.equal(dedupeKey('vivaldi://extensions'), null);
  assert.equal(dedupeKey('about:blank'), null);
  assert.equal(dedupeKey('not a url'), null);
  assert.equal(dedupeKey(''), null);
  assert.equal(dedupeKey(undefined), null);
});
