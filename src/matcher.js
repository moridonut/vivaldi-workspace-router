// タブのタイトルと URL から、振り分け先のワークスペース候補を求める純粋関数。
// Vivaldi には依存しない（Node の node --test で検証する）。

const JA_LEGAL_FORMS = ['株式会社', '有限会社', '合同会社', '合資会社', '合名会社', '(株)', '(有)', '(同)'];
const EN_LEGAL_FORMS = /(?<![a-z0-9])(?:inc|ltd|llc|corp|corporation|gmbh|plc)\.?(?![a-z0-9])/g;
const URL_PREFIX = 'url:';
const DEFAULT_MIN_KEYWORD_LENGTH = 3; // 英字だけのキーワード
const DEFAULT_MIN_KEYWORD_LENGTH_NON_ASCII = 2; // 日本語を含むキーワード（2 文字の社名がある）

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

// 文字列中の出現位置 [start, end) をすべて返す
function substringSpans(text, s) {
  const spans = [];
  for (let i = s.indexOf(text); i !== -1; i = s.indexOf(text, i + 1)) spans.push([i, i + text.length]);
  return spans;
}

function compileKeyword(raw, minLength) {
  const urlOnly = String(raw).toLowerCase().startsWith(URL_PREFIX);
  const text = urlOnly ? normalizeUrl(String(raw).slice(URL_PREFIX.length)).trim() : normalizeText(raw);
  const min = isAscii(text) ? minLength.ascii : minLength.nonAscii;
  if ([...text].length < min) return { error: 'too-short', text };
  // 英字キーワードは単語境界、日本語を含むキーワードと url: は部分一致
  if (!urlOnly && isAscii(text)) {
    const re = new RegExp(`(?<![a-z0-9])${escapeRegExp(text)}(?![a-z0-9])`, 'g');
    return { keyword: { text, urlOnly, spans: (s) => [...s.matchAll(re)].map((m) => [m.index, m.index + text.length]) } };
  }
  return { keyword: { text, urlOnly, spans: (s) => substringSpans(text, s) } };
}

// workspaces: [{ id, name }]
// config: { aliases, ignoreWorkspaces, minKeywordLength }
// 戻り値: { entries: [{ id, name, keywords }], warnings: [{ reason, workspace, keyword }] }
export function buildIndex(workspaces, config = {}) {
  const minLength = {
    ascii: config.minKeywordLength ?? DEFAULT_MIN_KEYWORD_LENGTH,
    nonAscii: config.minKeywordLengthNonAscii ?? DEFAULT_MIN_KEYWORD_LENGTH_NON_ASCII,
  };
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

// 1 つの文字列（タイトルか URL）について、ワークスペースごとの一致を集める。
// 別のワークスペースのより長いキーワードの中にだけ現れる一致は捨てる
// （「帝都物流様」は 帝都物流 に一致し、帝都 には一致しない）。
function hitsIn(index, s, field) {
  const found = []; // { entry, keyword, spans }
  for (const entry of index.entries) {
    for (const keyword of entry.keywords) {
      if (field === 'title' && keyword.urlOnly) continue;
      const spans = keyword.spans(s);
      if (spans.length) found.push({ entry, keyword, spans });
    }
  }
  const covered = ([a, b], self) =>
    found.some(
      (o) => o.entry !== self.entry && o.keyword.text.length > self.keyword.text.length && o.spans.some(([c, d]) => c <= a && b <= d)
    );
  return found.filter((f) => f.spans.some((span) => !covered(span, f)));
}

// tab: { title, url }
// 戻り値: 一致したワークスペースごとに [{ workspaceId, name, keywords }]（一致したキーワード）
export function matchTab(index, tab) {
  const hits = [
    ...hitsIn(index, normalizeText(tab && tab.title), 'title'),
    ...hitsIn(index, normalizeUrl(tab && tab.url), 'url'),
  ];
  const matches = [];
  for (const entry of index.entries) {
    const keywords = [...new Set(hits.filter((h) => h.entry === entry).map((h) => h.keyword.text))];
    if (keywords.length) matches.push({ workspaceId: entry.id, name: entry.name, keywords });
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
