// タブのタイトルと URL から、振り分け先のワークスペース候補を求める純粋関数。
// Vivaldi には依存しない（Node の node --test で検証する）。

const JA_LEGAL_FORMS = ['株式会社', '有限会社', '合同会社', '合資会社', '合名会社', '(株)', '(有)', '(同)'];
const EN_LEGAL_FORMS = /(?<![a-z0-9])(?:inc|ltd|llc|corp|corporation|gmbh|plc)\.?(?![a-z0-9])/g;
const URL_PREFIX = 'url:';
const DEFAULT_MIN_KEYWORD_LENGTH = 3;

const isAscii = (s) => /^[\x00-\x7f]*$/.test(s);
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// NFKC → 小文字 → 法人格の除去 → 空白の正規化
export function normalizeText(s) {
  let t = String(s ?? '').normalize('NFKC').toLowerCase();
  for (const form of JA_LEGAL_FORMS) t = t.split(form).join(' ');
  t = t.replace(EN_LEGAL_FORMS, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

// URL は法人格を除かない。エンコードされた日本語も照合できるようにデコードする
function normalizeUrl(u) {
  let t = String(u ?? '');
  try {
    t = decodeURIComponent(t);
  } catch {
    // 壊れたエスケープはそのまま照合する
  }
  return t.normalize('NFKC').toLowerCase();
}

function compileKeyword(raw, minLength) {
  const urlOnly = String(raw).toLowerCase().startsWith(URL_PREFIX);
  const text = urlOnly ? normalizeUrl(String(raw).slice(URL_PREFIX.length)).trim() : normalizeText(raw);
  if ([...text].length < minLength) return { error: 'too-short', text };
  // 英字キーワードは単語境界、日本語を含むキーワードと url: は部分一致
  const re = !urlOnly && isAscii(text) ? new RegExp(`(?<![a-z0-9])${escapeRegExp(text)}(?![a-z0-9])`) : null;
  return { keyword: { text, urlOnly, test: re ? (s) => re.test(s) : (s) => s.includes(text) } };
}

// workspaces: [{ id, name }]
// config: { aliases, ignoreWorkspaces, minKeywordLength }
// 戻り値: { entries: [{ id, name, keywords }], warnings: [{ reason, workspace, keyword }] }
export function buildIndex(workspaces, config = {}) {
  const minLength = config.minKeywordLength ?? DEFAULT_MIN_KEYWORD_LENGTH;
  const ignored = new Set((config.ignoreWorkspaces || []).map(normalizeText));
  const aliases = new Map();
  for (const [name, list] of Object.entries(config.aliases || {})) {
    const key = normalizeText(name);
    aliases.set(key, [...(aliases.get(key) || []), ...list]);
  }

  const warnings = [];
  const entries = [];
  const seenNames = new Set();
  for (const ws of workspaces || []) {
    const key = normalizeText(ws.name);
    seenNames.add(key);
    if (ignored.has(key)) continue;
    const keywords = [];
    const seenKeywords = new Set();
    for (const raw of [ws.name, ...(aliases.get(key) || [])]) {
      const r = compileKeyword(raw, minLength);
      if (r.error) {
        warnings.push({ reason: r.error, workspace: ws.name, keyword: String(raw) });
        continue;
      }
      const dedupe = (r.keyword.urlOnly ? URL_PREFIX : '') + r.keyword.text;
      if (seenKeywords.has(dedupe)) continue;
      seenKeywords.add(dedupe);
      keywords.push(r.keyword);
    }
    if (keywords.length) entries.push({ id: ws.id, name: ws.name, keywords });
  }

  for (const [key, list] of aliases) {
    if (!seenNames.has(key)) {
      warnings.push({ reason: 'unknown-workspace', workspace: key, keyword: list.join(', ') });
    }
  }
  return { entries, warnings };
}

// tab: { title, url }
// 戻り値: 一致したワークスペースごとに [{ workspaceId, name, keywords }]（一致したキーワード）
export function matchTab(index, tab) {
  const title = normalizeText(tab && tab.title);
  const url = normalizeUrl(tab && tab.url);
  const matches = [];
  for (const entry of index.entries) {
    const hit = entry.keywords.filter((k) => (k.urlOnly ? k.test(url) : k.test(title) || k.test(url)));
    if (hit.length) matches.push({ workspaceId: entry.id, name: entry.name, keywords: hit.map((k) => k.text) });
  }
  return matches;
}

// 一致数と今のワークスペースから動作を決める
export function decide(matches, currentWorkspaceId) {
  if (matches.length === 0) return { action: 'none' };
  if (matches.length > 1) return { action: 'conflict', candidates: matches.map((m) => m.name) };
  const target = matches[0].workspaceId;
  return { action: target === currentWorkspaceId ? 'stay' : 'move', target };
}
