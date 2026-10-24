// 本体。タブのイベントを受けて、判定・移動・重複処理・手動移動の検出を行う。
// Vivaldi 固有の呼び出しは末尾の createVivaldiAdapter() だけに閉じ込める。

import { buildIndex, matchTab, decide } from './matcher.js';
import { dedupeKey } from './normalize.js';
import CONFIG from './config.js';

const LOG_PREFIX = '[workspace-router]';
const MANUAL_FLAG = 'wsrManual'; // vivExtData に持たせる独自キー（手で移したタブ）
const ACTIVATE_VERIFY_MS = 300; // 重複処理の後、既存タブがアクティブになったか確かめるまでの時間
const ACTIVATE_WAIT_MS = 1000; // 既存タブがアクティブになるのを待つ上限
const POLL_MS = 50;

const isWebUrl = (u) => /^https?:\/\//i.test(u || '');

// 'Cmd+Alt+Shift+P' → { meta, alt, shift, ctrl, code: 'KeyP' }。⌥ で e.key が変わるので e.code で比べる
export function parseShortcut(text) {
  if (!text) return null;
  const sc = { meta: false, alt: false, shift: false, ctrl: false, code: null };
  for (const part of String(text).split('+').map((p) => p.trim().toLowerCase())) {
    if (part === 'cmd' || part === 'meta') sc.meta = true;
    else if (part === 'alt' || part === 'option' || part === 'opt') sc.alt = true;
    else if (part === 'shift') sc.shift = true;
    else if (part === 'ctrl' || part === 'control') sc.ctrl = true;
    else if (/^[a-z]$/.test(part)) sc.code = `Key${part.toUpperCase()}`;
    else if (/^[0-9]$/.test(part)) sc.code = `Digit${part}`;
    else if (/^f([1-9]|1[0-9]|2[0-4])$/.test(part)) sc.code = part.toUpperCase();
    else return null;
  }
  return sc.code ? sc : null;
}

export function matchesShortcut(sc, e) {
  return (
    !!sc &&
    e.code === sc.code &&
    !!e.metaKey === sc.meta &&
    !!e.altKey === sc.alt &&
    !!e.shiftKey === sc.shift &&
    !!e.ctrlKey === sc.ctrl
  );
}

// adapter: Vivaldi とのやり取り（createVivaldiAdapter と同じ形の偽物をテストで使う）
// tab は { id, windowId, url, title, pinned, ext }。ext は vivExtData を parse したもの
export function createRouter({
  adapter,
  config = {},
  now = () => Date.now(),
  setTimeout: setTimer = setTimeout,
  clearTimeout: clearTimer = clearTimeout,
  log = (...a) => console.log(LOG_PREFIX, ...a),
}) {
  const cfg = {
    enabled: true,
    dryRun: true,
    switchOnMove: true,
    dedupe: true,
    dedupeUnmatched: false,
    dedupeReopenGraceMs: 60000,
    routeWindowMs: 30000,
    debounceMs: 800,
    ignoreWorkspaces: [],
    aliases: {},
    debug: false,
    toggleShortcut: 'Shift+F12',
    ...config,
  };
  const debug = (...a) => cfg.debug && log(...a);

  // tabId → { createdAt?, openerId?, windowStart, lastWs, expectedWs?, manual, timer }
  // mod の読み込み後に作成されたタブだけが createdAt を持つ（それ以外は閉じない）
  const tabs = new Map();
  let ownWindow = null;
  let paused = !cfg.enabled;
  let stopped = false;
  let indexCache = { key: null, index: null };
  // 重複キー → 最後に重複として閉じた（ドライランでは閉じたはずの）時刻
  const recentlyClosed = new Map();

  const getState = (id) => tabs.get(id);

  function schedule(id) {
    const s = getState(id);
    if (!s) return;
    if (s.timer) clearTimer(s.timer);
    s.timer = setTimer(() => {
      s.timer = null;
      evaluate(id).catch((e) => log('error', id, e && e.message ? e.message : e));
    }, cfg.debounceMs);
  }

  // ---- 手動移動の検出（F6） ----

  function observeWorkspace(id, ws, s) {
    if (ws === s.lastWs) return;
    const byMod = s.expectedWs !== undefined && ws === s.expectedWs;
    s.lastWs = ws;
    if (byMod) return;
    s.manual = true;
    if (s.timer) clearTimer(s.timer);
    log('manual move detected; tab will no longer be routed', id);
    if (!cfg.dryRun) adapter.updateExt(id, { [MANUAL_FLAG]: true }).catch(() => {});
  }

  // ---- イベント ----

  function onCreated(tab) {
    if (stopped || tab.windowId !== ownWindow.id) return;
    const t = now();
    tabs.set(tab.id, {
      createdAt: t,
      openerId: tab.openerTabId,
      windowStart: t,
      lastWs: tab.ext && tab.ext.workspaceId,
      manual: false,
      timer: null,
    });
    debug('created', tab.id, tab.openerTabId !== undefined ? `opener ${tab.openerTabId}` : 'no opener');
    schedule(tab.id);
  }

  function onUpdated(id, change, tab) {
    if (stopped || !tab || tab.windowId !== ownWindow.id) return;
    let s = getState(id);
    if (change.ext && s) observeWorkspace(id, change.ext.workspaceId, s);
    if (change.url) {
      // ナビゲーション: 受付時間を始め直す。起動時からあるタブもここから扱う
      if (!s) {
        s = { windowStart: now(), lastWs: tab.ext && tab.ext.workspaceId, manual: false, timer: null };
        tabs.set(id, s);
      }
      s.windowStart = now();
      schedule(id);
    } else if (change.title && s) {
      schedule(id);
    }
  }

  function onRemoved(id) {
    const s = getState(id);
    if (s && s.timer) clearTimer(s.timer);
    tabs.delete(id);
  }

  // ---- 判定 ----

  async function getIndex() {
    const workspaces = await adapter.getWorkspaces();
    const key = JSON.stringify(workspaces.map((w) => [w.id, w.name]));
    if (key !== indexCache.key) {
      const index = buildIndex(workspaces, cfg);
      for (const w of index.warnings) log('config warning', w.reason, JSON.stringify(w.workspace), JSON.stringify(w.keyword));
      indexCache = { key, index };
    }
    return indexCache.index;
  }

  function skipReason(tab, s) {
    if (paused) return 'paused';
    if (!s) return 'unknown tab';
    if (s.manual) return 'manually moved';
    if (tab.windowId !== ownWindow.id) return 'other window';
    if (tab.pinned) return 'pinned';
    if (!isWebUrl(tab.url)) return 'not a web page';
    const ext = tab.ext || {};
    if (ext.panelId) return 'web panel';
    if (ext[MANUAL_FLAG]) return 'manually moved (flag)';
    if (now() - s.windowStart > cfg.routeWindowMs) return 'route window expired';
    return null;
  }

  async function evaluate(id) {
    if (stopped) return;
    const s = getState(id);
    const tab = await adapter.getTab(id);
    if (!tab) return;
    const reason = skipReason(tab, s);
    if (reason) {
      debug('skip', id, reason);
      return;
    }
    const index = await getIndex();
    const matches = matchTab(index, tab);
    const current = (tab.ext || {}).workspaceId;
    const d = decide(matches, current);
    debug('decide', id, d.action, JSON.stringify(tab.title), matches.map((m) => `${m.name}(${m.keywords.join('|')})`).join(', '));

    if (d.action === 'none') {
      if (cfg.dedupeUnmatched) {
        const existing = await findDuplicate(tab, s, current);
        if (existing) await closeDuplicate(tab, existing);
      }
      return;
    }
    if (d.action === 'conflict') {
      log('conflict; not moving', id, JSON.stringify(tab.title), 'candidates:', d.candidates.join(', '));
      return;
    }
    const target = matches[0];
    const existing = await findDuplicate(tab, s, d.target);
    if (d.action === 'stay') {
      if (existing) await closeDuplicate(tab, existing);
      return;
    }

    if (cfg.dryRun) {
      log('[dry-run] move', id, JSON.stringify(tab.title), '→', target.name, `(${target.keywords.join('|')})`);
      if (existing) await closeDuplicate(tab, existing);
      return;
    }
    log('move', id, JSON.stringify(tab.title), '→', target.name, `(${target.keywords.join('|')})`);
    s.expectedWs = d.target;
    await adapter.updateExt(id, { workspaceId: d.target });
    // 重複があるときも、まずこのタブで移動先へ切り替える。別ワークスペースの既存タブを直接アクティブにすると、
    // 中身だけ切り替わってタブ一覧が元のワークスペースのままになることがある（実機で確認）
    if (cfg.switchOnMove || existing) {
      await adapter.activate(id);
      await waitUntilActive(id);
    }
    if (existing) await closeDuplicate(tab, existing);
  }

  // 同じページが workspaceId のワークスペースにあり、このタブを閉じてよければ、その既存タブを返す。
  // 閉じるのは mod の読み込み後に作成され、作成から routeWindowMs 以内の、判定中のタブだけ。
  // わざと開いたとみなせるもの（開いた元のタブ自身の複製、閉じた直後の開き直し）は閉じない
  async function findDuplicate(tab, s, workspaceId) {
    if (!cfg.dedupe) return null;
    const key = dedupeKey(tab.url);
    if (!key) return null;
    const others = await adapter.queryTabs(ownWindow.id);
    const duplicates = others.filter(
      (o) =>
        o.id !== tab.id &&
        !(o.ext || {}).panelId &&
        (o.ext || {}).workspaceId === workspaceId &&
        dedupeKey(o.url) === key
    );
    if (!duplicates.length) return null;
    const existing = duplicates.find((o) => o.id !== s.openerId);
    if (!existing) {
      debug('duplicate of its opener (e.g. duplicated tab); keeping', tab.id, '→', s.openerId);
      return null;
    }
    if (s.createdAt === undefined || now() - s.createdAt > cfg.routeWindowMs) {
      debug('duplicate found but tab is too old to close', tab.id, '→', existing.id);
      return null;
    }
    const closedAt = recentlyClosed.get(key);
    if (closedAt !== undefined && now() - closedAt <= cfg.dedupeReopenGraceMs) {
      log('duplicate reopened right after closing; keeping', tab.id, JSON.stringify(tab.title));
      return null;
    }
    recentlyClosed.set(key, now());
    return existing;
  }

  // 既存タブを前に出してから、このタブを閉じる。どちらも同じワークスペースにある前提
  async function closeDuplicate(tab, existing) {
    if (cfg.dryRun) {
      log('[dry-run] close duplicate', tab.id, JSON.stringify(tab.title), '→ activate existing', existing.id);
      return;
    }
    log('close duplicate', tab.id, JSON.stringify(tab.title), '→ activate existing', existing.id);
    // 反映を待ってから、裏に回ったこのタブを閉じる。表示中のタブを閉じると Vivaldi が別のタブを選び直してしまう
    await adapter.activate(existing.id);
    await waitUntilActive(existing.id);
    await adapter.close(tab.id);
    // それでも Vivaldi の選び直しが後から来ることがあるので、確かめてもう一度アクティブにする
    setTimer(() => {
      if (stopped) return;
      adapter
        .getTab(existing.id)
        .then((t) => {
          if (t && !t.active) {
            debug('existing tab lost focus after closing duplicate; activating again', existing.id);
            return adapter.activate(existing.id);
          }
        })
        .catch(() => {});
    }, ACTIVATE_VERIFY_MS);
  }

  const sleep = (ms) => new Promise((r) => setTimer(r, ms));

  function setPaused(p, { broadcast = false, toast = false } = {}) {
    paused = !!p;
    log(paused ? 'paused' : 'resumed');
    if (broadcast && adapter.broadcastPause) adapter.broadcastPause(paused);
    if (toast && adapter.toast) adapter.toast(paused ? 'Workspace Router: 一時停止' : 'Workspace Router: 再開');
  }

  async function waitUntilActive(id) {
    for (let waited = 0; waited < ACTIVATE_WAIT_MS; waited += POLL_MS) {
      const t = await adapter.getTab(id);
      if (!t || t.active) return;
      await sleep(POLL_MS);
    }
    debug('existing tab did not become active in time', id);
  }

  return {
    async start() {
      ownWindow = await adapter.getOwnWindow();
      if (ownWindow.type !== 'normal') {
        debug('not a normal window; staying idle', ownWindow.type);
        stopped = true;
        return;
      }
      adapter.onCreated(onCreated);
      adapter.onUpdated(onUpdated);
      adapter.onRemoved(onRemoved);
      const shortcut = parseShortcut(cfg.toggleShortcut);
      if (cfg.toggleShortcut && !shortcut) log('config warning invalid toggleShortcut', JSON.stringify(cfg.toggleShortcut));
      if (shortcut && adapter.onKeyDown) {
        adapter.onKeyDown((e) => {
          if (stopped || !matchesShortcut(shortcut, e)) return;
          e.preventDefault();
          setPaused(!paused, { broadcast: true, toast: true });
        });
      }
      // 一時停止はウィンドウをまたいで共有する（mod はウィンドウごとに動く）
      if (adapter.onPauseBroadcast) adapter.onPauseBroadcast((p) => !stopped && setPaused(p, { broadcast: false }));
      const index = await getIndex();
      log(
        `started (window ${ownWindow.id}${cfg.dryRun ? ', DRY RUN' : ''}${paused ? ', paused' : ''});`,
        `${index.entries.length} workspaces:`,
        index.entries.map((e) => `${e.name}[${e.keywords.map((k) => (k.urlOnly ? 'url:' : '') + k.text).join(', ')}]`).join(' ')
      );
    },
    stop() {
      stopped = true;
      for (const s of tabs.values()) if (s.timer) clearTimer(s.timer);
      tabs.clear();
      adapter.removeListeners();
    },
    pause() {
      setPaused(true, { broadcast: true });
    },
    resume() {
      setPaused(false, { broadcast: true });
    },
    toggle() {
      setPaused(!paused, { broadcast: true, toast: true });
      return !paused;
    },
    setDryRun(on) {
      cfg.dryRun = !!on;
      log('dry run', cfg.dryRun ? 'on' : 'off');
    },
    status() {
      return { window: ownWindow && ownWindow.id, paused, dryRun: cfg.dryRun, stopped, trackedTabs: tabs.size };
    },
  };
}

// ---- Vivaldi アダプタ（Vivaldi 固有 API はここだけ） ------------------------
// 実機で確認済みの API だけを使う（docs/findings.md）

export function createVivaldiAdapter() {
  const call = (fn, ...args) =>
    new Promise((resolve, reject) => {
      fn(...args, (r) => {
        const e = chrome.runtime && chrome.runtime.lastError;
        e ? reject(new Error(e.message)) : resolve(r);
      });
    });
  const parseExt = (raw) => {
    if (!raw) return {};
    try {
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return {};
    }
  };
  const toTab = (t) =>
    t && {
      id: t.id,
      windowId: t.windowId,
      openerTabId: t.openerTabId,
      url: t.url || t.pendingUrl,
      title: t.title,
      pinned: t.pinned,
      active: t.active,
      ext: parseExt(t.vivExtData),
    };

  const registered = [];
  const domListeners = [];
  const channel = new BroadcastChannel('vivaldi-workspace-router');
  const listen = (event, fn) => {
    event.addListener(fn);
    registered.push([event, fn]);
  };

  return {
    async getOwnWindow() {
      const w = await call(chrome.windows.getCurrent, {});
      return { id: w.id, type: w.type };
    },
    // findings #3: { value, defaultValue, store } で返る。コールバック形式と Promise 形式の両方に対応
    getWorkspaces() {
      return new Promise((resolve, reject) => {
        const done = (v) => resolve(((v && v.value) || []).map((w) => ({ id: w.id, name: w.name })));
        try {
          const r = vivaldi.prefs.get('vivaldi.workspaces.list', done);
          if (r && typeof r.then === 'function') r.then(done, reject);
        } catch (e) {
          reject(e);
        }
      });
    },
    async getTab(id) {
      try {
        return toTab(await call(chrome.tabs.get, id));
      } catch {
        return null;
      }
    },
    async queryTabs(windowId) {
      return (await call(chrome.tabs.query, { windowId })).map(toTab);
    },
    // findings #4: vivExtData の書き換えで移動できる。ほかのキーを壊さないよう読み直してから書く
    async updateExt(id, patch) {
      const t = await call(chrome.tabs.get, id);
      const next = { ...parseExt(t.vivExtData), ...patch };
      await call(chrome.tabs.update, id, { vivExtData: JSON.stringify(next) });
    },
    // findings #5: 別ワークスペースのタブを active にするとワークスペースも切り替わる
    async activate(id) {
      await call(chrome.tabs.update, id, { active: true });
    },
    async close(id) {
      await call(chrome.tabs.remove, id);
    },
    onCreated(fn) {
      listen(chrome.tabs.onCreated, (t) => fn(toTab(t)));
    },
    // findings A/F: 拡張データの変化は changeInfo.vivExtData で届く
    onUpdated(fn) {
      listen(chrome.tabs.onUpdated, (id, info, t) => {
        const change = { url: info.url, title: info.title };
        if ('vivExtData' in info) change.ext = parseExt(info.vivExtData);
        fn(id, change, toTab(t));
      });
    },
    onRemoved(fn) {
      listen(chrome.tabs.onRemoved, (id) => fn(id));
    },
    // 標準の DOM イベント。ページの中にフォーカスがあるときに届くかは docs/findings.md M
    onKeyDown(fn) {
      const handler = (e) => fn(e);
      document.addEventListener('keydown', handler, true);
      domListeners.push(() => document.removeEventListener('keydown', handler, true));
    },
    // 同じ UI（chrome-extension://…）のウィンドウ同士で一時停止を共有する
    onPauseBroadcast(fn) {
      channel.onmessage = (e) => e.data && typeof e.data.paused === 'boolean' && fn(e.data.paused);
    },
    broadcastPause(paused) {
      channel.postMessage({ paused });
    },
    toast(text) {
      const el = document.createElement('div');
      el.textContent = text;
      el.style.cssText =
        'position:fixed;right:16px;bottom:16px;z-index:2147483647;padding:8px 14px;border-radius:6px;' +
        'background:rgba(30,30,30,.92);color:#fff;font:13px -apple-system,sans-serif;pointer-events:none;';
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 1800);
    },
    removeListeners() {
      for (const [event, fn] of registered.splice(0)) event.removeListener(fn);
      for (const off of domListeners.splice(0)) off();
      channel.close();
    },
  };
}

// ---- 起動（Vivaldi の UI の中でだけ動く） ----------------------------------

if (typeof window !== 'undefined' && typeof vivaldi !== 'undefined' && typeof chrome !== 'undefined' && chrome.tabs) {
  // 貼り直しや二重読み込みに備えて、前のインスタンスを止める
  if (window.workspaceRouter) window.workspaceRouter.stop();
  const router = createRouter({ adapter: createVivaldiAdapter(), config: CONFIG });
  window.workspaceRouter = router;
  router.start().catch((e) => console.error(LOG_PREFIX, 'failed to start', e));
}
