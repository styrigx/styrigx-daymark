// 生成 web/assets/css/input.css 里「accent start … accent end」之间的强调色规则（同博客 scripts/gen-accent-css.mjs）：
// sgx-ui cookie 的 accent=<色板 id> 时，只把强调色（--sgx-accent / --sgx-on-accent）换成那个色板的 primary / on-primary
// （浅色、深色各一组），其余 token 仍跟 pal。色值取自同一个 input.css 里的 :root / .dark（lake）和 [data-palette] 块。
// 改了色板后重跑：node scripts/gen-accent-css.mjs   （tests/web/accent.test.mjs 校验生成结果与色板一致）
import { readFileSync, writeFileSync } from 'node:fs';

export const CSS_PATH = new URL('../web/assets/css/input.css', import.meta.url);
const BEGIN = /\/\* accent start[^\n]*\*\/\n/;
const END = '/* accent end */';

export function extractAccents(css) {
  const grab = (block) => ({
    a: block.match(/--m-primary:\s*([^;]+);/)[1].trim(),
    on: block.match(/--m-on-primary:\s*([^;]+);/)[1].trim(),
  });
  /** @type {Record<string, {light?: any, dark?: any}>} */
  const out = {};
  /* lake = 第一个带 --m-primary 的 :root 块和 .dark 块 */
  const first = (re) => [...css.matchAll(re)].map((m) => m[1]).find((b) => /--m-primary:/.test(b));
  out.lake = { light: grab(first(/^:root \{([\s\S]*?)\n\}/gm)), dark: grab(first(/^\.dark \{([\s\S]*?)\n\}/gm)) };
  for (const m of css.matchAll(/^\[data-palette="([a-z]+)"\] \{([\s\S]*?)\n\}/gm)) out[m[1]] = { ...(out[m[1]] || {}), light: grab(m[2]) };
  for (const m of css.matchAll(/^\.dark\[data-palette="([a-z]+)"\] \{([\s\S]*?)\n\}/gm)) out[m[1]] = { ...(out[m[1]] || {}), dark: grab(m[2]) };
  return out;
}

export function renderAccentCss(acc) {
  let css = ':root { --sgx-accent: var(--m-primary); --sgx-on-accent: var(--m-on-primary); }\n';
  for (const [id, v] of Object.entries(acc)) {
    if (!v.light || !v.dark) continue;
    css += `:root[data-accent="${id}"] { --sgx-accent: ${v.light.a}; --sgx-on-accent: ${v.light.on}; }\n`;
    css += `:root.dark[data-accent="${id}"] { --sgx-accent: ${v.dark.a}; --sgx-on-accent: ${v.dark.on}; }\n`;
  }
  return css;
}

/** 把生成结果放进 input.css 的标记之间，返回新文件内容 */
export function inject(css) {
  const m = css.match(BEGIN);
  const i = m.index + m[0].length;
  const j = css.indexOf(END, i);
  return css.slice(0, i) + renderAccentCss(extractAccents(css)) + css.slice(j);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  writeFileSync(CSS_PATH, inject(readFileSync(CSS_PATH, 'utf8')));
  console.log('wrote accent block in web/assets/css/input.css');
}
