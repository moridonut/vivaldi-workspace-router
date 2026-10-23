// Phase 1 (Spike) 検証スニペット
//
// 使い方: Vivaldi の UI DevTools のコンソールにこのファイル全体を貼り付けて Enter。
// その後 spike.help() に従って各コマンドを実行する。詳細は spike/README.md。
//
// - Vivaldi 固有 API は名前を決め打ちせず、候補を順に試して何が存在したかを記録する。
// - 既存タブは閉じない・動かさない。書き込みを伴う操作は、このスニペット自身が作ったテストタブだけに行う。
// - spike.report() が出す JSON は public リポジトリに載せる前提で、顧客名・タイトル・URL の実値を含めない。
//   実値は console.log でユーザーの画面にだけ出す。

window.spike = (() => {
  const results = {};
  const createdTabIds = [];

  // ---- helpers ----------------------------------------------------------

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // chrome.* をコールバック形式で呼ぶ（Promise 対応の有無に依存しない）
  const call = (fn, ...args) =>
    new Promise((resolve, reject) => {
      try {
        fn(...args, (r) => {
          const e = chrome.runtime && chrome.runtime.lastError;
          e ? reject(new Error(e.message)) : resolve(r);
        });
      } catch (e) {
        reject(e);
      }
    });

  // vivaldi.prefs.get はコールバック形式か Promise 形式か不明なので両対応
  const prefGet = (path) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), 3000);
      const done = (v) => { clearTimeout(timer); resolve(v); };
      try {
        const r = vivaldi.prefs.get(path, done);
        if (r && typeof r.then === 'function') r.then(done, (e) => { clearTimeout(timer); reject(e); });
      } catch (e) {
        clearTimeout(timer);
        reject(e);
      }
    });

  const errMsg = (e) => String((e && e.message) || e);

  const keysOf = (o) => (o && typeof o === 'object' ? Object.keys(o).sort() : []);

  // 値の「形」だけを返す（文字列の中身は出さない）
  const shape = (v, depth = 0) => {
    if (v === null) return 'null';
    if (Array.isArray(v)) return depth > 3 ? 'array' : [v.length ? shape(v[0], depth + 1) : 'empty', `len=${v.length}`];
    if (typeof v === 'object') {
      if (depth > 3) return 'object';
      const out = {};
      for (const k of Object.keys(v).sort()) out[k] = shape(v[k], depth + 1);
      return out;
    }
    if (typeof v === 'string') return `string(${v.length})`;
    return typeof v;
  };

  // 拡張データのプロパティ名を自動検出して JSON を parse
  const EXT_KEYS = ['vivExtData', 'extData'];
  const extKeyOf = (obj) => EXT_KEYS.find((k) => obj && k in obj) || null;
  const extOf = (obj) => {
    const k = extKeyOf(obj);
    if (!k) return { key: null, raw: undefined, data: null, parseError: null };
    const raw = obj[k];
    if (raw && typeof raw === 'object') return { key: k, raw, data: raw, parseError: null };
    try {
      return { key: k, raw, data: raw ? JSON.parse(raw) : {}, parseError: null };
    } catch (e) {
      return { key: k, raw, data: null, parseError: errMsg(e) };
    }
  };

  const getAllTabs = () => call(chrome.tabs.query, {});
  const getTab = (id) => call(chrome.tabs.get, id);

  let workspacesCache = null;
  const getWorkspaces = async () => {
    if (workspacesCache) return workspacesCache;
    const r = await spike.workspaces({ quiet: true });
    return r.list || [];
  };

  // 簡易正規化（判定用。本実装の normalize とは別物）
  const norm = (s) => String(s || '').normalize('NFKC').toLowerCase();

  // URL から ID っぽい部分を伏せたテンプレートを作る
  const maskSegment = (seg) => {
    if (!seg) return seg;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) return '<uuid>';
    if (/^[a-zA-Z0-9]{15}$|^[a-zA-Z0-9]{18}$/.test(seg) && /\d/.test(seg)) return `<id${seg.length}>`;
    if (seg.length >= 10 && /\d/.test(seg) && /^[\w-]+$/.test(seg)) return `<id:${seg.length}>`;
    if (/^\d+$/.test(seg)) return '<num>';
    return seg.length > 40 ? `<str:${seg.length}>` : seg;
  };
  const maskHost = (host) => {
    const parts = host.split('.');
    if (/force\.com$|salesforce\.com$|celonis\.cloud$|celonis\.com$/.test(host) && parts.length > 2) {
      return ['<org>', ...parts.slice(1)].join('.');
    }
    return host;
  };
  const urlTemplate = (u) => {
    try {
      const url = new URL(u);
      const hashParams = url.hash.replace(/^#\/?/, '');
      return {
        scheme: url.protocol.replace(':', ''),
        host: maskHost(url.host),
        path: url.pathname.split('/').map(maskSegment).join('/'),
        queryKeys: [...url.searchParams.keys()].sort(),
        hash: hashParams ? hashParams.split(/[/?&]/).map((s) => maskSegment(s.split('=')[0])).join('|') : '',
      };
    } catch {
      return { scheme: String(u).split(':')[0], unparsable: true };
    }
  };
  const schemeOf = (u) => String(u || '').split(':')[0] || '(empty)';

  // ---- checks -----------------------------------------------------------

  const spike = {
    results,
    createdTabIds,

    help() {
      console.log(`%cVivaldi workspace-router spike`, 'font-weight:bold;font-size:14px');
      console.log(`
推奨順:
  await spike.env()           // [1] HTML ファイル名、API の有無
  await spike.tabs()          // [2] タブ拡張データのプロパティ名と workspaceId の形
  await spike.workspaces()    // [3] ワークスペース一覧の設定キーと構造
  await spike.moveTest()      // [4] テストタブを作り、別ワークスペースへ移す → 目視確認
  await spike.activateTest()  // [5] 別ワークスペースのテストタブをアクティブに → 目視確認
  await spike.hibernated()    // [6] ハイバネート中のタブで URL/タイトルが取れるか
  await spike.windows()       // [7] ウェブパネル / アプリウィンドウの見分け方
  await spike.titles()        // [8][9] 実タイトルに顧客名が入るか、Celonis の URL 構造
  spike.watch(90)             // イベントの流れ（タイトル確定の遅れ、手動移動の検出）
  spike.report()              // 結果 JSON をクリップボードへ（顧客名等は含まない）
[10] アプリバンドルへの書き込みはターミナルで spike/check-bundle.sh を実行。`);
    },

    // [1] HTML ファイル名と API の存在確認
    async env() {
      const r = {
        page: location.pathname.split('/').pop(),
        href: location.protocol + '//' + location.host + location.pathname,
        userAgent: navigator.userAgent,
        vivaldiNamespaces: typeof vivaldi === 'object' ? Object.keys(vivaldi).sort() : null,
        prefsApi: typeof vivaldi === 'object' && vivaldi.prefs ? Object.keys(vivaldi.prefs).sort() : null,
        tabsApi: typeof chrome === 'object' && chrome.tabs ? Object.keys(chrome.tabs).sort() : null,
        windowsApi: typeof chrome === 'object' && chrome.windows ? Object.keys(chrome.windows).sort() : null,
      };
      try {
        if (vivaldi.utilities && typeof vivaldi.utilities.getVersion === 'function') {
          r.vivaldiVersion = await call(vivaldi.utilities.getVersion);
        }
      } catch (e) {
        r.vivaldiVersionError = errMsg(e);
      }
      results.env = r;
      console.log('[1] env', r);
      return r;
    },

    // [2] タブの拡張データ
    async tabs() {
      const tabs = await getAllTabs();
      const tabKeys = {};
      const extKeyCount = {};
      const extInnerKeys = {};
      const workspaceIdTypes = {};
      const workspaceIdSamples = new Set();
      let parseErrors = 0;
      for (const t of tabs) {
        for (const k of Object.keys(t)) tabKeys[k] = (tabKeys[k] || 0) + 1;
        const ext = extOf(t);
        extKeyCount[ext.key || '(none)'] = (extKeyCount[ext.key || '(none)'] || 0) + 1;
        if (ext.parseError) parseErrors++;
        if (ext.data) {
          for (const k of Object.keys(ext.data)) extInnerKeys[k] = (extInnerKeys[k] || 0) + 1;
          if ('workspaceId' in ext.data) {
            const w = ext.data.workspaceId;
            workspaceIdTypes[typeof w] = (workspaceIdTypes[typeof w] || 0) + 1;
            if (workspaceIdSamples.size < 10) workspaceIdSamples.add(w);
          }
        }
      }
      const sample = tabs.find((t) => extOf(t).data && 'workspaceId' in extOf(t).data);
      const r = {
        tabCount: tabs.length,
        tabKeys,
        extDataProperty: extKeyCount,
        extDataRawType: sample ? typeof sample[extKeyOf(sample)] : null,
        extInnerKeys,
        workspaceIdTypes,
        workspaceIdSamples: [...workspaceIdSamples],
        parseErrors,
        sampleExtShape: sample ? shape(extOf(sample).data) : null,
      };
      results.tabs = r;
      console.log('[2] tabs', r);
      if (sample) console.log('    (ローカル表示のみ) サンプルタブの拡張データ:', extOf(sample).data);
      return r;
    },

    // [3] ワークスペース一覧
    async workspaces({ quiet = false } = {}) {
      const candidates = ['vivaldi.workspaces.list', 'vivaldi.workspaces'];
      const tried = {};
      let list = null;
      let usedKey = null;
      for (const key of candidates) {
        try {
          const v = await prefGet(key);
          tried[key] = { ok: true, shape: shape(v) };
          if (!list && Array.isArray(v)) { list = v; usedKey = key; }
          if (!list && v && Array.isArray(v.list)) { list = v.list; usedKey = key + ' (.list)'; }
        } catch (e) {
          tried[key] = { ok: false, error: errMsg(e) };
        }
      }
      workspacesCache = list;
      const r = {
        tried,
        usedKey,
        count: list ? list.length : null,
        itemShape: list && list[0] ? shape(list[0]) : null,
        // id はそのまま、名前は伏せる
        items: list ? list.map((w, i) => ({ index: i, id: w.id, idType: typeof w.id, nameLength: (w.name || '').length })) : null,
        hasOnChanged: !!(vivaldi.prefs && vivaldi.prefs.onChanged),
      };
      if (!quiet) {
        results.workspaces = r;
        console.log('[3] workspaces', r);
        if (list) console.table(list.map((w) => ({ id: w.id, name: w.name })));
      }
      return { ...r, list: list || [] };
    },

    // ワークスペース切替を監視する（onChanged の通知内容を確認）
    watchPrefs(seconds = 30) {
      if (!(vivaldi.prefs && vivaldi.prefs.onChanged)) {
        console.warn('vivaldi.prefs.onChanged が見つかりません');
        return;
      }
      const events = [];
      const t0 = Date.now();
      const fn = (info) => {
        const path = info && (info.path || info.name);
        if (path && !/workspace/i.test(path)) return;
        events.push({ t: Date.now() - t0, path, valueShape: shape(info && info.value) });
        console.log('[prefs.onChanged]', info);
      };
      vivaldi.prefs.onChanged.addListener(fn);
      console.log(`${seconds}秒間 workspace 関連の設定変更を監視します。ワークスペースの切替・作成・名前変更を試してください。`);
      setTimeout(() => {
        vivaldi.prefs.onChanged.removeListener(fn);
        results.watchPrefs = events;
        console.log('watchPrefs 終了', events);
      }, seconds * 1000);
    },

    // [4] 拡張データの workspaceId 書き換えで移動できるか
    async moveTest(targetWorkspaceId) {
      const list = await getWorkspaces();
      const r = { steps: [] };
      const tab0 = await call(chrome.tabs.create, { url: 'https://example.com/#spike-move', active: false });
      createdTabIds.push(tab0.id);
      r.testTabId = tab0.id;
      await sleep(1500);
      const before = await getTab(tab0.id);
      const ext = extOf(before);
      r.extKey = ext.key;
      r.beforeWorkspaceId = ext.data && ext.data.workspaceId;
      const target =
        targetWorkspaceId !== undefined
          ? targetWorkspaceId
          : (list.find((w) => w.id !== r.beforeWorkspaceId) || {}).id;
      r.targetWorkspaceId = target;
      if (!ext.key || !ext.data || target === undefined) {
        r.error = '拡張データかワークスペース候補が見つからないため中止';
        results.moveTest = r;
        console.warn('[4] moveTest', r);
        return r;
      }
      try {
        const next = { ...ext.data, workspaceId: target };
        const value = typeof ext.raw === 'string' ? JSON.stringify(next) : next;
        await call(chrome.tabs.update, tab0.id, { [ext.key]: value });
        r.steps.push('update ok');
      } catch (e) {
        r.steps.push('update error: ' + errMsg(e));
      }
      await sleep(800);
      const after = await getTab(tab0.id);
      const extAfter = extOf(after);
      r.afterWorkspaceId = extAfter.data && extAfter.data.workspaceId;
      r.persisted = r.afterWorkspaceId === target;
      r.visual = '未確認: spike.visual("moveTest", "...") で記録';
      results.moveTest = r;
      console.log('[4] moveTest', r);
      const name = (list.find((w) => w.id === target) || {}).name;
      console.log(
        `%c目視確認: example.com のタブが今のタブバーから即座に消え、ワークスペース「${name}」に出ているか？`,
        'font-weight:bold'
      );
      console.log('確認後に例: spike.visual("moveTest", "即座に消えた。移動先に表示された")');
      return r;
    },

    // [5] 別ワークスペースのタブを active にしたとき、ワークスペースも切り替わるか
    async activateTest() {
      const id = createdTabIds[createdTabIds.length - 1];
      if (id === undefined) {
        console.warn('先に spike.moveTest() を実行してください');
        return;
      }
      const win = await call(chrome.windows.getCurrent, {});
      const winExtBefore = extOf(win);
      const r = { testTabId: id, windowKeys: keysOf(win), windowExtKey: winExtBefore.key, windowExtBeforeShape: shape(winExtBefore.data) };
      try {
        await call(chrome.tabs.update, id, { active: true });
        r.update = 'ok';
      } catch (e) {
        r.update = 'error: ' + errMsg(e);
      }
      await sleep(800);
      const winAfter = await call(chrome.windows.get, win.id, {});
      const winExtAfter = extOf(winAfter);
      r.windowExtChangedKeys = winExtBefore.data && winExtAfter.data
        ? Object.keys({ ...winExtBefore.data, ...winExtAfter.data }).filter(
            (k) => JSON.stringify(winExtBefore.data[k]) !== JSON.stringify(winExtAfter.data[k])
          )
        : null;
      r.visual = '未確認: spike.visual("activateTest", "...") で記録';
      results.activateTest = r;
      console.log('[5] activateTest', r);
      console.log('    (ローカル表示のみ) window 拡張データ before/after:', winExtBefore.data, winExtAfter.data);
      console.log('%c目視確認: 画面のワークスペースがテストタブのある方へ切り替わったか？', 'font-weight:bold');
      return r;
    },

    // [6] ハイバネート中のタブ
    async hibernated() {
      const tabs = await getAllTabs();
      const d = tabs.filter((t) => t.discarded);
      const r = {
        discardedCount: d.length,
        withUrl: d.filter((t) => t.url).length,
        withPendingUrl: d.filter((t) => t.pendingUrl).length,
        withTitle: d.filter((t) => t.title && t.title !== t.url).length,
        withExtWorkspaceId: d.filter((t) => extOf(t).data && 'workspaceId' in extOf(t).data).length,
        statuses: [...new Set(d.map((t) => t.status))],
      };
      if (!d.length) r.note = 'ハイバネート中のタブがありません。タブを右クリック→ハイバネートしてから再実行';
      results.hibernated = r;
      console.log('[6] hibernated', r);
      return r;
    },

    // [7] ウィンドウ種別とウェブパネル
    async windows() {
      const wins = await call(chrome.windows.getAll, { populate: true, windowTypes: ['normal', 'popup', 'panel', 'app', 'devtools'] });
      const inWindow = new Set();
      const perWindow = wins.map((w) => {
        (w.tabs || []).forEach((t) => inWindow.add(t.id));
        const wext = extOf(w);
        const tabExtKeys = {};
        const schemes = {};
        for (const t of w.tabs || []) {
          const e = extOf(t);
          for (const k of keysOf(e.data)) tabExtKeys[k] = (tabExtKeys[k] || 0) + 1;
          const s = schemeOf(t.url || t.pendingUrl);
          schemes[s] = (schemes[s] || 0) + 1;
        }
        return {
          type: w.type,
          incognito: w.incognito,
          tabCount: (w.tabs || []).length,
          windowExtKey: wext.key,
          windowExtShape: shape(wext.data),
          tabExtKeys,
          schemes,
        };
      });
      const all = await getAllTabs();
      const orphan = all.filter((t) => !inWindow.has(t.id));
      const panelLike = all.filter((t) => {
        const e = extOf(t).data || {};
        return Object.keys(e).some((k) => /panel/i.test(k));
      });
      const r = {
        windows: perWindow,
        tabsNotInAnyListedWindow: orphan.length,
        tabsWithPanelLikeExtKey: panelLike.length,
        panelLikeExtKeys: [...new Set(panelLike.flatMap((t) => Object.keys(extOf(t).data || {}).filter((k) => /panel/i.test(k))))],
        panelLikeWindowIds: [...new Set(panelLike.map((t) => wins.findIndex((w) => w.id === t.windowId)))],
      };
      results.windows = r;
      console.log('[7] windows', r);
      console.log('    ウェブパネルとアプリ（PWA）ウィンドウを開いた状態で実行してください');
      return r;
    },

    // [8][9] 実タイトルに顧客名が入るか、各サービスの URL 構造
    async titles() {
      const list = await getWorkspaces();
      const names = list.map((w) => norm(w.name)).filter((n) => n.length > 2);
      const tabs = await getAllTabs();
      const service = (u) => {
        let h = '';
        try { h = new URL(u).host; } catch { return null; }
        if (/force\.com$|salesforce\.com$/.test(h)) return 'salesforce';
        if (h === 'docs.google.com') return 'google-docs';
        if (/celonis/.test(h)) return 'celonis';
        return null;
      };
      const rows = [];
      const local = [];
      for (const t of tabs) {
        const u = t.url || t.pendingUrl;
        const svc = service(u);
        if (!svc) continue;
        const title = norm(t.title);
        const hits = list.filter((w) => norm(w.name).length > 2 && title.includes(norm(w.name)));
        const ownWs = extOf(t).data && extOf(t).data.workspaceId;
        rows.push({
          service: svc,
          url: urlTemplate(u),
          titleLength: (t.title || '').length,
          titleHasWorkspaceName: hits.length > 0,
          titleHitCount: hits.length,
          hitIsOwnWorkspace: hits.length === 1 ? hits[0].id === ownWs : null,
          discarded: !!t.discarded,
        });
        local.push({ service: svc, title: t.title, hits: hits.map((w) => w.name).join(', ') });
      }
      const summary = {};
      for (const row of rows) {
        const s = (summary[row.service] ||= { tabs: 0, titleHasName: 0, conflicts: 0 });
        s.tabs++;
        if (row.titleHasWorkspaceName) s.titleHasName++;
        if (row.titleHitCount > 1) s.conflicts++;
      }
      const r = { workspaceNamesChecked: names.length, summary, rows };
      results.titles = r;
      console.log('[8][9] titles', summary);
      console.table(rows.map((x) => ({ service: x.service, host: x.url.host, path: x.url.path, hash: x.url.hash, hit: x.titleHitCount })));
      console.log('    (ローカル表示のみ) 実タイトル:');
      console.table(local);
      return r;
    },

    // タブイベントの流れを観察する
    watch(seconds = 90) {
      const t0 = Date.now();
      const born = {};
      const events = [];
      const lastWs = {};
      const onCreated = (t) => {
        born[t.id] = Date.now();
        lastWs[t.id] = extOf(t).data && extOf(t).data.workspaceId;
        events.push({ t: Date.now() - t0, ev: 'created', tab: t.id, windowId: t.windowId, scheme: schemeOf(t.url || t.pendingUrl), opener: t.openerTabId !== undefined, ext: extOf(t).key });
      };
      const onUpdated = (id, info, t) => {
        const e = { t: Date.now() - t0, ev: 'updated', tab: id, sinceCreated: born[id] ? Date.now() - born[id] : null, keys: Object.keys(info) };
        if (info.status) e.status = info.status;
        if (info.url) e.urlScheme = schemeOf(info.url); // ホスト名は顧客サイトのことがあるので出さない
        if (info.title) e.titleLength = info.title.length;
        for (const k of EXT_KEYS) {
          if (k in info) {
            let d = null;
            try { d = typeof info[k] === 'string' ? JSON.parse(info[k]) : info[k]; } catch {}
            const ws = d && d.workspaceId;
            e.extChanged = k;
            e.workspaceIdChanged = ws !== lastWs[id];
            lastWs[id] = ws;
          }
        }
        events.push(e);
      };
      const onActivated = (info) => events.push({ t: Date.now() - t0, ev: 'activated', tab: info.tabId });
      const onRemoved = (id) => events.push({ t: Date.now() - t0, ev: 'removed', tab: id });
      chrome.tabs.onCreated.addListener(onCreated);
      chrome.tabs.onUpdated.addListener(onUpdated);
      chrome.tabs.onActivated.addListener(onActivated);
      chrome.tabs.onRemoved.addListener(onRemoved);
      console.log(`${seconds}秒間タブイベントを記録します。この間に次を試してください:
  a) Slack かメールから Salesforce の商談リンクを開く（タイトル確定の遅れ）
  b) Slides のリンクを開く
  c) 適当なタブを右クリック→「ワークスペースへ移動」で手動移動（F6 の検出可否）
  d) ウェブパネルで任意のページを開く（除外できるか）`);
      setTimeout(() => {
        chrome.tabs.onCreated.removeListener(onCreated);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        chrome.tabs.onActivated.removeListener(onActivated);
        chrome.tabs.onRemoved.removeListener(onRemoved);
        results.watch = events;
        console.log('watch 終了', events.length, 'events');
        console.table(events);
      }, seconds * 1000);
    },

    // 目視確認の結果を記録
    visual(check, note) {
      if (!results[check]) results[check] = {};
      results[check].visual = note;
      console.log(`記録しました: ${check}.visual = ${note}`);
    },

    // 結果をクリップボードへ（DevTools の copy() を使う）
    report() {
      const json = JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2);
      if (typeof copy === 'function') {
        copy(json);
        console.log('結果 JSON をクリップボードにコピーしました。Claude Code に貼り付けてください。');
      } else {
        console.log(json);
      }
      return json;
    },
  };

  return spike;
})();

spike.help();
