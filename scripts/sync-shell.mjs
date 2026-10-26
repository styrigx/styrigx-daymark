#!/usr/bin/env node
/**
 * 同步主站共享外壳（styrigx/styrigx-space 的 web/shared/shell）：色彩角色、顶栏材质、导航抽屉、自定义主题色引擎、抽屉项。
 * 主站是唯一来源；本仓库只存一份「供应商副本」，放在标记段 / 供应商目录里，勿手改。
 *
 * 用法：
 *   node scripts/sync-shell.mjs                    从 styrigx-space@main 拉取并写入；lock 记下 main 当时的完整提交 SHA（锁定版本）
 *   node scripts/sync-shell.mjs --ref <分支|提交>    指定主站的 ref（同样解析成完整提交 SHA 写进 lock）
 *   node scripts/sync-shell.mjs --from <主站目录>    从本地主站检出读（主站改动还没合并时用；lock 不是 SHA，--check 会要求重新同步）
 *   node scripts/sync-shell.mjs --check            CI 用：① 供应商副本没被手改（和 sgx-shell.lock.json 一致）
 *                                                  ② 副本确实来自主站：按 lock 锁定的提交 SHA 拉主站外壳，版本和文件指纹都要和 lock 一致；
 *                                                     主站 main 前进不会让本检查变红（升级外壳 = 显式跑一次同步、改 lock 的 PR）
 *                                                  ③ 主站 main 上有更新的外壳时只打 ::notice::，不算失败。
 *                                                  拉主站失败只提示、不算失败（加 --strict 则失败）。
 *
 * 拉取：先读 manifest.json，再逐个拉文件并校验 sha256，全部通过才写盘。
 * __SITE_CONFIG__ 段是本仓库独有的写入位置，其余代码两个子站（blog / daymark）一字不差。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/* ---- __SITE_CONFIG__ ---- */
const SITE = {
  name: 'styrigx-daymark',
  targets: [
    /* 色彩角色 + 顶栏材质 + 导航抽屉：写进 input.css 的 @sgx-shell:begin / end 两行之间（Tailwind 编进 main.css） */
    { path: 'web/assets/css/input.css', kind: 'splice', parts: ['tokens.css', 'shell.css'] },
    /* 自定义主题色引擎（js/sgx/shell-accent.js 打包，只在 cookie 是自定义色且没有缓存时才加载） */
    { path: 'web/assets/js/sgx/shell/palette-scheme.js', kind: 'file', parts: ['palette-scheme.js'] },
    /* 原地搜索层（抽屉底栏搜索框原地变成贴键盘的底栏 + 结果层，不跳主站；js/sgx/search-host.js 打包） */
    { path: 'web/assets/js/sgx/shell/search.js', kind: 'file', parts: ['search.js'] },
    /* 顶栏右胶囊的分享按钮（管理员：生成带临时会话的短链再系统分享；访客：分享当前页；js/sgx/share-host.js 打包） */
    { path: 'web/assets/js/sgx/shell/share.js', kind: 'file', parts: ['share.js'] },
    /* 导航抽屉项 + 图标（baseof.html）、预设种子 + 引擎版本（ui-inherit-run.js） */
    { path: 'web/assets/sgx-shell/nav.json', kind: 'json', parts: ['nav.json'] },
    { path: 'web/assets/sgx-shell/palettes.json', kind: 'json', parts: ['palettes.json'] },
  ],
};
/* ---- /__SITE_CONFIG__ ---- */

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UPSTREAM = 'styrigx/styrigx-space';
const UP_DIR = 'web/shared/shell';
const LOCK = path.join(REPO, 'sgx-shell.lock.json');
export const BEGIN = '/* @sgx-shell:begin';
export const END = '/* @sgx-shell:end */';

const sha = (s) => createHash('sha256').update(s).digest('hex');

function args(argv) {
  const o = { ref: 'main', from: '', check: false, strict: false, refGiven: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') o.check = true;
    else if (a === '--strict') o.strict = true;
    else if (a === '--ref') { o.ref = argv[++i]; o.refGiven = true; }
    else if (a === '--from') o.from = argv[++i];
    else throw new Error('未知参数 ' + a);
  }
  return o;
}

/** @returns {Promise<{status:number, text:string}>} */
async function getUpstream(o, name) {
  if (o.from) {
    const p = path.resolve(o.from, UP_DIR, name);
    return existsSync(p) ? { status: 200, text: readFileSync(p, 'utf8') } : { status: 404, text: '' };
  }
  const url = `https://raw.githubusercontent.com/${UPSTREAM}/${encodeURIComponent(o.ref).replace(/%2F/g, '/')}/${UP_DIR}/${name}`;
  const r = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
  return { status: r.status, text: r.status === 200 ? await r.text() : '' };
}

/** 拉 manifest + 全部文件并校验；manifest 不存在返回 null */
export async function fetchBundle(o) {
  const m = await getUpstream(o, 'manifest.json');
  if (m.status === 404) return null;
  if (m.status !== 200) throw new Error(`拉取 manifest.json 失败：HTTP ${m.status}`);
  const manifest = JSON.parse(m.text);
  const files = { 'manifest.json': m.text };
  for (const [name, h] of Object.entries(manifest.files)) {
    const r = await getUpstream(o, name);
    if (r.status !== 200) throw new Error(`拉取 ${name} 失败：HTTP ${r.status}`);
    if (sha(r.text) !== h) throw new Error(`${name} 的 sha256 和 manifest 不一致（主站生成物过期？）`);
    files[name] = r.text;
  }
  return { manifest, files };
}

/** 标记段内容（不含首尾标记行） */
function blockBody(parts, files) {
  return parts.map((n) => `/* ---- ${n} ---- */\n` + files[n].replace(/\n$/, '')).join('\n');
}
function beginLine(label, manifest) {
  return `${BEGIN} ${UPSTREAM}@${label} ${UP_DIR} v${manifest.version}（scripts/sync-shell.mjs 写入，勿手改） */`;
}

/** 文件里标记段之间的内容（不含标记行）；没有标记返回 null */
export function readBlock(text) {
  const a = text.indexOf(BEGIN);
  const b = text.indexOf(END);
  if (a < 0 || b < a) return null;
  const s = text.indexOf('\n', a) + 1;
  return text.slice(s, b).replace(/\n$/, '');
}

function spliceBlock(text, block) {
  const a = text.indexOf(BEGIN);
  const b = text.indexOf(END);
  if (a < 0 || b < a) throw new Error('找不到 @sgx-shell:begin / end 标记');
  return text.slice(0, a) + block + text.slice(b + END.length);
}

/** 按 SITE 配置算出每个目标文件的新内容；返回 { 相对路径: 内容 } 和 { 相对路径: 校验内容 } */
export function renderTargets(bundle, label, current = (p) => (existsSync(path.join(REPO, p)) ? readFileSync(path.join(REPO, p), 'utf8') : '')) {
  const { manifest, files } = bundle;
  const out = {};
  const guard = {};
  for (const t of SITE.targets) {
    const body = t.kind === 'json' ? files[t.parts[0]] : blockBody(t.parts, files);
    if (t.kind === 'json') {
      out[t.path] = body;
      guard[t.path] = body;
      continue;
    }
    const block = beginLine(label, manifest) + '\n' + body + '\n' + END;
    if (t.kind === 'splice') out[t.path] = spliceBlock(current(t.path), block);
    else out[t.path] = (t.head || '') + block + '\n';
    guard[t.path] = body;
  }
  return { out, guard };
}

async function main() {
  const o = args(process.argv);
  if (o.check) {
    if (!existsSync(LOCK)) { console.error('缺少 sgx-shell.lock.json：先运行 node scripts/sync-shell.mjs'); process.exit(1); }
    const lock = JSON.parse(readFileSync(LOCK, 'utf8'));
    const bad = [];
    for (const t of SITE.targets) {
      const text = existsSync(path.join(REPO, t.path)) ? readFileSync(path.join(REPO, t.path), 'utf8') : '';
      const body = t.kind === 'json' ? text : readBlock(text);
      if (body === null || sha(body) !== lock.vendored[t.path]) bad.push(t.path);
    }
    if (bad.length) { console.error('共享外壳副本被手改或缺失：' + bad.join('、') + '；改主站后运行 node scripts/sync-shell.mjs'); process.exit(1); }
    /* ② 按 lock 锁定的提交核对（--ref / --from 显式给了就用给的） */
    const pinned = /^[0-9a-f]{40}$/.test(String(lock.ref)) ? lock.ref : '';
    const ref = o.refGiven || o.from ? o.ref : pinned;
    if (!ref) {
      console.error(`sgx-shell.lock.json 的 ref（${lock.ref}）不是主站的完整提交 SHA：运行 node scripts/sync-shell.mjs 重新同步（会锁定到主站当时的提交）`);
      process.exit(1);
    }
    let up;
    try { up = await fetchBundle({ ...o, ref }); } catch (e) {
      console.error(`读取主站外壳失败（${ref}）：${e.message}`); process.exit(o.strict ? 1 : 0);
    }
    if (!up) {
      const msg = `主站 ${UPSTREAM}@${ref} 上还没有 ${UP_DIR}（外壳尚未合并）；保留本地副本 v${lock.version}（来自 ${lock.ref}）`;
      if (o.strict) { console.error(msg); process.exit(1); }
      console.log('::notice::' + msg);
      return;
    }
    const sameFiles = JSON.stringify(Object.entries(up.manifest.files).sort()) === JSON.stringify(Object.entries(lock.files || {}).sort());
    if (up.manifest.version !== lock.version || !sameFiles) {
      console.error(`sgx-shell.lock.json 和主站 ${ref} 上的外壳对不上：lock 记的是 v${lock.version}，主站这个提交上是 v${up.manifest.version}；运行 node scripts/sync-shell.mjs 重新同步`);
      process.exit(1);
    }
    console.log(`shared shell matches the pinned main-site commit: v${lock.version} (${ref})`);
    /* ③ 只提示：主站 main 上的外壳更新了（升级要显式同步，不让无关 PR 变红） */
    if (!o.refGiven && !o.from) {
      try {
        const m = await getUpstream({ ...o, ref: 'main' }, 'manifest.json');
        const latest = m.status === 200 ? JSON.parse(m.text).version : '';
        if (latest && latest !== lock.version) console.log(`::notice::主站 main 上的共享外壳是 v${latest}（本仓库锁定 v${lock.version}）；要升级就运行 node scripts/sync-shell.mjs 并提交`);
      } catch { /* 只是提示，拉不到就算了 */ }
    }
    return;
  }
  /* 从 GitHub 拉时先把 ref 解析成完整提交 SHA：lock 锁定到这个提交，--check 只和它比 */
  let label = o.ref;
  if (o.from) label = `${o.ref}（本地 ${path.basename(path.resolve(o.from))}）`;
  else if (!/^[0-9a-f]{40}$/.test(o.ref)) {
    const r = await fetch(`https://api.github.com/repos/${UPSTREAM}/commits/${encodeURIComponent(o.ref)}`, { headers: { accept: 'application/vnd.github.sha' } });
    const s = (await r.text()).trim();
    if (r.status !== 200 || !/^[0-9a-f]{40}$/.test(s)) throw new Error(`解析主站 ${o.ref} 的提交 SHA 失败：HTTP ${r.status}`);
    label = s;
  }
  if (!o.from) o.ref = label;
  const bundle = await fetchBundle(o);
  if (!bundle) { console.error(`主站 ${UPSTREAM}@${o.ref} 上没有 ${UP_DIR}`); process.exit(1); }
  const { out, guard } = renderTargets(bundle, label);
  for (const [p, text] of Object.entries(out)) {
    mkdirSync(path.dirname(path.join(REPO, p)), { recursive: true });
    writeFileSync(path.join(REPO, p), text);
  }
  const lock = {
    _note: 'scripts/sync-shell.mjs 写入，勿手改：记录本仓库的共享外壳副本来自主站哪个版本',
    source: UPSTREAM,
    dir: UP_DIR,
    ref: label,
    version: bundle.manifest.version,
    files: bundle.manifest.files,
    vendored: Object.fromEntries(Object.entries(guard).map(([p, b]) => [p, sha(b)])),
  };
  writeFileSync(LOCK, JSON.stringify(lock, null, 2) + '\n');
  console.log(`shared shell v${bundle.manifest.version} ← ${UPSTREAM}@${label}：` + Object.keys(out).join(', '));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((e) => { console.error(e.message || e); process.exit(1); });
