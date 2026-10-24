// install.sh を偽の Vivaldi.app に対して動かして確かめる（macOS 以外でも動く）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INSTALL = path.join(REPO, 'install.sh');

// 実機の window.html（docs/findings.md #1）
const WINDOW_HTML = `<!-- Vivaldi window document -->
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>Vivaldi</title>
  <link rel="stylesheet" href="style/common.css" />
  <link rel="stylesheet" href="chrome://vivaldi-data/css-mods/css" />
</head>

<body>
</body>

</html>
`;

function fakeApp({ versions = ['8.2.4133.84'], current = versions.at(-1) } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wsr-'));
  const app = path.join(root, 'Vivaldi.app');
  const vdir = path.join(app, 'Contents/Frameworks/Vivaldi Framework.framework/Versions');
  for (const v of versions) {
    const res = path.join(vdir, v, 'Resources/vivaldi');
    fs.mkdirSync(res, { recursive: true });
    fs.writeFileSync(path.join(res, 'window.html'), WINDOW_HTML);
  }
  if (current) fs.symlinkSync(current, path.join(vdir, 'Current'));
  const env = {
    ...process.env,
    VIVALDI_APP: app,
    LAUNCH_AGENTS_DIR: path.join(root, 'LaunchAgents'),
    WSR_LOG: path.join(root, 'wsr.log'),
    WSR_NO_LAUNCHCTL: '1',
    WSR_WAIT_TRIES: '1',
    WSR_WAIT_SEC: '0',
  };
  const res = (v) => path.join(vdir, v, 'Resources/vivaldi');
  const run = (...args) => spawnSync('bash', [INSTALL, ...args], { env, encoding: 'utf8' });
  return { root, app, vdir, res, run, env };
}

const read = (p) => fs.readFileSync(p, 'utf8');
const TAG = '<script src="workspace-router.js"></script>';

test('install: window.html の </body> の直前にタグを入れ、スクリプトを置き、元を .bak に残す', () => {
  const f = fakeApp();
  const r = f.run();
  assert.equal(r.status, 0, r.stderr);
  const html = read(path.join(f.res('8.2.4133.84'), 'window.html'));
  assert.match(html, new RegExp(`${TAG.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n</body>`));
  assert.equal(read(path.join(f.res('8.2.4133.84'), 'window.html.bak')), WINDOW_HTML);
  assert.equal(
    read(path.join(f.res('8.2.4133.84'), 'workspace-router.js')),
    read(path.join(REPO, 'dist/workspace-router.js'))
  );
});

test('install: 2 回実行しても同じ（タグは 1 つ、.bak は元のまま）', () => {
  const f = fakeApp();
  f.run();
  const r = f.run();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /already installed/);
  const html = read(path.join(f.res('8.2.4133.84'), 'window.html'));
  assert.equal(html.split(TAG).length - 1, 1);
  assert.equal(read(path.join(f.res('8.2.4133.84'), 'window.html.bak')), WINDOW_HTML);
});

test('uninstall: window.html を元に戻し、スクリプトと .bak を消す', () => {
  const f = fakeApp();
  f.run();
  const r = f.run('--uninstall');
  assert.equal(r.status, 0, r.stderr);
  const res = f.res('8.2.4133.84');
  assert.equal(read(path.join(res, 'window.html')), WINDOW_HTML);
  assert.equal(fs.existsSync(path.join(res, 'workspace-router.js')), false);
  assert.equal(fs.existsSync(path.join(res, 'window.html.bak')), false);
});

test('uninstall: .bak がなくてもタグの行だけ消す', () => {
  const f = fakeApp();
  f.run();
  fs.rmSync(path.join(f.res('8.2.4133.84'), 'window.html.bak'));
  f.run('--uninstall');
  assert.equal(read(path.join(f.res('8.2.4133.84'), 'window.html')).includes('workspace-router'), false);
});

test('Current のリンクが指すバージョンに入れる', () => {
  const f = fakeApp({ versions: ['8.1.0.1', '8.2.4133.84'], current: '8.1.0.1' });
  f.run();
  assert.match(read(path.join(f.res('8.1.0.1'), 'window.html')), /workspace-router/);
  assert.doesNotMatch(read(path.join(f.res('8.2.4133.84'), 'window.html')), /workspace-router/);
});

test('Current がなければ番号がいちばん新しいバージョンに入れる', () => {
  const f = fakeApp({ versions: ['8.2.900.1', '8.10.1.1', '8.2.4133.84'], current: null });
  f.run();
  assert.match(read(path.join(f.res('8.10.1.1'), 'window.html')), /workspace-router/);
});

test('Vivaldi が見つからなければ失敗する', () => {
  const f = fakeApp();
  fs.rmSync(f.app, { recursive: true });
  const r = f.run();
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /window\.html が見つかりません/);
});

test('--auto: ビルドせず dist/ のスクリプトを入れる。見つからなければ失敗して終わる', () => {
  const f = fakeApp();
  const ok = f.run('--auto');
  assert.equal(ok.status, 0, ok.stderr + ok.stdout);
  assert.match(read(path.join(f.res('8.2.4133.84'), 'window.html')), /workspace-router/);
  fs.rmSync(f.app, { recursive: true });
  const ng = f.run('--auto');
  assert.equal(ng.status, 1);
});

test('--auto: 新しいバージョンのフォルダができたら、そちらに入れ直す', () => {
  const f = fakeApp();
  f.run();
  const nv = path.join(f.vdir, '8.3.0.1', 'Resources/vivaldi');
  fs.mkdirSync(nv, { recursive: true });
  fs.writeFileSync(path.join(nv, 'window.html'), WINDOW_HTML);
  fs.rmSync(path.join(f.vdir, 'Current'));
  fs.symlinkSync('8.3.0.1', path.join(f.vdir, 'Current'));
  const r = f.run('--auto');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(read(path.join(nv, 'window.html')), /workspace-router/);
  assert.ok(fs.existsSync(path.join(nv, 'workspace-router.js')));
});

test('--agent: LaunchAgent の plist を作る。--remove-agent で消す', () => {
  const f = fakeApp();
  const r = f.run('--agent');
  assert.equal(r.status, 0, r.stderr);
  const plist = path.join(f.env.LAUNCH_AGENTS_DIR, 'com.github.moridonut.vivaldi-workspace-router.plist');
  const xml = read(plist);
  assert.match(xml, /<string>--auto<\/string>/);
  assert.match(xml, new RegExp(`<string>${INSTALL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</string>`));
  assert.ok(xml.includes(`<string>${f.vdir}</string>`), 'WatchPaths');
  assert.match(xml, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(xml, /<key>StartInterval<\/key>\s*<integer>3600<\/integer>/);
  if (spawnSync('which', ['plutil']).status === 0) execFileSync('plutil', ['-lint', plist]);
  f.run('--remove-agent');
  assert.equal(fs.existsSync(plist), false);
});

test('--status', () => {
  const f = fakeApp();
  assert.match(f.run('--status').stdout, /mod:\s+not installed/);
  f.run();
  const out = f.run('--status').stdout;
  assert.match(out, /mod:\s+installed/);
  assert.match(out, /script:\s+up to date/);
});

// ---- --auto で書き込めないとき（launchd から動いた場合。docs/findings.md I） ----

// 書き込みが拒否される cp と、呼ばれた内容を記録する osascript を PATH の先頭に置く
function denyWrites(f, button) {
  const bin = path.join(f.root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'cp'), '#!/bin/bash\necho "cp: ${@: -1}: Operation not permitted" >&2\nexit 1\n', { mode: 0o755 });
  const log = path.join(f.root, 'osascript.log');
  fs.writeFileSync(
    path.join(bin, 'osascript'),
    `#!/bin/bash\nprintf '%s\\n' "$*" >> "${log}"\necho ---- >> "${log}"\ncase "$*" in *"display dialog"*) echo "button returned:${button}" ;; esac\n`,
    { mode: 0o755 }
  );
  f.env.PATH = `${bin}:${process.env.PATH}`;
  f.env.WSR_ASKED = path.join(f.root, 'asked');
  return { calls: () => (fs.existsSync(log) ? read(log).split('----\n').filter(Boolean) : []) };
}

test('--auto: 書き込めなければダイアログで聞き、「入れ直す」なら iTerm2 で install.sh を実行する', () => {
  const f = fakeApp();
  const o = denyWrites(f, '入れ直す');
  const r = f.run('--auto');
  assert.equal(r.status, 1);
  const calls = o.calls();
  assert.equal(calls.length, 2, calls.join('\n'));
  assert.match(calls[0], /display dialog/);
  assert.match(calls[1], /tell application "iTerm"/);
  assert.match(calls[1], /write text/);
  assert.ok(calls[1].includes(`${REPO}`) && calls[1].includes('./install.sh'), calls[1]);
});

test('--auto: 「あとで」なら何もしない。同じバージョンでは 12 時間聞き直さない', () => {
  const f = fakeApp();
  const o = denyWrites(f, 'あとで');
  f.run('--auto');
  f.run('--auto');
  const calls = o.calls();
  assert.equal(calls.length, 1, calls.join('\n'));
  assert.match(calls[0], /display dialog/);
});

test('--auto: バージョンが変わったら、12 時間以内でもまた聞く', () => {
  const f = fakeApp();
  const o = denyWrites(f, 'あとで');
  f.run('--auto');
  const nv = path.join(f.vdir, '8.3.0.1', 'Resources/vivaldi');
  fs.mkdirSync(nv, { recursive: true });
  fs.writeFileSync(path.join(nv, 'window.html'), WINDOW_HTML);
  fs.rmSync(path.join(f.vdir, 'Current'));
  fs.symlinkSync('8.3.0.1', path.join(f.vdir, 'Current'));
  f.run('--auto');
  assert.equal(o.calls().filter((c) => /display dialog/.test(c)).length, 2);
});

test('--auto: 組み込み済みならダイアログを出さない', () => {
  const f = fakeApp();
  f.run();
  const o = denyWrites(f, '入れ直す');
  const r = f.run('--auto');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.deepEqual(o.calls(), []);
});
