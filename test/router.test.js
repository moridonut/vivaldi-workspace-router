import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../src/router.js';

const WIN = 1;
const OTHER_WIN = 2;
const WS_A = 100;
const WS_B = 200;
const WS_C = 300;
const SLIDE = 'https://docs.google.com/presentation/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789ABCDEFG/edit';

// Vivaldi の代わりに状態を持つ偽のアダプタ
function fakeEnv({ tabs = [], windowType = 'normal' } = {}) {
  let clock = 0;
  let timers = [];
  const listeners = {};
  const calls = [];
  const state = new Map(tabs.map((t) => [t.id, { windowId: WIN, pinned: false, ext: {}, ...t }]));

  const adapter = {
    async getOwnWindow() {
      return { id: WIN, type: windowType };
    },
    async getWorkspaces() {
      return [
        { id: WS_A, name: 'Acme' },
        { id: WS_B, name: 'Globex' },
        { id: WS_C, name: 'サンプル工業' },
      ];
    },
    async getTab(id) {
      const t = state.get(id);
      return t ? { ...t, ext: { ...t.ext } } : null;
    },
    async queryTabs(windowId) {
      return [...state.values()].filter((t) => t.windowId === windowId).map((t) => ({ ...t, ext: { ...t.ext } }));
    },
    async updateExt(id, patch) {
      calls.push(['updateExt', id, patch]);
      const t = state.get(id);
      t.ext = { ...t.ext, ...patch };
      // 実機と同じく、拡張データの変更は onUpdated で通知される
      listeners.updated?.(id, { ext: { ...t.ext } }, { ...t });
    },
    async activate(id) {
      calls.push(['activate', id]);
    },
    async close(id) {
      calls.push(['close', id]);
      state.delete(id);
      listeners.removed?.(id);
    },
    onCreated(fn) {
      listeners.created = fn;
    },
    onUpdated(fn) {
      listeners.updated = fn;
    },
    onRemoved(fn) {
      listeners.removed = fn;
    },
    removeListeners() {},
  };

  const env = {
    adapter,
    calls,
    state,
    logs: [],
    now: () => clock,
    setTimeout: (fn, ms) => {
      const t = { fn, at: clock + ms };
      timers.push(t);
      return t;
    },
    clearTimeout: (t) => {
      timers = timers.filter((x) => x !== t);
    },
    async advance(ms) {
      const until = clock + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const next = timers[0];
        if (!next || next.at > until) break;
        timers.shift();
        clock = next.at;
        next.fn();
        await flush();
      }
      clock = until;
      await flush();
    },
    // ユーザー操作・ページ側の変化
    async create(tab) {
      const t = { windowId: WIN, pinned: false, ext: { workspaceId: WS_A }, title: '', url: 'about:blank', ...tab };
      state.set(t.id, t);
      listeners.created?.({ ...t });
      await flush();
    },
    async update(id, change) {
      const t = state.get(id);
      Object.assign(t, change);
      listeners.updated?.(id, change, { ...t });
      await flush();
    },
    async manualMove(id, workspaceId) {
      const t = state.get(id);
      t.ext = { ...t.ext, workspaceId };
      listeners.updated?.(id, { ext: { ...t.ext } }, { ...t });
      await flush();
    },
    did: (name) => calls.filter((c) => c[0] === name),
  };
  return env;
}

const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};

async function startRouter(env, config = {}) {
  const router = createRouter({
    adapter: env.adapter,
    config: { dryRun: false, dedupe: true, switchOnMove: true, debounceMs: 800, routeWindowMs: 30000, ...config },
    now: env.now,
    setTimeout: env.setTimeout,
    clearTimeout: env.clearTimeout,
    log: (...a) => env.logs.push(a),
  });
  await router.start();
  return router;
}

const workspaceOf = (env, id) => env.state.get(id).ext.workspaceId;

// ---- 移動 ------------------------------------------------------------------

test('一致 1 件・別ワークスペース: 移動して移動先に切り替える', async () => {
  const env = fakeEnv();
  await startRouter(env);
  await env.create({ id: 10, url: 'https://example.com/globex', title: 'Globex QBR' });
  await env.advance(800);
  assert.equal(workspaceOf(env, 10), WS_B);
  assert.deepEqual(env.did('activate'), [['activate', 10]]);
});

test('switchOnMove: false なら移動だけで切り替えない', async () => {
  const env = fakeEnv();
  await startRouter(env, { switchOnMove: false });
  await env.create({ id: 10, url: 'https://example.com/', title: 'Globex QBR' });
  await env.advance(800);
  assert.equal(workspaceOf(env, 10), WS_B);
  assert.deepEqual(env.did('activate'), []);
});

test('デバウンス: タイトルが遅れて確定しても 1 回だけ判定する', async () => {
  const env = fakeEnv();
  await startRouter(env);
  await env.create({ id: 10, url: 'https://myorg.lightning.force.com/lightning/r/Opportunity/0065g00000ABCDEFGH/view', title: '' });
  await env.advance(500);
  await env.update(10, { title: 'Lightning Experience' });
  await env.advance(500);
  await env.update(10, { title: 'GLOBEX LTD.-Renewal | Salesforce' });
  await env.advance(799);
  assert.equal(workspaceOf(env, 10), WS_A);
  await env.advance(1);
  assert.equal(workspaceOf(env, 10), WS_B);
  assert.equal(env.did('updateExt').length, 1);
});

test('タイトルが後から一致しても、受付時間（30 秒）を過ぎていれば動かさない', async () => {
  const env = fakeEnv();
  await startRouter(env);
  await env.create({ id: 10, url: 'https://example.com/', title: 'loading' });
  await env.advance(31000);
  await env.update(10, { title: 'Globex inbox (3)' });
  await env.advance(800);
  assert.equal(workspaceOf(env, 10), WS_A);
});

test('ナビゲーション（URL の変化）で受付時間が始まり直す', async () => {
  const env = fakeEnv();
  await startRouter(env);
  await env.create({ id: 10, url: 'https://example.com/', title: 'home' });
  await env.advance(31000);
  await env.update(10, { url: 'https://example.com/globex', title: 'Globex' });
  await env.advance(800);
  assert.equal(workspaceOf(env, 10), WS_B);
});

// ---- 動かさないケース ------------------------------------------------------

test('一致 0 件: 何もしない', async () => {
  const env = fakeEnv();
  await startRouter(env);
  await env.create({ id: 10, url: 'https://example.com/', title: '社内勉強会' });
  await env.advance(800);
  assert.deepEqual(env.calls, []);
});

test('一致 2 件以上: 動かさずログを残す', async () => {
  const env = fakeEnv();
  await startRouter(env);
  await env.create({ id: 10, url: 'https://example.com/', title: 'Acme vs Globex' });
  await env.advance(800);
  assert.deepEqual(env.calls, []);
  assert.ok(env.logs.some((l) => l.join(' ').includes('conflict')));
});

test('ほかのウィンドウのタブは扱わない', async () => {
  const env = fakeEnv();
  await startRouter(env);
  await env.create({ id: 10, windowId: OTHER_WIN, url: 'https://example.com/', title: 'Globex' });
  await env.advance(800);
  assert.deepEqual(env.calls, []);
});

test('自分のウィンドウが通常ウィンドウでなければ何もしない', async () => {
  const env = fakeEnv({ windowType: 'app' });
  await startRouter(env);
  await env.create({ id: 10, url: 'https://example.com/', title: 'Globex' });
  await env.advance(800);
  assert.deepEqual(env.calls, []);
});

test('ピン留め・ウェブパネル・内部ページは扱わない', async () => {
  const env = fakeEnv();
  await startRouter(env);
  await env.create({ id: 10, pinned: true, url: 'https://example.com/', title: 'Globex' });
  await env.create({ id: 11, ext: { panelId: 'WEBPANEL_x' }, url: 'https://example.com/', title: 'Globex' });
  await env.create({ id: 12, url: 'chrome://settings/?q=Globex', title: 'Globex' });
  await env.create({ id: 13, url: 'vivaldi://settings', title: 'Globex' });
  await env.advance(800);
  assert.deepEqual(env.calls, []);
});

test('起動時からあるタブは、ナビゲーションするまで扱わない', async () => {
  const env = fakeEnv({ tabs: [{ id: 5, url: 'https://example.com/', title: 'Globex', ext: { workspaceId: WS_A } }] });
  await startRouter(env);
  await env.update(5, { title: 'Globex (1)' });
  await env.advance(800);
  assert.deepEqual(env.calls, []);
  await env.update(5, { url: 'https://example.com/next', title: 'Globex next' });
  await env.advance(800);
  assert.equal(workspaceOf(env, 5), WS_B);
});

test('一時停止中は何もしない。再開すると次のイベントから扱う', async () => {
  const env = fakeEnv();
  const router = await startRouter(env);
  router.pause();
  await env.create({ id: 10, url: 'https://example.com/', title: 'Globex' });
  await env.advance(800);
  assert.deepEqual(env.calls, []);
  router.resume();
  await env.create({ id: 11, url: 'https://example.com/', title: 'Globex' });
  await env.advance(800);
  assert.equal(workspaceOf(env, 11), WS_B);
});

// ---- 手動移動（F6） --------------------------------------------------------

test('mod が移したタブを手で戻したら、以後は動かさない', async () => {
  const env = fakeEnv();
  await startRouter(env);
  await env.create({ id: 10, url: 'https://example.com/', title: 'Globex' });
  await env.advance(800);
  assert.equal(workspaceOf(env, 10), WS_B);
  await env.manualMove(10, WS_A);
  await env.update(10, { url: 'https://example.com/globex2', title: 'Globex 2' });
  await env.advance(800);
  assert.equal(workspaceOf(env, 10), WS_A);
  assert.equal(env.state.get(10).ext.wsrManual, true);
});

test('判定前に手で移したタブも、以後は動かさない', async () => {
  const env = fakeEnv();
  await startRouter(env);
  await env.create({ id: 10, url: 'https://example.com/', title: 'Globex' });
  await env.manualMove(10, WS_C);
  await env.advance(800);
  assert.equal(workspaceOf(env, 10), WS_C);
});

test('手動移動フラグ（wsrManual）が残っているタブは、再起動後も動かさない', async () => {
  const env = fakeEnv({ tabs: [{ id: 5, url: 'https://example.com/', title: 'x', ext: { workspaceId: WS_A, wsrManual: true } }] });
  await startRouter(env);
  await env.update(5, { url: 'https://example.com/globex', title: 'Globex' });
  await env.advance(800);
  assert.equal(workspaceOf(env, 5), WS_A);
});

test('作成直後の拡張データ通知（workspaceId が変わらない）は手動移動とみなさない', async () => {
  const env = fakeEnv();
  await startRouter(env);
  await env.create({ id: 10, url: 'https://example.com/', title: '' });
  await env.manualMove(10, WS_A); // 同じ値の通知
  await env.update(10, { title: 'Globex' });
  await env.advance(800);
  assert.equal(workspaceOf(env, 10), WS_B);
});

// ---- 重複処理（F5） --------------------------------------------------------

test('移動先に同じページがあれば、新しいタブを閉じて既存タブを前に出す', async () => {
  const env = fakeEnv({ tabs: [{ id: 5, url: `${SLIDE}#slide=id.p1`, title: 'Globex 提案', ext: { workspaceId: WS_B } }] });
  await startRouter(env);
  await env.create({ id: 10, url: `${SLIDE}#slide=id.p9`, title: 'Globex 提案' });
  await env.advance(800);
  assert.deepEqual(env.did('close'), [['close', 10]]);
  assert.deepEqual(env.did('activate').at(-1), ['activate', 5]);
  assert.ok(env.state.has(5));
});

test('すでに正しいワークスペースにあれば、重複処理だけ行う', async () => {
  const env = fakeEnv({ tabs: [{ id: 5, url: SLIDE, title: 'Globex 提案', ext: { workspaceId: WS_B } }] });
  await startRouter(env);
  await env.create({ id: 10, url: SLIDE, title: 'Globex 提案', ext: { workspaceId: WS_B } });
  await env.advance(800);
  assert.deepEqual(env.did('updateExt'), []);
  assert.deepEqual(env.did('close'), [['close', 10]]);
});

test('別のワークスペースにある同じページは重複とみなさない', async () => {
  const env = fakeEnv({ tabs: [{ id: 5, url: SLIDE, title: 'Globex 提案', ext: { workspaceId: WS_A } }] });
  await startRouter(env);
  await env.create({ id: 10, url: SLIDE, title: 'Globex 提案' });
  await env.advance(800);
  assert.equal(workspaceOf(env, 10), WS_B);
  assert.deepEqual(env.did('close'), []);
});

test('作成から 30 秒を過ぎたタブは、重複でも閉じない', async () => {
  const env = fakeEnv({ tabs: [{ id: 5, url: SLIDE, title: 'Globex 提案', ext: { workspaceId: WS_B } }] });
  await startRouter(env);
  await env.create({ id: 10, url: 'https://example.com/', title: 'x' });
  await env.advance(31000);
  await env.update(10, { url: SLIDE, title: 'Globex 提案' });
  await env.advance(800);
  assert.equal(workspaceOf(env, 10), WS_B);
  assert.deepEqual(env.did('close'), []);
});

test('起動時からあるタブは、重複でも閉じない', async () => {
  const env = fakeEnv({
    tabs: [
      { id: 5, url: SLIDE, title: 'Globex 提案', ext: { workspaceId: WS_B } },
      { id: 6, url: 'https://example.com/', title: 'x', ext: { workspaceId: WS_B } },
    ],
  });
  await startRouter(env);
  await env.update(6, { url: SLIDE, title: 'Globex 提案' });
  await env.advance(800);
  assert.deepEqual(env.did('close'), []);
});

test('dedupe: false なら重複処理しない', async () => {
  const env = fakeEnv({ tabs: [{ id: 5, url: SLIDE, title: 'Globex 提案', ext: { workspaceId: WS_B } }] });
  await startRouter(env, { dedupe: false });
  await env.create({ id: 10, url: SLIDE, title: 'Globex 提案' });
  await env.advance(800);
  assert.deepEqual(env.did('close'), []);
});

test('dedupeUnmatched: true なら、一致なしのタブも今のワークスペース内で重複処理する', async () => {
  const env = fakeEnv({ tabs: [{ id: 5, url: 'https://example.com/doc?id=1', title: 'doc', ext: { workspaceId: WS_A } }] });
  await startRouter(env, { dedupeUnmatched: true });
  await env.create({ id: 10, url: 'https://example.com/doc?id=1&utm_source=slack', title: 'doc' });
  await env.advance(800);
  assert.deepEqual(env.did('close'), [['close', 10]]);
});

test('dedupeUnmatched: false（既定）なら、一致なしのタブは重複処理しない', async () => {
  const env = fakeEnv({ tabs: [{ id: 5, url: 'https://example.com/doc?id=1', title: 'doc', ext: { workspaceId: WS_A } }] });
  await startRouter(env);
  await env.create({ id: 10, url: 'https://example.com/doc?id=1', title: 'doc' });
  await env.advance(800);
  assert.deepEqual(env.calls, []);
});

// ---- ドライラン ------------------------------------------------------------

test('ドライラン: 移動・切替・クローズ・フラグ書き込みを一切せず、判定をログに出す', async () => {
  const env = fakeEnv({ tabs: [{ id: 5, url: SLIDE, title: 'Globex 提案', ext: { workspaceId: WS_B } }] });
  await startRouter(env, { dryRun: true });
  await env.create({ id: 10, url: SLIDE, title: 'Globex 提案' });
  await env.advance(800);
  await env.create({ id: 11, url: 'https://example.com/', title: 'Globex' });
  await env.manualMove(11, WS_C);
  await env.advance(800);
  assert.deepEqual(env.calls, []);
  const text = env.logs.map((l) => l.join(' ')).join('\n');
  assert.match(text, /move/);
  assert.match(text, /close/);
});

test('ドライラン中も、ほかの処理の副作用でタブを閉じることはない', async () => {
  const env = fakeEnv({ tabs: [{ id: 5, url: SLIDE, title: 'Globex 提案', ext: { workspaceId: WS_B } }] });
  await startRouter(env, { dryRun: true, dedupeUnmatched: true });
  await env.create({ id: 10, url: SLIDE, title: 'Globex 提案' });
  await env.advance(800);
  assert.ok(env.state.has(5) && env.state.has(10));
});

test('stop() の後はイベントを処理しない', async () => {
  const env = fakeEnv();
  const router = await startRouter(env);
  await env.create({ id: 10, url: 'https://example.com/', title: 'x' });
  router.stop();
  await env.update(10, { title: 'Globex' });
  await env.advance(800);
  assert.deepEqual(env.calls, []);
});
