/* @sgx-shell:begin styrigx/styrigx-space@main web/shared/shell v1fba3fc24d1f（scripts/sync-shell.mjs 写入，勿手改） */
/* ---- palette-scheme.js ---- */
/**
 * @fileoverview 主题色引擎（PR3 色彩角色 token 的运行时一半）：自定义 #rrggbb 种子 → 整套亮 / 暗色彩角色。
 * 移植自色板设计稿的 scheme.js（OKLCH 色阶、角色构建、对比度审计 + 自动修正、自定义种子派生）；预设 2026-10-23 PR-G 起是七色调色板 22 套
 * （1 背景色 + 6 前景撞色，定稿 palette-v0.3，见下面 THEMES），规格由 themeSpec() 从背景 / 前景算出，不再手写：
 * 22 个预设用同一条管线算出来的结果就是 web/data/palette-roles.json（scripts/gen-palettes.mjs 把它生成进 input.css）；
 * 单测 tests/web/ui/palette-scheme.test.mjs 逐项核对本文件重算出的预设 / 校验种子与 JSON 一致。
 * 不依赖 DOM：rolesFor(seed) 返回 { light, dark } 角色表，rolesCss(seed) 返回可以直接塞进 <style> 的 CSS 文本。
 */
// @ts-nocheck

/* ---------- engine (scheme.js) ---------- */

/* ---------- colour math (OKLab / OKLCH, sRGB, WCAG) ---------- */
const s2l = c => (c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const l2s = c => c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
const hexRgb = h => { h = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
const rgbHex = r => '#' + r.map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
function linToOklab([r, g, b]) {
  let l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  let m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  let s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  [l, m, s] = [l, m, s].map(Math.cbrt);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}
function oklabToLin([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
}
function hexToOklch(h) {
  const [L, a, b] = linToOklab(hexRgb(h).map(s2l));
  const C = Math.hypot(a, b);
  return { l: L, c: C, h: C < 1e-4 ? 0 : ((Math.atan2(b, a) * 180 / Math.PI) + 360) % 360 };
}
const inGamut = rgb => rgb.every(x => x >= -1e-4 && x <= 1 + 1e-4);
// OKLCH -> hex, gamut-mapped by chroma reduction at constant L and H.
function oklch(L, C, H) {
  L = Math.max(0, Math.min(1, L)); C = Math.max(0, C);
  const lab = c => oklabToLin([L, c * Math.cos(H * Math.PI / 180), c * Math.sin(H * Math.PI / 180)]);
  if (!inGamut(lab(C))) { let lo = 0, hi = C; for (let i = 0; i < 28; i++) { const m = (lo + hi) / 2; inGamut(lab(m)) ? lo = m : hi = m; } C = lo; }
  return rgbHex(lab(C).map(x => l2s(Math.max(0, Math.min(1, x))) * 255));
}
const lum = h => { const [r, g, b] = hexRgb(h).map(s2l); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const rgba = (hex, a) => { const [r, g, b] = hexRgb(hex); return `rgba(${r},${g},${b},${+a.toFixed(3)})`; };
const parseRgba = s => { const m = s.match(/rgba\((\d+),(\d+),(\d+),([\d.]+)\)/); return [+m[1], +m[2], +m[3], +m[4]]; };
// composite any colour string (hex or rgba) over an opaque hex
function over(fg, bgHex) {
  if (fg.startsWith('#')) return fg;
  const [r, g, b, a] = parseRgba(fg), B = hexRgb(bgHex);
  return rgbHex([r, g, b].map((v, i) => v * a + B[i] * (1 - a)));
}
const hueDist = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
const wrap = h => ((h % 360) + 360) % 360;

/* ---------- tone ladders (OKLCH L targets) ---------- */
// Light / dark lightness for every tonal role. Chroma comes from the preset spec.
const T = {
  light: {
    primary: null /* = seed */, onPrimary: 0.99, pc: 0.915, onPc: 0.30,
    secondary: 0.50, onSecondary: 0.99, sc: 0.925, onSc: 0.29,
    tertiary: 0.50, onTertiary: 0.99, tc: 0.92, onTc: 0.29,
    danger: 0.53, onDanger: 0.99, dc: 0.925, onDc: 0.31,
    // neutral stack
    dim: 0.905, bg: 0.968, surface: 0.978, bright: 0.992,
    // 容器阶梯（2026-10-21 搭配微调）：container / high / highest 各压深一点、装饰边线 outlineVar 0.858 → 0.842，
    // 块与底、chip 与块、边线与卡片之间拉开到约 ΔL 0.04–0.06（旧值 0.944 / 0.927 / 0.908 时多处只差 0.017，糊在一起）
    lowest: 0.997, low: 0.962, container: 0.940, high: 0.921, highest: 0.902,
    text1: 0.215, text2: 0.405, text3: 0.515,
    outline: 0.575, outlineVar: 0.842,
    blob: 0.915, gradA: 0.958, gradB: 0.972, link: 0.455, linkVisited: 0.45,
  },
  dark: {
    primary: 0.80, onPrimary: 0.285, pc: 0.37, onPc: 0.925,
    secondary: 0.80, onSecondary: 0.285, sc: 0.345, onSc: 0.915,
    tertiary: 0.80, onTertiary: 0.285, tc: 0.36, onTc: 0.92,
    danger: 0.78, onDanger: 0.29, dc: 0.385, onDc: 0.925,
    // 暗色容器阶梯（2026-10-21）：每升一层多亮一点（container 0.240 → 0.248，high 0.265 → 0.277，highest 0.293 → 0.306，bright 0.31 → 0.325），
    // 块对页面、磁贴对面板约 ΔL 0.06–0.08；装饰边线 0.365 → 0.38
    dim: 0.148, bg: 0.165, surface: 0.185, bright: 0.325,
    lowest: 0.200, low: 0.222, container: 0.248, high: 0.277, highest: 0.306,
    text1: 0.935, text2: 0.795, text3: 0.685,
    outline: 0.62, outlineVar: 0.38,
    blob: 0.30, gradA: 0.19, gradB: 0.165, link: 0.82, linkVisited: 0.80,
  },
};

/* ---------- display tones (2026-10-21 polish) ---------- */
// 色相的「本色」：撞色色块的色带和不带字的填充（屏幕时间分段、存储条、图例圆点）用。辅色 / 第三色的文字色
// （亮色 L 0.50、按 4.5:1 压深）放到色块上发泥——橘子变铁锈褐、嫩叶变橄榄。这里取 OKLCH L ≈ 0.68 的中间调，
// 黄色族（h ≈ 92 附近）本身更亮才认得出，按色相距离最多抬到 0.79；彩度 = 本套规格 × 1.15（中间调略提一点，免得发灰）。
// 亮暗一样（色块在两种模式下读作同一组颜色）。
const TONE = { L: 0.68, yellowLift: 0.11, yellowHue: 92, yellowSpan: 45, chroma: 1.15 };
function displayTone(F) {
  const y = Math.max(0, 1 - hueDist(F.h, TONE.yellowHue) / TONE.yellowSpan);
  return oklch(TONE.L + TONE.yellowLift * y, F.c * TONE.chroma, F.h);
}

/* ---------- button fills（2026-10-23 PR-G 修订：填充 vs ink 分工）---------- */
// 填充（按钮 / 开着的开关 / 进度 / 选中的分段）= 前景 1 本色（浅色 = 色池原值，深色 = fgTones 深色 base），不压深；
// 上面的字自动挑：同色相的近黑深墨（L 0.24）vs 白，取对比度高的那个，要求 ≥ 4.5:1。都不够时（中间调，如电光蓝）
// 再试更深的墨（L 0.16 / 0.10）和纯白，取对比度最高的；还不够才把填充本身往反方向挪（色相、彩度不变），所以任何种子都能过。文字 / 链接 / 图标 / 焦点环照旧用压深的 primary（ink）。
const FILL_INK = { L: 0.24, c: 0.35, cMax: 0.05 };
function fillPair(fill) {
  const o = hexToOklch(fill);
  const ink = oklch(FILL_INK.L, Math.min(o.c * FILL_INK.c, FILL_INK.cMax), o.h), white = oklch(0.99, 0.006, o.h);
  let on = contrast(ink, fill) >= contrast(white, fill) ? ink : white;
  if (contrast(on, fill) < 4.5) { // 中间调（电光蓝）：换更深的墨 / 纯白，取对比度最高的
    for (const c of [oklch(0.16, Math.min(o.c * 0.3, 0.03), o.h), '#ffffff', oklch(0.1, Math.min(o.c * 0.2, 0.02), o.h)]) if (contrast(c, fill) > contrast(on, fill)) on = c;
  }
  const dark = hexToOklch(on).l < 0.5;
  let L = o.l, f = fill;
  for (let i = 0; i < 100 && contrast(on, f) < 4.5; i++) { L += dark ? 0.005 : -0.005; f = oklch(L, o.c, o.h); }
  return { fill: f, on };
}
// 固定语义状态色：和 danger 一样不随主题变（亮 / 暗各一套，审计核对）。success = 状态页正常、设置安全状态「已开启」；
// warning（琥珀）/ info（蓝）先只出 token，组件按需接（2026-10-23 PR-G 修订）
const STATUS = {
  success: { h: 150, light: { s: [0.50, 0.13], on: [0.99, 0.006], sc: [0.93, 0.05], onSc: [0.32, 0.10] },
    dark: { s: [0.80, 0.13], on: [0.29, 0.07], sc: [0.37, 0.07], onSc: [0.93, 0.045] } },
  warning: { h: 65, light: { s: [0.48, 0.11], on: [0.99, 0.006], sc: [0.93, 0.06], onSc: [0.34, 0.09] },
    dark: { s: [0.82, 0.13], on: [0.30, 0.07], sc: [0.38, 0.07], onSc: [0.93, 0.05] } },
  info: { h: 250, light: { s: [0.50, 0.13], on: [0.99, 0.006], sc: [0.93, 0.04], onSc: [0.32, 0.10] },
    dark: { s: [0.80, 0.11], on: [0.29, 0.07], sc: [0.37, 0.07], onSc: [0.93, 0.04] } },
};

/* ---------- scheme builder ---------- */
// spec: { seed, p:{h,c,hd?,cd?}, pc:{h?,c?}, s:{h,c}, t:{h,c}, n:{h,c}, d:{h,c}, blobs:[{h,c}x3],
//         accent:'primary'|'tertiary', state:{light:{...},dark:{...}}, tune:{light:{role:L}, dark:{...}} }
function build(spec, mode) {
  const t = { ...T[mode], ...((spec.tune || {})[mode] || {}) };
  const D = mode === 'dark';
  const P = spec.p, S = spec.s, Te = spec.t, N = spec.n, Dg = spec.d;
  const pH = D && P.hd != null ? P.hd : P.h;
  const pcH = spec.pc && spec.pc.h != null ? spec.pc.h : P.h;
  const pcC = spec.pc && spec.pc.c != null ? spec.pc.c : Math.min(P.c * 0.45, 0.075);
  const r = {};
  r['primary'] = D ? oklch(t.primary, P.cd != null ? P.cd : Math.min(P.c * 0.75, 0.13), pH) : spec.seedPrimary;
  r['on-primary'] = oklch(t.onPrimary, D ? Math.min(P.c * 0.6, 0.1) : 0.006, pH);
  r['primary-container'] = oklch(t.pc, D ? Math.min(P.c * 0.62, 0.11) : pcC, D ? pH : pcH);
  r['on-primary-container'] = oklch(t.onPc, D ? Math.min(pcC * 0.7, 0.05) : Math.min(P.c * 0.8, 0.12), D ? pH : pcH);
  r['secondary'] = oklch(t.secondary, D ? S.c * 0.85 : S.c, S.h);
  r['on-secondary'] = oklch(t.onSecondary, D ? S.c * 0.6 : 0.005, S.h);
  r['secondary-container'] = oklch(t.sc, D ? S.c * 0.75 : S.c * 0.7, S.h);
  r['on-secondary-container'] = oklch(t.onSc, D ? S.c * 0.45 : S.c * 1.05, S.h);
  r['tertiary'] = oklch(t.tertiary, D ? Te.c * 0.85 : Te.c, Te.h);
  r['on-tertiary'] = oklch(t.onTertiary, D ? Te.c * 0.6 : 0.005, Te.h);
  r['tertiary-container'] = oklch(t.tc, D ? Te.c * 0.7 : Te.c * 0.6, Te.h);
  r['on-tertiary-container'] = oklch(t.onTc, D ? Te.c * 0.4 : Te.c * 0.95, Te.h);
  // 不带字的填充（2026-10-21 polish）：亮色 = 本色中间调（审计只要求在卡片上 ≥ 3:1，控件 / 图形级，不压到文字的 4.5:1）；
  // 暗色 = 暗色辅 / 第三色本身（L 0.80 的浅色调本来就干净，applyAliases 里指过去）
  if (!D) { r['secondary-fill'] = displayTone(S); r['tertiary-fill'] = displayTone(Te); }
  // 填充档（按钮 / 开关 / 进度 / 选中分段）：前景 1 本色 + 自动挑的 on 色（见 fillPair）
  { const fp = fillPair(D ? fgTones(spec.seed, 'dark').base : spec.seed); r['primary-fill'] = fp.fill; r['on-primary-fill'] = fp.on; }
  for (const [k, F] of Object.entries(STATUS)) { const S7 = F[mode];
    r[k] = oklch(S7.s[0], S7.s[1], F.h); r['on-' + k] = oklch(S7.on[0], S7.on[1], F.h);
    r[k + '-container'] = oklch(S7.sc[0], S7.sc[1], F.h); r['on-' + k + '-container'] = oklch(S7.onSc[0], S7.onSc[1], F.h); }
  r['danger'] = oklch(t.danger, D ? 0.115 : Dg.c, Dg.h);
  r['on-danger'] = oklch(t.onDanger, D ? 0.09 : 0.006, Dg.h);
  r['danger-container'] = oklch(t.dc, D ? 0.09 : 0.045, Dg.h);
  r['on-danger-container'] = oklch(t.onDc, D ? 0.04 : 0.12, Dg.h);
  // neutrals — tinted by the scheme's neutral hue
  const nc = k => N.c * k;
  r['background'] = oklch(t.bg, nc(D ? 1.2 : 1), N.h);
  r['surface-dim'] = oklch(t.dim, nc(D ? 1.1 : 1.3), N.h);
  r['surface'] = oklch(t.surface, nc(D ? 1.2 : 0.9), N.h);
  r['surface-bright'] = oklch(t.bright, nc(D ? 1.3 : 0.5), N.h);
  r['surface-container-lowest'] = oklch(t.lowest, nc(D ? 1.1 : 0.3), N.h);
  r['surface-container-low'] = oklch(t.low, nc(D ? 1.3 : 1.1), N.h);
  r['surface-container'] = oklch(t.container, nc(D ? 1.4 : 1.25), N.h);
  r['surface-container-high'] = oklch(t.high, nc(D ? 1.5 : 1.4), N.h);
  r['surface-container-highest'] = oklch(t.highest, nc(D ? 1.6 : 1.55), N.h);
  r['text-primary'] = oklch(t.text1, nc(D ? 1.2 : 2.4), N.h);
  r['text-secondary'] = oklch(t.text2, nc(D ? 2.0 : 2.8), N.h);
  r['text-tertiary'] = oklch(t.text3, nc(D ? 2.2 : 2.8), N.h);
  r['text-disabled'] = rgba(r['text-primary'], 0.38);
  r['disabled-container'] = rgba(r['text-primary'], 0.12);
  r['outline'] = oklch(t.outline, nc(D ? 2.2 : 3.0), N.h);
  r['outline-variant'] = oklch(t.outlineVar, nc(D ? 2.0 : 2.2), N.h);
  r['divider'] = rgba(r['text-primary'], D ? 0.12 : 0.10);
  // elevation aliases (what each layer of the site sits on)
  r['card'] = r['surface-container-lowest'];
  r['card-nested'] = r['surface-container-low'];
  r['card-nested-2'] = r['surface-container'];
  r['sheet'] = r['surface-container-low'];
  r['dialog'] = r['surface-container-high'];
  r['drawer'] = r['surface-container-low'];
  r['menu'] = r['surface-container'];
  r['input-fill'] = r['surface-container-highest'];
  r['topbar-glass'] = rgba(r['surface-bright'], D ? 0.68 : 0.72);
  r['glass-tint'] = rgba(D ? r['surface-container'] : r['surface-container-lowest'], D ? 0.72 : 0.72);
  r['glass-edge'] = D ? rgba(oklch(0.97, nc(1), N.h), 0.08) : rgba(r['text-primary'], 0.06);
  r['scrim'] = rgba(oklch(D ? 0.08 : 0.16, nc(D ? 1 : 2), N.h), D ? 0.6 : 0.32);
  r['inverse-surface'] = oklch(D ? 0.91 : 0.28, nc(1.5), N.h);
  r['inverse-on-surface'] = oklch(D ? 0.28 : 0.955, nc(1), N.h);
  r['inverse-primary'] = D ? spec.seedPrimary : oklch(0.80, Math.min(P.c * 0.75, 0.13), pH);
  // background: gradient + 3 accent blobs
  const B = spec.blobs;
  r['bg-blob-1'] = oklch(t.blob, B[0].c * (D ? 0.8 : 1), B[0].h);
  r['bg-blob-2'] = oklch(t.blob + (D ? -0.01 : 0.01), B[1].c * (D ? 0.8 : 1), B[1].h);
  r['bg-blob-3'] = oklch(t.blob + (D ? -0.02 : 0.015), B[2].c * (D ? 0.7 : 0.9), B[2].h);
  r['bg-gradient'] = [oklch(t.gradA, B[0].c * 0.25, B[0].h), r['background'], oklch(t.gradA + (D ? -0.01 : 0.004), B[2].c * 0.22, B[2].h)];
  { const accent = spec.accent === 'tertiary' ? 'tertiary' : 'primary';
  const aH = accent === 'tertiary' ? Te.h : pH, aC = accent === 'tertiary' ? Te.c : P.c;
  r['link'] = oklch(t.link, D ? Math.min(aC * 0.8, 0.13) : Math.max(aC, 0.02), aH);
  r['link-visited'] = oklch(t.linkVisited, D ? Math.min(Te.c * 0.8, 0.12) : Te.c, wrap((accent === 'tertiary' ? P.h : Te.h)));
  }
  // 首页夜间时钟卡（特殊功能卡，2026-10-23 PR-G 修订）：不再是整块饱和深色（芥末主色压深后整块发棕），改成克制的局部撞色——
  // spec.night 指定色族（默认 t = 第三色）的浅底（亮 L 0.905 / 暗 L 0.30，低彩度），CSS 里按材质的 88% 不透明铺；
  // 字 = 同色相深墨 / 浅色（on-night-card ≥ 7:1，单测核对）
  { const nk = spec.night || 't', F = nk === 'p' ? { h: pH, c: P.c } : nk === 't' ? Te : S;
    r['night-card'] = oklch(D ? 0.30 : 0.905, Math.min(F.c * (D ? 0.45 : 0.35), D ? 0.05 : 0.045), F.h);
    r['on-night-card'] = oklch(D ? 0.93 : 0.27, Math.min(F.c * 0.5, 0.07), F.h); }
  Object.defineProperty(r, '__dark', { value: D, enumerable: false });
  applyAliases(r, spec);
  return r;
}

// 导航抽屉当前项药丸的亮度（OKLCH L）：bg = 药丸，fg = 药丸上的文字 / 图标
// 2026-10-23 PR-G：材质（--sgx-mat）不再混主色，暗色面板更深，药丸 0.365 → 0.34，对面板仍约 1.5–1.65:1（不刺眼）
const NAV_SEL = { light: { bg: 0.83, fg: 0.29 }, dark: { bg: 0.34, fg: 0.93 } };
function applyAliases(r, spec) {
  // interactive roles
  const D = r.__dark;
  const accent = spec.accent === 'tertiary' ? 'tertiary' : 'primary';
  r['focus-ring'] = r[accent];
  // 开关开着 = 填充档（primary-fill / on-primary-fill）；第三色强调（accent = tertiary）照旧用 tertiary
  const fillK = accent === 'primary' ? 'primary-fill' : accent;
  r['switch-track-on'] = r[fillK];
  r['switch-thumb-on'] = r['on-' + fillK];
  r['switch-track-off'] = r['surface-container-highest'];
  r['switch-thumb-off'] = r['outline'];
  // 滑块 / 进度：默认 = 强调色（单色组）；撞色组 spec.slider = 'secondary'（One UI 快捷面板：磁贴主色、滑块另一个色相），石墨×湖蓝 = tertiary
  // 2026-10-23 PR-G 修订：已填的那段 = 填充档（primary-fill），滑块圆点 = ink（primary，表面上 ≥ 4.5:1，浅填充时状态靠圆点认）
  const sl = spec.slider || accent;
  r['slider-active'] = r[sl === 'primary' ? 'primary-fill' : sl];
  r['slider-inactive'] = r[sl + '-container'];
  r['slider-thumb'] = r[sl];
  if (D) { r['secondary-fill'] = r['secondary']; r['tertiary-fill'] = r['tertiary']; }
  r['chip-selected'] = r['secondary-container'];
  r['on-chip-selected'] = r['on-secondary-container'];
  // 导航抽屉当前项（2026-10-21 搭配微调）：抽屉面板是顶栏材质（主色 10% 混 surface 的毛玻璃，亮色约 L 0.90、暗色约 L 0.25），
  // secondary-container（亮 L 0.925 / 暗 L 0.345、近中性）贴在上面几乎看不出来。改成强调色色相的中等彩度 tonal 药丸，
  // 亮度单独一档（NAV_SEL），对面板约 1.3:1（亮）/ 1.5:1（暗）：清楚但不刺眼；文字用同色相的深 / 浅色（≥ 7:1）。
  { const P = spec.p, Te = spec.t, tert = accent === 'tertiary';
    const pH = D && P.hd != null ? P.hd : P.h;
    const pcH = !D && spec.pc && spec.pc.h != null ? spec.pc.h : pH;
    const h = tert ? Te.h : pcH;
    const c = Math.min(tert ? Te.c * 0.24 : P.c * 0.42, D ? 0.055 : 0.06);
    r['nav-selected'] = oklch(NAV_SEL[D ? 'dark' : 'light'].bg, c, h);
    r['on-nav-selected'] = oklch(NAV_SEL[D ? 'dark' : 'light'].fg, Math.min(c * (D ? 0.5 : 1.4), 0.08), h);
  }
  r['fab'] = r['primary-container'];
  r['on-fab'] = r['on-primary-container'];
  r['badge'] = r['danger'];
  r['on-badge'] = r['on-danger'];
  r['badge-info'] = r['tertiary'];
  r['on-badge-info'] = r['on-tertiary'];
  r['lock-clock'] = r['text-primary'];
  r['lock-meta'] = r['text-secondary'];
  r['lock-quote'] = r['on-tertiary-container'];
  r['lock-quote-bg'] = rgba(r['tertiary-container'], D ? 0.55 : 0.6);
  r['lock-unlock'] = r['primary-fill'];
  r['on-lock-unlock'] = r['on-primary-fill'];
  r['daymark-card'] = r['surface-container-lowest'];
  r['daymark-mark'] = rgba(r['tertiary'], D ? 0.14 : 0.10);
  r['daymark-label'] = r['tertiary'];
  r['daymark-text'] = r['text-primary'];
  r['daymark-trans'] = r['text-secondary'];
}

const STATE_DEFAULT = {
  light: { color: 'on-surface', hover: 0.08, focus: 0.10, pressed: 0.12, selected: 0.10, dragged: 0.16 },
  dark: { color: 'on-surface', hover: 0.08, focus: 0.12, pressed: 0.14, selected: 0.12, dragged: 0.18 },
};

/* ---------- contrast audit + auto-fix ---------- */
// [fg, bg, min, kind]; fg may be adjusted (never the light seed primary).
const SURF = ['background', 'surface', 'surface-dim', 'surface-bright', 'surface-container-lowest', 'surface-container-low', 'surface-container', 'surface-container-high', 'surface-container-highest'];
function checks() {
  const c = [];
  for (const k of ['primary', 'secondary', 'tertiary', 'danger', 'success', 'warning', 'info']) {
    c.push(['on-' + k, k, 4.5, 'text']);
    c.push(['on-' + k + '-container', k + '-container', 4.5, 'text']);
  }
  for (const s of SURF) {
    c.push(['text-primary', s, 4.5, 'text']);
    c.push(['text-secondary', s, 4.5, 'text']);
  }
  for (const s of ['background', 'surface', 'surface-container-lowest', 'surface-container-low', 'surface-container', 'surface-container-high'])
    c.push(['text-tertiary', s, 4.5, 'text']);
  for (const s of ['background', 'surface', 'surface-container-lowest', 'surface-container-low', 'surface-container', 'surface-container-high']) {
    c.push(['link', s, 4.5, 'text']);
    c.push(['primary', s, 4.5, 'text']); // primary used for titles / text buttons
    c.push(['danger', s, 4.5, 'text']);
    c.push(['success', s, 4.5, 'text']);
    c.push(['warning', s, 4.5, 'text']);
    c.push(['info', s, 4.5, 'text']);
  }
  // 填充档上的字（主按钮 / 选中分段 / 开着的磁贴图标圆）
  c.push(['on-primary-fill', 'primary-fill', 4.5, 'text']);
  for (const s of ['surface', 'surface-container-lowest', 'surface-container', 'surface-container-high']) {
    c.push(['outline', s, 3, 'ui']);
    c.push(['focus-ring', s, 3, 'ui']);
    // 开关 / 滑块的「开着」在表面上 ≥ 3:1（WCAG 1.4.11）：填充档是本色、浅色（芥末）本身不到 3:1 时，
    // 由圆点（on-primary-fill 深墨 / 滑块 ink）承担，所以量「轨道和圆点里对比度高的那个」
    c.push(['@switch-on', s, 3, 'ui']);
    c.push(['@slider-on', s, 3, 'ui']);
  }
  // 不带字的填充（屏幕时间分段 / 存储条 / 图例圆点）：在卡片上 ≥ 3:1（图形级）
  c.push(['secondary-fill', 'surface-container-lowest', 3, 'ui']);
  c.push(['tertiary-fill', 'surface-container-lowest', 3, 'ui']);
  c.push(['switch-thumb-on', 'switch-track-on', 3, 'ui']);
  c.push(['switch-thumb-off', 'switch-track-off', 3, 'ui']);
  c.push(['slider-thumb', 'slider-inactive', 3, 'ui']);
  c.push(['on-night-card', 'night-card', 7, 'text']);
  c.push(['on-chip-selected', 'chip-selected', 4.5, 'text']);
  c.push(['on-nav-selected', 'nav-selected', 4.5, 'text']);
  c.push(['on-fab', 'fab', 4.5, 'text']);
  c.push(['daymark-label', 'daymark-card', 4.5, 'text']);
  c.push(['lock-quote', '@lock-quote-on-bg', 4.5, 'text']);
  c.push(['text-primary', '@topbar-on-blob', 4.5, 'text']);
  c.push(['text-primary', '@topbar-on-bg', 4.5, 'text']);
  return c;
}
// 合成前景：同一个控件的两部分，取对表面对比度高的那个
function resolveFg(r, key, bg) {
  const pick = (a, b) => (contrast(r[a], bg) >= contrast(r[b], bg) ? r[a] : r[b]);
  if (key === '@switch-on') return pick('switch-track-on', 'switch-thumb-on');
  if (key === '@slider-on') return pick('slider-active', 'slider-thumb');
  return r[key];
}
function resolveBg(r, key) {
  if (key === '@topbar-on-blob') return over(r['topbar-glass'], r['bg-blob-1']);
  if (key === '@topbar-on-bg') return over(r['topbar-glass'], r['background']);
  if (key === '@lock-quote-on-bg') return over(r['lock-quote-bg'], r['bg-blob-2']);
  return over(r[key], r['background']);
}
function audit(r, spec, mode, fix = true) {
  const fixes = [];
  const accent = spec.accent === 'tertiary' ? 'tertiary' : 'primary';
  const sl = spec.slider || accent;
  const fillK = accent === 'primary' ? 'primary-fill' : accent;
  const SRC = { 'focus-ring': accent, 'switch-track-on': fillK, 'slider-active': sl === 'primary' ? 'primary-fill' : sl, 'slider-thumb': sl,
    'switch-thumb-on': 'on-' + fillK, 'lock-unlock': 'primary-fill', 'on-lock-unlock': 'on-primary-fill', 'switch-thumb-off': 'outline', 'slider-inactive': sl + '-container',
    'daymark-label': 'tertiary', 'lock-quote': 'on-tertiary-container', 'on-chip-selected': 'on-secondary-container',
    'chip-selected': 'secondary-container', 'on-fab': 'on-primary-container', 'fab': 'primary-container',
    'lock-clock': 'text-primary', 'daymark-text': 'text-primary', 'lock-meta': 'text-secondary' };
  const sourceOf = k => SRC[k] || k;
  for (let pass = 0; pass < 6 && fix; pass++) {
    let changed = false;
    for (const [fgK, bgK, min] of checks()) {
      const bg = resolveBg(r, bgK);
      if (contrast(resolveFg(r, fgK, bg), bg) >= min - 1e-9) continue;
      if (fgK.startsWith('@')) continue;
      // which side to move: normally the foreground; the light seed primary is locked.
      let target = sourceOf(fgK), against = bg, moveFg = true;
      if (fgK === 'slider-thumb' && bgK === 'slider-inactive') { target = sourceOf('slider-inactive'); against = r['slider-thumb']; moveFg = false; }
      if (target === 'primary' && mode === 'light') { target = null; }
      if (target === 'primary-fill') { target = null; } // 填充档 = 前景本色，锁定（fillPair 已保证上面的字够）
      if (fgK === 'on-primary' && false) target = null;
      if (!target || !r[target] || !r[target].startsWith('#')) continue;
      const o = hexToOklch(r[target]); const refL = hexToOklch(against).l;
      const dir = o.l < refL ? -1 : 1;
      let L = o.l, out = r[target];
      for (let i = 0; i < 100 && contrast(out, against) < min; i++) { L += dir * 0.005; out = oklch(L, o.c, o.h); }
      if (out !== r[target]) { fixes.push({ role: target, from: r[target], to: out, reason: `${fgK} on ${bgK} < ${min}:1` }); r[target] = out; applyAliases(r, spec); changed = true; }
    }
    if (!changed) break;
  }
  const rows = checks().map(([fgK, bgK, min, kind]) => { const b = resolveBg(r, bgK), v = contrast(resolveFg(r, fgK, b), b); return { fg: fgK, bg: bgK, min, kind, ratio: +v.toFixed(2), pass: v >= min - 1e-9 }; });
  rows.push({ fg: 'text-disabled', bg: 'surface', min: 0, kind: 'info (WCAG-exempt)', ratio: +contrast(over(r['text-disabled'], r['surface']), r['surface']).toFixed(2), pass: true });
  return { fixes, rows };
}

/* ---------- custom seed derivation ---------- */
// Strategy: find the hand-tuned preset nearest to the seed in OKLCH (hue weighted by chroma), copy its
// *relationships* (hue offsets / chroma ratios of secondary, tertiary, neutral, blobs, danger), re-anchor
// them on the seed, then run the same tone ladders + contrast fixer used by the presets.
function nearestPreset(seed, presets) {
  const s = hexToOklch(seed);
  let best = null, bd = 1e9;
  for (const p of presets) {
    const q = hexToOklch(p.seed);
    const chromaW = Math.min(s.c, q.c) / 0.08; // hue matters only when both are chromatic
    const d = Math.min(1, chromaW) * hueDist(s.h, q.h) / 30 + Math.abs(s.c - q.c) / 0.04 + Math.abs(s.l - q.l) / 0.25;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}
function deriveSpec(seed, presets) {
  const s = hexToOklch(seed);
  const ref = nearestPreset(seed, presets);
  const q = hexToOklch(ref.seed);
  const mono = s.c < 0.03;
  const k = mono ? 1 : Math.max(0.7, Math.min(1.3, s.c / Math.max(q.c, 0.01)));
  const shift = mono || q.c < 0.03 ? 0 : s.h - q.h; // rotate relations with the seed
  const rot = x => ({ h: wrap(x.h + shift), c: x.c * (x === ref.spec.n ? 1 : k) });
  // primary (light): keep the seed if it reaches 4.5:1 on white and the lightest surfaces; else walk L down.
  // primary (light): keep the seed if it holds 4.5:1 on the darkest surface primary text sits on
  // (surface-container-high of the derived neutral); else walk L down at constant H/C (gamut-mapped).
  // Very dark seeds are lifted to L 0.34 so the primary stays distinguishable from body text.
  const worstSurface = oklch(T.light.high, 0.012, s.h);
  const ok = h => contrast(h, worstSurface) >= 4.6;
  let L = s.l, prim = seed;
  if (L < 0.34) { L = 0.34; prim = oklch(L, s.c, s.h); }
  while (!ok(prim) && L > 0.2) { L -= 0.005; prim = oklch(L, s.c, s.h); }
  const sp = ref.spec;
  return {
    seed, seedPrimary: prim, derivedFrom: ref.id,
    p: { h: s.h, c: s.c, hd: sp.p.hd != null ? wrap(sp.p.hd + shift) : undefined, cd: sp.p.cd != null && !(q.c < 0.03 && !mono) ? sp.p.cd * k : undefined },
    pc: sp.pc && !(q.c < 0.03 && !mono) ? { h: sp.pc.h != null ? wrap(sp.pc.h + shift) : undefined, c: sp.pc.c != null ? sp.pc.c * k : undefined } : undefined,
    s: rot(sp.s), t: mono ? { ...sp.t } : rot(sp.t), n: mono ? { ...sp.n } : { h: wrap(sp.n.h + shift), c: sp.n.c },
    d: ref.spec.d, // danger stays in the red family; nearest preset already moved it away from the seed if needed
    blobs: sp.blobs.map(b => mono ? { ...b } : { h: wrap(b.h + shift), c: b.c }),
    accent: sp.accent, slider: sp.slider, night: sp.night, state: sp.state, tune: sp.tune,
  };
}


/* ---------- 七色调色板（2026-10-23 PR-G，定稿 palette-v0.3）：22 套 = 1 个背景色 + 6 个前景撞色 ---------- */
// 三层（上层怎么取色见 input.css「调色板三层」注释）：
//   背景层 = 背景色派生的 7 档深浅（bgTones，--sgx-bg-1..7），只给光晕 / 页面底用；
//   材质层 = 中性色（玻璃顶栏、抽屉、卡片、弹层、输入框），只带一点背景色相（spec.n.c ≤ 0.012），不带饱和主题色；
//   主题色层 = 6 个前景色（fgTones，--sgx-fg-1..6 + -tint / -ink），按顺序：主交互 / 辅助强调 / 标题图标 / 标签装饰 / 图表装饰 / 低频点缀。
// 接进原来的角色引擎（现 94 个）（组件照旧只用语义角色）：primary ← 前景 1（浅色按对比度压深，p.fit），secondary ← 前景 2，tertiary ← 前景 3，
// neutral = 背景色相 + 小彩度，背景三团 blob = 背景色，danger 固定红色族（不随主题变）。
// 前景色池：浅色模式色值（深色模式按 fgTones 提亮）
const FG_POOL = {
  兰紫: '#a77bd6', 冰川蓝: '#72c7e8', 珊瑚: '#f17f72', 琥珀: '#e3a93b', 极光青: '#42cdbb', 蔷薇: '#d4628f',
  电光蓝: '#536dfa', 莓果: '#b54a88', 香槟金: '#c5a66a', 抹茶: '#86ad3f', 雾霾蓝: '#7a95ab', 芥末: '#d4a72c',
  鼠尾草: '#94a982', 干枯玫瑰: '#cf9494', 陶土: '#c46a43', 石墨: '#6b6e75',
  橘子: '#f08a3c', 杏: '#f2a86b', 樱桃: '#d6334a', 霓虹粉: '#f2559b', 湖蓝: '#4f86b5', 孔雀蓝: '#168f9c',
};
const FG_ROLES = ['主交互', '辅助强调', '标题图标', '标签装饰', '图表装饰', '低频点缀'];
// 背景 7 档：浅色从页面底（L 0.97）往深走，深色从页面底（L 0.16）往亮走；彩度按档位放大，封顶 0.14
const BG_TONES = {
  light: { L: [0.97, 0.93, 0.89, 0.84, 0.78, 0.71, 0.63], k: [0.12, 0.3, 0.45, 0.6, 0.75, 0.85, 1] },
  dark: { L: [0.16, 0.22, 0.28, 0.34, 0.4, 0.47, 0.55], k: [0.25, 0.4, 0.55, 0.7, 0.8, 0.9, 1] },
};
/** 背景色 → 7 档深浅（index 0 = 页面底） @param {string} hex @param {'light'|'dark'} mode @returns {string[]} */
export function bgTones(hex, mode) {
  const o = hexToOklch(hex), c = Math.max(o.c, 0.006), T7 = BG_TONES[mode];
  const h = o.c < 0.01 ? 250 : o.h; // 无彩背景（石墨）：色相没有意义，按中性色的冷灰 250° 取
  return T7.L.map((L, i) => oklch(L, Math.min(c * T7.k[i], 0.14), h));
}
/** 前景色按场景取深浅：tint = 标签 / 选中底，base = 按钮 / 进度 / 填充，ink = 文字 / 图标（浅色压深、深色提亮）
 *  @param {string} hex @param {'light'|'dark'} mode @returns {{tint:string, base:string, ink:string}} */
export function fgTones(hex, mode) {
  const o = hexToOklch(hex), c = Math.min(o.c, 0.17);
  if (mode !== 'dark') return { tint: oklch(0.93, Math.min(c * 0.35, 0.05), o.h), base: hex, ink: oklch(Math.min(o.l, 0.5), Math.min(c * 1.05, 0.16), o.h) };
  return { tint: oklch(0.32, Math.min(c * 0.45, 0.06), o.h), base: oklch(Math.max(o.l, 0.78), Math.min(o.c, 0.13), o.h), ink: oklch(0.88, Math.min(c * 0.6, 0.09), o.h) };
}
/** 背景 7 档 + 前景 6 色四档 → 色调 token（--sgx-bg-N、--sgx-fg-N、--sgx-fg-N-tint、--sgx-fg-N-ink、--sgx-fg-N-on）
 *  @param {{bg:string, fg:string[]}} th @param {'light'|'dark'} mode @returns {Object<string,string>} */
export function tonesFor(th, mode) {
  const out = {};
  bgTones(th.bg, mode).forEach((c, i) => { out['bg-' + (i + 1)] = c; });
  th.fg.forEach((hex, i) => {
    const t = fgTones(hex, mode);
    out['fg-' + (i + 1)] = t.base; out['fg-' + (i + 1) + '-tint'] = t.tint; out['fg-' + (i + 1) + '-ink'] = t.ink;
    // 本色当填充时上面的字（fill / on-fill，2026-10-23 PR-G 修订；同 primary-fill 的 fillPair 规则，子站按需取）
    out['fg-' + (i + 1) + '-on'] = fillPair(t.base).on;
  });
  return out;
}

const st = (l, d) => ({ light: { color: 'on-surface', ...l }, dark: { color: 'on-surface', ...d } });
const STD = st({ hover: 0.08, focus: 0.10, pressed: 0.12, selected: 0.10, dragged: 0.16 }, { hover: 0.08, focus: 0.12, pressed: 0.14, selected: 0.12, dragged: 0.18 });
// warm cream surfaces swallow grey overlays — slightly stronger
const WARM = st({ hover: 0.07, focus: 0.10, pressed: 0.12, selected: 0.10, dragged: 0.16, color: 'on-surface' }, { hover: 0.09, focus: 0.12, pressed: 0.15, selected: 0.13, dragged: 0.18 });
// monochrome / near-white backgrounds need the clearest cue
const MONO = st({ hover: 0.09, focus: 0.12, pressed: 0.14, selected: 0.12, dragged: 0.18 }, { hover: 0.10, focus: 0.14, pressed: 0.16, selected: 0.14, dragged: 0.20 });

// 设置风格页的分组（顺序 = 网格顺序 = 本数组顺序）：cool 冷调 / nature 自然 / warm 暖调 / floral 花色 / neutral 中性
const GROUPS = [
  { id: 'cool', zh: '冷调', en: 'Cool' }, { id: 'nature', zh: '自然', en: 'Nature' }, { id: 'warm', zh: '暖调', en: 'Warm' },
  { id: 'floral', zh: '花色', en: 'Floral' }, { id: 'neutral', zh: '中性', en: 'Neutral' },
];
// [id, 中文名, English, 分组, 背景色, 6 前景（主交互 / 辅助强调 / 标题图标 / 标签装饰 / 图表装饰 / 低频点缀）]
const THEMES = [
  ['dustyblue', '雾霾蓝', 'Dusty Blue', 'cool', '#78909c', ['芥末', '珊瑚', '鼠尾草', '电光蓝', '莓果', '极光青']],
  ['lake', '湖蓝', 'Lake', 'cool', '#2f5f86', ['珊瑚', '琥珀', '极光青', '兰紫', '蔷薇', '抹茶']],
  ['glacier', '冰川蓝', 'Glacier', 'cool', '#72c7e8', ['珊瑚', '琥珀', '莓果', '抹茶', '兰紫', '极光青']],
  ['indigo', '靛蓝', 'Indigo', 'cool', '#3d4fd3', ['霓虹粉', '琥珀', '珊瑚', '极光青', '抹茶', '冰川蓝']],
  ['teal', '青碧', 'Teal', 'cool', '#00696b', ['樱桃', '琥珀', '兰紫', '莓果', '电光蓝', '鼠尾草']],
  ['violet', '紫', 'Violet', 'cool', '#6750a4', ['蔷薇', '琥珀', '极光青', '珊瑚', '冰川蓝', '鼠尾草']],
  ['forest', '山绿', 'Forest', 'nature', '#2f6b4f', ['橘子', '冰川蓝', '兰紫', '琥珀', '莓果', '电光蓝']],
  ['matcha', '抹茶', 'Matcha', 'nature', '#3c6a00', ['陶土', '莓果', '电光蓝', '极光青', '兰紫', '冰川蓝']],
  ['sage', '鼠尾草绿', 'Sage', 'nature', '#9caf88', ['干枯玫瑰', '雾霾蓝', '极光青', '兰紫', '香槟金', '莓果']],
  ['cherry', '樱桃', 'Cherry', 'warm', '#ba1a20', ['抹茶', '冰川蓝', '琥珀', '极光青', '兰紫', '莓果']],
  ['tangerine', '橘子', 'Tangerine', 'warm', '#b02e00', ['孔雀蓝', '电光蓝', '极光青', '兰紫', '抹茶', '莓果']],
  ['coral', '珊瑚', 'Coral', 'warm', '#f17f72', ['孔雀蓝', '电光蓝', '琥珀', '兰紫', '抹茶', '石墨']],
  ['terra', '陶土', 'Terracotta', 'warm', '#8a4b2d', ['鼠尾草', '孔雀蓝', '蔷薇', '兰紫', '电光蓝', '香槟金']],
  ['amber', '琥珀', 'Amber', 'warm', '#825500', ['莓果', '电光蓝', '极光青', '兰紫', '珊瑚', '冰川蓝']],
  ['mustard', '芥末黄', 'Mustard', 'warm', '#d4a72c', ['雾霾蓝', '电光蓝', '莓果', '极光青', '干枯玫瑰', '兰紫']],
  ['champagne', '香槟金', 'Champagne', 'warm', '#c5a66a', ['电光蓝', '莓果', '孔雀蓝', '兰紫', '雾霾蓝', '珊瑚']],
  ['rose', '蔷薇', 'Rose', 'floral', '#984061', ['杏', '极光青', '冰川蓝', '鼠尾草', '电光蓝', '香槟金']],
  ['berry', '莓果', 'Berry', 'floral', '#b54a88', ['琥珀', '极光青', '冰川蓝', '抹茶', '珊瑚', '电光蓝']],
  ['orchid', '兰紫', 'Orchid', 'floral', '#a62092', ['雾霾蓝', '琥珀', '极光青', '冰川蓝', '抹茶', '珊瑚']],
  ['dustyrose', '干枯玫瑰', 'Dusty Rose', 'floral', '#d8a7a7', ['鼠尾草', '雾霾蓝', '极光青', '香槟金', '兰紫', '冰川蓝']],
  ['graphite', '石墨', 'Graphite', 'neutral', '#5e5e5e', ['湖蓝', '珊瑚', '琥珀', '极光青', '兰紫', '蔷薇']],
  ['cream', '奶油白', 'Cream', 'neutral', '#f0e6d5', ['孔雀蓝', '珊瑚', '电光蓝', '莓果', '抹茶', '琥珀']],
];
const DEFAULT_ID = 'dustyblue';

/** 背景色 + 6 前景 → 引擎规格（94 个角色照旧由 build() 出）。 @param {{bg:string, fg:string[], group:string}} th */
function themeSpec(th) {
  const [f1, f2, f3] = th.fg.map(hexToOklch), B = hexToOklch(th.bg);
  const cap = (o) => ({ h: o.h, c: Math.min(o.c, 0.17) });
  // 中性：背景色相 + 小彩度（0.006–0.012）；无彩背景（石墨）用原来的冷灰
  const n = B.c < 0.01 ? { h: 250, c: 0.004 } : { h: B.h, c: Math.max(0.006, Math.min(0.012, 0.004 + B.c * 0.06)) };
  const bc = Math.max(B.c, 0.006);
  return {
    // 浅色主色 = 前景 1 按对比度压深（fitPrimary，彩度 lc ≈ ink 档）；深色主色 L 0.80、彩度 ≤ 0.13（= fgTones 深色 base）
    p: { h: f1.h, c: f1.c, lc: Math.min(Math.min(f1.c, 0.17) * 1.05, 0.16), cd: Math.min(f1.c, 0.13), fit: true },
    pc: { h: f1.h, c: Math.min(Math.min(f1.c, 0.17) * 0.35, 0.05) }, // 选中底 = 前景 1 的 tint 档
    s: cap(f2), t: cap(f3), n, d: { h: 27, c: 0.19 },
    blobs: [{ h: B.h, c: Math.min(bc * 0.3, 0.045) }, { h: B.h, c: Math.min(bc * 0.25, 0.04) }, { h: B.h, c: Math.min(bc * 0.2, 0.035) }],
    accent: 'primary', night: 't',
    state: th.group === 'neutral' ? MONO : th.group === 'warm' ? WARM : STD,
  };
}
const PRESETS = THEMES.map(([id, zh, en, group, bg, names]) => {
  const fg = names.map((nm) => FG_POOL[nm]);
  const th = { bg, fg, group };
  return { id, zh, en, group, bg, fgNames: names, fg, seed: fg[0],
    mood: { zh: `背景${zh}；前景 ${names.join(' / ')}`, en: `${en} background with six foreground accents` },
    spec: themeSpec(th) };
});

/* ---------- site glue ---------- */
/** 低饱和种子（spec.p.fit）：浅色主色按色相不变压深，直到在本套最深的正文底（surface-container-high）上 ≥ 4.6:1；
 *  彩度用 spec.p.lc（压深后略提一点，免得发灰）。其余预设的浅色主色 = 种子原样。 */
function fitPrimary(seed, spec) {
  if (!spec.p.fit) return seed;
  const s = hexToOklch(seed), worst = oklch(T.light.high, spec.n.c * 1.4, spec.n.h);
  const C = spec.p.lc != null ? spec.p.lc : s.c;
  let L = s.l, prim = oklch(L, C, s.h);
  while (contrast(prim, worst) < 4.6 && L > 0.2) { L -= 0.005; prim = oklch(L, C, s.h); }
  return prim;
}
const PRESET_LIST = PRESETS.map((x) => ({ ...x, spec: { ...x.spec, seed: x.seed, seedPrimary: fitPrimary(x.seed, x.spec) } }));

/** 图表色 chart-1..6（2026-10-23 PR-G 修订，构建期静态算好）：前景 N 本色在卡片（surface-container-lowest 和
 *  材质叠在页面底上的合成色）上都 ≥ 3:1 就用本色，否则退到该色的 ink 档（逐色回退：fill → ink）。
 *  @param {Object<string,any>} r 角色表（就地加 chart-N） @param {Object<string,string>} tones @param {'light'|'dark'} mode */
const CHART_MIN = 3;
function addCharts(r, tones) {
  const card = r['surface-container-lowest'], page = mixHex(r.surface, 0.88, tones['bg-1']);
  const ok = (c) => contrast(c, card) >= CHART_MIN && contrast(c, page) >= CHART_MIN;
  const picked = [];
  for (let i = 1; i <= 6; i++) {
    const base = tones['fg-' + i], ink = tones['fg-' + i + '-ink'], o = hexToOklch(ink);
    // 顺序：本色 → ink → ink 同色相再往远离卡片的方向挪一档 / 两档；取第一个既 ≥3:1 又和前面的图表色分得开的
    // （例：鼠尾草绿里雾霾蓝 / 极光青都退到 ink 后太像；芥末黄深色里雾霾蓝 / 电光蓝本色太像）
    const dir = hexToOklch(card).l > 0.5 ? -1 : 1;
    const cands = [...(ok(base) ? [base] : []), ink, oklch(o.l + dir * 0.07, o.c, o.h), oklch(o.l + dir * 0.14, o.c, o.h)];
    const c = cands.find((x) => ok(x) && picked.every((y) => chartDistinct(x, y))) || cands[0];
    picked.push(c); r['chart-' + i] = c;
  }
  return r;
}
/** 图表两色分得开：都有彩色（C > 0.05）且色相差 ≥ 22°，或 OKLab ΔE ≥ 0.08 */
function chartDistinct(a, b) {
  const A = hexToOklch(a), B = hexToOklch(b);
  if (A.c > 0.05 && B.c > 0.05 && hueDist(A.h, B.h) >= 22) return true;
  const lab = (o) => [o.l, o.c * Math.cos(o.h * Math.PI / 180), o.c * Math.sin(o.h * Math.PI / 180)];
  const x = lab(A), y = lab(B);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) >= 0.08;
}
/** 不透明色按比例混合（= CSS color-mix(in srgb, a p, b)） */
function mixHex(a, p, b) { const A = hexRgb(a), B = hexRgb(b); return rgbHex(A.map((v, i) => v * p + B[i] * (1 - p))); }

/** 与 gen.js 相同的壁纸串（--sgx-background-css） */
function wallpaperCss(r) {
  const g = r["bg-gradient"];
  return [
    `radial-gradient(120% 80% at 18% 0%, ${r["bg-blob-1"]} 0%, transparent 60%)`,
    `radial-gradient(100% 70% at 92% 8%, ${r["bg-blob-2"]} 0%, transparent 55%)`,
    `radial-gradient(120% 90% at 50% 100%, ${r["bg-blob-3"]} 0%, transparent 60%)`,
    `linear-gradient(180deg, ${g[0]} 0%, ${g[1]} 55%, ${g[2]} 100%)`,
  ].join(", ");
}

/** 按规格构建一个模式的全部角色（含审计修正和壁纸串），与 gen.js make() 一致 */
function buildMode(spec, mode) {
  const r = build(spec, mode);
  audit(r, spec, mode);
  r["background-css"] = wallpaperCss(r);
  return { ...r };
}

/** 自定义种子的色调 token：最近预设的背景色 + 6 前景整体转到种子色相（和 deriveSpec 转 s / t / n 同一个角度），前景 1 = 种子本身。
 *  @param {string} seed @param {any} spec deriveSpec 的结果 @returns {{bg:string, fg:string[]}} */
function customTheme(seed, spec) {
  const ref = PRESET_LIST.find((x) => x.id === spec.derivedFrom);
  const s = hexToOklch(seed), q = hexToOklch(ref.seed);
  const shift = s.c < 0.03 || q.c < 0.03 ? 0 : s.h - q.h;
  const rot = (hex) => { if (!shift) return hex; const o = hexToOklch(hex); return o.c < 0.01 ? hex : oklch(o.l, o.c, wrap(o.h + shift)); };
  return { bg: rot(ref.bg), fg: [seed, ...ref.fg.slice(1).map(rot)] };
}

/** @param {string} seed #rrggbb @returns {{light:Object<string,any>, dark:Object<string,any>, lightState:any, darkState:any, lightTones:Object<string,string>, darkTones:Object<string,string>, derivedFrom:string, seedPrimary:string}} */
export function rolesFor(seed) {
  const spec = deriveSpec(seed, PRESET_LIST);
  const th = customTheme(seed, spec);
  const lightTones = tonesFor(th, "light"), darkTones = tonesFor(th, "dark");
  return { light: addCharts(buildMode(spec, "light"), lightTones), dark: addCharts(buildMode(spec, "dark"), darkTones),
    lightState: spec.state.light, darkState: spec.state.dark,
    lightTones, darkTones,
    derivedFrom: spec.derivedFrom, seedPrimary: spec.seedPrimary };
}

/** 预设 id → 角色表 + 色调 token（单测用来和 JSON 对照） */
export function presetRoles(id) {
  const p = PRESET_LIST.find((x) => x.id === id);
  if (!p) return null;
  const lightTones = tonesFor(p, "light"), darkTones = tonesFor(p, "dark");
  return { light: addCharts(buildMode(p.spec, "light"), lightTones), dark: addCharts(buildMode(p.spec, "dark"), darkTones),
    lightState: p.spec.state.light, darkState: p.spec.state.dark, lightTones, darkTones };
}

/** 色调 token → CSS 声明（--sgx-bg-1..7、--sgx-fg-1..6、--sgx-fg-N-tint / -ink） @param {Object<string,string>} tones @returns {string[]} */
export function toneDecls(tones) {
  return Object.entries(tones || {}).map(([k, v]) => `--sgx-${k}: ${v};`);
}

/**
 * 角色表 → CSS 声明（与 scripts/gen-palettes.mjs 用同一个函数，变量名完全一致）。
 * bg-gradient 拆成 --sgx-bg-gradient-1..3；状态层写 --sgx-state-*（color 为角色名，转成 var()）。
 * @param {Object<string,any>} roles @param {any} state @returns {string[]}
 */
export function roleDecls(roles, state) {
  const out = [];
  for (const [k, v] of Object.entries(roles)) {
    if (k === "bg-gradient") { v.forEach((c, i) => out.push(`--sgx-bg-gradient-${i + 1}: ${c};`)); continue; }
    out.push(`--sgx-${k}: ${v};`);
  }
  if (state) {
    const c = state.color === "primary" ? "primary" : "text-primary";
    out.push(`--sgx-state-color: var(--sgx-${c});`);
    for (const k of ["hover", "focus", "pressed", "selected", "dragged"]) out.push(`--sgx-state-${k}: ${state[k]};`);
  }
  return out;
}

/**
 * 自定义种子 → <style> 文本。用 html:root（不进 @layer，盖过 tokens 层里各预设的 :root[data-palette]）。
 * @param {string} seed #rrggbb @returns {string}
 */
export function rolesCss(seed) {
  const r = rolesFor(seed);
  return `html:root{--sgx-seed: ${seed};${roleDecls(r.light, r.lightState).join("")}${toneDecls(r.lightTones).join("")}}` +
    `html:root.dark{${roleDecls(r.dark, r.darkState).join("")}${toneDecls(r.darkTones).join("")}}`;
}

export { mixHex, PRESETS, GROUPS, DEFAULT_ID, FG_POOL, FG_ROLES, deriveSpec, build, audit, contrast, hexToOklch };
/* @sgx-shell:end */
