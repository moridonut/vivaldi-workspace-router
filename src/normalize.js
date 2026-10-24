// URL から重複判定キーを作る純粋関数。
// 同じものを指す URL は同じキーになる。重複処理しない URL は null を返す。

const TRACKING_PARAMS = /^(?:utm_.*|gclid|gbraid|wbraid|fbclid|msclkid|yclid|igshid|mc_cid|mc_eid|_hsenc|_hsmi)$/i;

// Google Slides / Docs / Sheets など: 種類 + ファイル ID
function googleKey(url) {
  if (url.host !== 'docs.google.com') return undefined;
  const m = url.pathname.match(/^\/(presentation|document|spreadsheets|forms|drawings)\/(?:u\/\d+\/)?d\/([^/]+)/);
  return m ? `google:${m[1]}:${m[2]}` : undefined;
}

// Salesforce Lightning のレコード画面: 組織 + オブジェクト種別 + レコード ID の先頭 15 桁
function salesforceKey(url) {
  if (!/\.lightning\.force\.com$/.test(url.host)) return undefined;
  const m = url.pathname.match(/^\/lightning\/r\/([^/]+)\/([a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?)(?:\/|$)/);
  return m ? `sfdc:${url.host}:${m[1].toLowerCase()}:${m[2].slice(0, 15)}` : undefined;
}

// Celonis: パスにリソース ID があるときだけ、ホスト + パスをキーにする。
// ID のないページ（スペース一覧など）は同じ URL で別のアプリを表示していることがあるため重複処理しない
const RESOURCE_ID = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|(?=.*\d)[\w-]{10,})$/i;
function celonisKey(url) {
  if (!/\.celonis\.cloud$/.test(url.host)) return undefined;
  const segments = url.pathname.split('/').filter(Boolean);
  if (!segments.some((s) => RESOURCE_ID.test(s))) return null;
  return `celonis:${url.host}/${segments.join('/')}`;
}

// その他: ハッシュと追跡パラメータを除き、パラメータを並べ替えた URL
function genericKey(url) {
  const params = [...url.searchParams].filter(([k]) => !TRACKING_PARAMS.test(k));
  params.sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0));
  const query = params.length ? '?' + new URLSearchParams(params).toString() : '';
  return `url:${url.protocol}//${url.host}${url.pathname}${query}`;
}

export function dedupeKey(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  for (const rule of [googleKey, salesforceKey, celonisKey]) {
    const key = rule(url);
    if (key !== undefined) return key;
  }
  return genericKey(url);
}
