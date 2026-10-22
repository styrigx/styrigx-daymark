/* @sgx-shell:begin styrigx/styrigx-space@main web/shared/shell v79e9f350e100（scripts/sync-shell.mjs 写入，勿手改） */
/* ---- palette-scheme.js ---- */
/**
 * @fileoverview 主题色引擎（PR3 色彩角色 token 的运行时一半）：自定义 #rrggbb 种子 → 整套亮 / 暗色彩角色。
 * 移植自色板设计稿的 scheme.js（OKLCH 色阶、角色构建、对比度审计 + 自动修正、自定义种子派生）和 presets.js（原 13 套手调；2026-10-21 起单色 17 + 撞色 16 = 33 套），
 * 数学和常数一字不改：33 个预设用同一条管线算出来的结果就是 web/data/palette-roles.json（scripts/gen-palettes.mjs 把它生成进 input.css）；
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
  // 首页夜间时钟卡（2026-10-21）：取 spec.night 指定色族（p / s / t，默认 p = 单色组的主色深色调）的深色调，彩度保留（不是混黑，暖色混黑会发泥），
  // 亮 L 0.32 / 暗 L 0.30；上面是白字（≥ 7:1，单测核对）
  { const nk = spec.night || 'p', F = nk === 'p' ? { h: pH, c: P.c } : nk === 't' ? Te : S;
    r['night-card'] = oklch(D ? 0.30 : 0.32, Math.min(F.c * (D ? 0.85 : 1), 0.065), F.h); }
  Object.defineProperty(r, '__dark', { value: D, enumerable: false });
  applyAliases(r, spec);
  return r;
}

// 导航抽屉当前项药丸的亮度（OKLCH L）：bg = 药丸，fg = 药丸上的文字 / 图标
const NAV_SEL = { light: { bg: 0.83, fg: 0.29 }, dark: { bg: 0.365, fg: 0.93 } };
function applyAliases(r, spec) {
  // interactive roles
  const D = r.__dark;
  const accent = spec.accent === 'tertiary' ? 'tertiary' : 'primary';
  r['focus-ring'] = r[accent];
  r['switch-track-on'] = r[accent];
  r['switch-thumb-on'] = r['on-' + accent];
  r['switch-track-off'] = r['surface-container-highest'];
  r['switch-thumb-off'] = r['outline'];
  // 滑块 / 进度：默认 = 强调色（单色组）；撞色组 spec.slider = 'secondary'（One UI 快捷面板：磁贴主色、滑块另一个色相），石墨×湖蓝 = tertiary
  const sl = spec.slider || accent;
  r['slider-active'] = r[sl];
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
  r['lock-unlock'] = r['primary'];
  r['on-lock-unlock'] = r['on-primary'];
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
  for (const k of ['primary', 'secondary', 'tertiary', 'danger']) {
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
  }
  for (const s of ['surface', 'surface-container-lowest', 'surface-container', 'surface-container-high']) {
    c.push(['outline', s, 3, 'ui']);
    c.push(['focus-ring', s, 3, 'ui']);
    c.push(['switch-track-on', s, 3, 'ui']);
    c.push(['slider-active', s, 3, 'ui']);
  }
  // 不带字的填充（屏幕时间分段 / 存储条 / 图例圆点）：在卡片上 ≥ 3:1（图形级）
  c.push(['secondary-fill', 'surface-container-lowest', 3, 'ui']);
  c.push(['tertiary-fill', 'surface-container-lowest', 3, 'ui']);
  c.push(['switch-thumb-on', 'switch-track-on', 3, 'ui']);
  c.push(['switch-thumb-off', 'switch-track-off', 3, 'ui']);
  c.push(['slider-active', 'slider-inactive', 3, 'ui']);
  c.push(['on-chip-selected', 'chip-selected', 4.5, 'text']);
  c.push(['on-nav-selected', 'nav-selected', 4.5, 'text']);
  c.push(['on-fab', 'fab', 4.5, 'text']);
  c.push(['daymark-label', 'daymark-card', 4.5, 'text']);
  c.push(['lock-quote', '@lock-quote-on-bg', 4.5, 'text']);
  c.push(['text-primary', '@topbar-on-blob', 4.5, 'text']);
  c.push(['text-primary', '@topbar-on-bg', 4.5, 'text']);
  return c;
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
  const SRC = { 'focus-ring': accent, 'switch-track-on': accent, 'slider-active': sl, 'slider-thumb': sl,
    'switch-thumb-on': 'on-' + accent, 'switch-thumb-off': 'outline', 'slider-inactive': sl + '-container',
    'daymark-label': 'tertiary', 'lock-quote': 'on-tertiary-container', 'on-chip-selected': 'on-secondary-container',
    'chip-selected': 'secondary-container', 'on-fab': 'on-primary-container', 'fab': 'primary-container',
    'lock-clock': 'text-primary', 'daymark-text': 'text-primary', 'lock-meta': 'text-secondary' };
  const sourceOf = k => SRC[k] || k;
  for (let pass = 0; pass < 6 && fix; pass++) {
    let changed = false;
    for (const [fgK, bgK, min] of checks()) {
      const bg = resolveBg(r, bgK);
      if (contrast(r[fgK], bg) >= min - 1e-9) continue;
      // which side to move: normally the foreground; the light seed primary is locked.
      let target = sourceOf(fgK), against = bg, moveFg = true;
      if (fgK === 'slider-active' && bgK === 'slider-inactive') { target = sourceOf('slider-inactive'); against = r['slider-active']; moveFg = false; }
      if (target === 'primary' && mode === 'light') { target = null; }
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
  const rows = checks().map(([fgK, bgK, min, kind]) => { const v = contrast(r[fgK], resolveBg(r, bgK)); return { fg: fgK, bg: bgK, min, kind, ratio: +v.toFixed(2), pass: v >= min - 1e-9 }; });
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


/* ---------- 33 preset specs (presets.js; 2026-10-21: group mono 17 + group clash 16) ---------- */
// 33 preset specs (OKLCH hue h in degrees, chroma c). Light primary = seed hex, untouched (except p.fit: darkened for AA, chroma p.lc).
// group 'clash' (One UI-style): s and t come from clearly different hue families (~45–150° from p), n = pale wash hue for page /
// surfaces (may differ from p), blobs = n + s + t. night = family of the home night-clock card (p / s / t, default p);
// slider = family of sliders / progress (default = accent). Custom seeds derive from the mono group only.
// p.hd / p.cd = dark-mode primary hue / chroma override. pc = light primary-container hue/chroma override.
// s = secondary, t = tertiary, n = neutral tint, d = danger, blobs = 3 background accent blobs.
// accent = which family drives focus ring / switch / slider / link (graphite uses its one cool accent).
const st = (l, d) => ({ light: { color: 'on-surface', ...l }, dark: { color: 'on-surface', ...d } });
const STD = st({ hover: 0.08, focus: 0.10, pressed: 0.12, selected: 0.10, dragged: 0.16 }, { hover: 0.08, focus: 0.12, pressed: 0.14, selected: 0.12, dragged: 0.18 });
// saturated presets read stronger: tint state layers with primary and pull opacity down in light
const VIVID = st({ color: 'primary', hover: 0.06, focus: 0.09, pressed: 0.11, selected: 0.09, dragged: 0.14 }, { color: 'primary', hover: 0.08, focus: 0.11, pressed: 0.13, selected: 0.12, dragged: 0.16 });
// warm cream surfaces swallow grey overlays — slightly stronger
const WARM = st({ hover: 0.07, focus: 0.10, pressed: 0.12, selected: 0.10, dragged: 0.16, color: 'on-surface' }, { hover: 0.09, focus: 0.12, pressed: 0.15, selected: 0.13, dragged: 0.18 });
// monochrome needs the clearest cue, no hue to help
const MONO = st({ hover: 0.09, focus: 0.12, pressed: 0.14, selected: 0.12, dragged: 0.18 }, { hover: 0.10, focus: 0.14, pressed: 0.16, selected: 0.14, dragged: 0.20 });

// 两组色板（2026-10-21）：
//   group 'mono'（单色，17 套）：原来的 13 套（规格与 cfec8af 一字不差）+ 4 套低饱和单色；默认 lake 在这一组（默认色取自头像，单色最稳妥）。
//   group 'clash'（撞色，16 套，id = x + 底色名）：One UI 调色板式——主色 = 同名单色的种子，辅色、第三色取明显不同的色相族
//     （约 45–150°，不用邻近色），中性色调 n 铺页面底和表面，背景三团光 = n + s + t；slider = 'secondary'（滑块 / 进度取辅色），
//     night = 首页夜间时钟卡取哪个色族的深色调。
const PRESETS = [
  { id: 'lake', zh: '默认', en: 'Default', seed: '#2f5f86', group: 'mono',
    mood: { zh: '清晨湖面：湖蓝为主，岸边海玻璃绿与一抹薄雾淡紫。', en: 'Lake at first light — slate-blue water, sea-glass shallows, a lavender haze.' },
    spec: { p: { h: 245.4, c: 0.082, cd: 0.085 }, s: { h: 238, c: 0.035 }, t: { h: 172, c: 0.062 }, n: { h: 240, c: 0.008 }, d: { h: 27, c: 0.19 },
      blobs: [{ h: 245, c: 0.042 }, { h: 168, c: 0.040 }, { h: 300, c: 0.035 }], accent: 'primary', state: STD } },
  { id: 'forest', zh: '山绿', en: 'Forest', seed: '#2f6b4f', group: 'mono',
    mood: { zh: '雨后山径：松针绿、苔藓与远山的雾蓝。', en: 'Mountain trail after rain — pine green, moss, misty blue ridges.' },
    spec: { p: { h: 161.1, c: 0.078, cd: 0.085 }, s: { h: 138, c: 0.034 }, t: { h: 228, c: 0.052 }, n: { h: 155, c: 0.007 }, d: { h: 27, c: 0.19 },
      blobs: [{ h: 158, c: 0.040 }, { h: 225, c: 0.035 }, { h: 115, c: 0.040 }], accent: 'primary', state: STD } },
  { id: 'terra', zh: '陶土', en: 'Terracotta', seed: '#8a4b2d', group: 'mono',
    mood: { zh: '晒过太阳的陶罐：陶土配鼠尾草绿与细沙。', en: 'Sun-baked clay — terracotta with sage leaves and fine sand.' },
    spec: { p: { h: 45.2, c: 0.096, cd: 0.085 }, pc: { h: 50, c: 0.05 }, s: { h: 72, c: 0.042 }, t: { h: 135, c: 0.050 }, n: { h: 70, c: 0.010 }, d: { h: 22, c: 0.20 },
      blobs: [{ h: 52, c: 0.045 }, { h: 85, c: 0.045 }, { h: 135, c: 0.035 }], accent: 'primary', state: WARM, tune: { light: { bg: 0.965 } } } },
  { id: 'violet', zh: '紫', en: 'Violet', seed: '#6750a4', group: 'mono',
    mood: { zh: '黄昏薰衣草：柔紫、灰丁香与一点暮色玫瑰。', en: 'Dusk lavender — soft violet, grey lilac, a blush of twilight rose.' },
    spec: { p: { h: 293.7, c: 0.130 }, s: { h: 300, c: 0.036 }, t: { h: 5, c: 0.062 }, n: { h: 295, c: 0.009 }, d: { h: 25, c: 0.19 },
      blobs: [{ h: 295, c: 0.045 }, { h: 350, c: 0.035 }, { h: 262, c: 0.040 }], accent: 'primary', state: STD } },
  { id: 'rose', zh: '蔷薇', en: 'Rose', seed: '#984061', group: 'mono',
    mood: { zh: '傍晚花园：蔷薇、灰调藕荷与一抹杏色。', en: 'Garden rose at dusk — rose, dusty mauve, a hint of apricot.' },
    spec: { p: { h: 359, c: 0.123, cd: 0.10 }, s: { h: 345, c: 0.036 }, t: { h: 58, c: 0.070 }, n: { h: 355, c: 0.009 }, d: { h: 33, c: 0.19 },
      blobs: [{ h: 0, c: 0.042 }, { h: 55, c: 0.042 }, { h: 318, c: 0.032 }], accent: 'primary', state: STD } },
  { id: 'cherry', zh: '樱桃', en: 'Cherry', seed: '#ba1a20', group: 'mono',
    mood: { zh: '枝头樱桃：果红配樱花粉和一片嫩叶，像水果不像报错。', en: 'Cherries on the branch — fruit red with blossom pink and a fresh leaf; reads as fruit, not an error.' },
    spec: { p: { h: 26.3, c: 0.192, hd: 14, cd: 0.115 }, pc: { h: 8, c: 0.065 }, s: { h: 355, c: 0.048 }, t: { h: 150, c: 0.058 }, n: { h: 10, c: 0.008 }, d: { h: 40, c: 0.17 },
      blobs: [{ h: 355, c: 0.045 }, { h: 45, c: 0.040 }, { h: 140, c: 0.032 }], accent: 'primary', state: VIVID } },
  { id: 'tangerine', zh: '橘子', en: 'Tangerine', seed: '#b02e00', group: 'mono',
    mood: { zh: '地中海柑橘：橘皮、黄油般的阳光和一汪海水。', en: 'Mediterranean citrus — peel orange, buttery sun, a splash of sea.' },
    spec: { p: { h: 35.8, c: 0.173, cd: 0.12 }, pc: { h: 45, c: 0.07 }, s: { h: 62, c: 0.045 }, t: { h: 212, c: 0.060 }, n: { h: 60, c: 0.009 }, d: { h: 12, c: 0.20 },
      blobs: [{ h: 48, c: 0.050 }, { h: 95, c: 0.055 }, { h: 205, c: 0.035 }], accent: 'primary', state: VIVID } },
  { id: 'amber', zh: '琥珀', en: 'Amber', seed: '#825500', group: 'mono',
    mood: { zh: '午后蜂蜜与无花果：琥珀、古铜和熟透的梅子紫。', en: 'Honey and figs in afternoon light — amber, bronze, ripe plum.' },
    spec: { p: { h: 73.8, c: 0.103, cd: 0.11 }, s: { h: 62, c: 0.040 }, t: { h: 345, c: 0.055 }, n: { h: 78, c: 0.010 }, d: { h: 25, c: 0.19 },
      blobs: [{ h: 78, c: 0.055 }, { h: 98, c: 0.045 }, { h: 350, c: 0.032 }], accent: 'primary', state: WARM } },
  { id: 'matcha', zh: '抹茶', en: 'Matcha', seed: '#3c6a00', group: 'mono',
    mood: { zh: '茶席：抹茶绿、竹青与焙茶陶杯的暖褐。', en: 'Tea ceremony — matcha, young bamboo, a warm hojicha cup.' },
    spec: { p: { h: 132.8, c: 0.133, cd: 0.12 }, s: { h: 115, c: 0.036 }, t: { h: 55, c: 0.052 }, n: { h: 110, c: 0.009 }, d: { h: 27, c: 0.19 },
      blobs: [{ h: 128, c: 0.050 }, { h: 95, c: 0.040 }, { h: 60, c: 0.032 }], accent: 'primary', state: WARM } },
  { id: 'teal', zh: '青碧', en: 'Teal', seed: '#00696b', group: 'mono',
    mood: { zh: '翡翠泻湖：青碧海水、浅滩灰与珊瑚。', en: 'Jade lagoon — teal water, sandbar grey, living coral.' },
    spec: { p: { h: 197.1, c: 0.080, cd: 0.09 }, s: { h: 205, c: 0.030 }, t: { h: 32, c: 0.075 }, n: { h: 200, c: 0.008 }, d: { h: 20, c: 0.20 },
      blobs: [{ h: 195, c: 0.045 }, { h: 40, c: 0.038 }, { h: 232, c: 0.032 }], accent: 'primary', state: STD } },
  { id: 'indigo', zh: '靛蓝', en: 'Indigo', seed: '#3d4fd3', group: 'mono',
    mood: { zh: '夜墨与霓虹晨光：靛蓝、钢灰蓝、一道电光青。', en: 'Night ink meets neon dawn — indigo, steel periwinkle, an electric cyan streak.' },
    spec: { p: { h: 271, c: 0.202, cd: 0.11 }, s: { h: 268, c: 0.040 }, t: { h: 215, c: 0.075 }, n: { h: 270, c: 0.009 }, d: { h: 25, c: 0.19 },
      blobs: [{ h: 272, c: 0.050 }, { h: 215, c: 0.040 }, { h: 320, c: 0.032 }], accent: 'primary', state: VIVID } },
  { id: 'orchid', zh: '兰紫', en: 'Orchid', seed: '#a62092', group: 'mono',
    mood: { zh: '热带兰花：洋红兰瓣、灰藕荷与花心的金。', en: 'Tropical orchid — magenta petals, mauve grey, a gold heart.' },
    spec: { p: { h: 335.3, c: 0.203, cd: 0.12 }, pc: { h: 335, c: 0.075 }, s: { h: 328, c: 0.040 }, t: { h: 85, c: 0.070 }, n: { h: 330, c: 0.009 }, d: { h: 27, c: 0.19 },
      blobs: [{ h: 335, c: 0.048 }, { h: 62, c: 0.040 }, { h: 292, c: 0.038 }], accent: 'primary', state: VIVID } },
  // 低饱和四套单色（2026-10-21）：种子是莫兰迪色，浅色主色按对比度压深（p.fit，压深后彩度 p.lc），色块仍显示种子本色
  { id: 'dustyblue', zh: '雾霾蓝', en: 'Dusty Blue', seed: '#78909c', group: 'mono',
    mood: { zh: '阴天的旧牛仔：雾霾蓝的深浅，像洗旧的丹宁。', en: 'Overcast denim — tonal steps of a washed dusty blue.' },
    spec: { p: { h: 229.5, c: 0.033, lc: 0.048, cd: 0.055, fit: true }, pc: { h: 229.5, c: 0.032 }, s: { h: 225, c: 0.022 }, t: { h: 208, c: 0.035 }, n: { h: 230, c: 0.007 }, d: { h: 27, c: 0.19 },
      blobs: [{ h: 230, c: 0.030 }, { h: 210, c: 0.025 }, { h: 250, c: 0.022 }], accent: 'primary', state: STD } },
  { id: 'mustard', zh: '芥末黄', en: 'Mustard', seed: '#d4a72c', group: 'mono',
    mood: { zh: '复古毛衣：芥末黄、姜黄与一点焦糖。', en: 'Vintage knit — mustard, turmeric and a touch of caramel.' },
    spec: { p: { h: 87.1, c: 0.141, lc: 0.110, cd: 0.12, fit: true }, pc: { h: 87, c: 0.070 }, s: { h: 80, c: 0.040 }, t: { h: 66, c: 0.060 }, n: { h: 88, c: 0.011 }, d: { h: 27, c: 0.19 },
      blobs: [{ h: 88, c: 0.050 }, { h: 75, c: 0.040 }, { h: 95, c: 0.035 }], accent: 'primary', state: WARM } },
  { id: 'sage', zh: '鼠尾草绿', en: 'Sage', seed: '#9caf88', group: 'mono',
    mood: { zh: '香草小园：鼠尾草、迷迭香和晒干的叶子。', en: 'Herb garden — sage, rosemary and sun-dried leaves.' },
    spec: { p: { h: 128.9, c: 0.059, lc: 0.070, cd: 0.07, fit: true }, pc: { h: 128.9, c: 0.045 }, s: { h: 125, c: 0.030 }, t: { h: 145, c: 0.040 }, n: { h: 120, c: 0.008 }, d: { h: 27, c: 0.19 },
      blobs: [{ h: 125, c: 0.035 }, { h: 145, c: 0.030 }, { h: 105, c: 0.025 }], accent: 'primary', state: STD } },
  { id: 'dustyrose', zh: '干枯玫瑰', en: 'Dusty Rose', seed: '#d8a7a7', group: 'mono',
    mood: { zh: '夹在书里的花：干枯玫瑰的深浅，像褪色的花瓣。', en: 'Pressed flowers — tonal steps of a faded dried rose.' },
    spec: { p: { h: 18.5, c: 0.058, lc: 0.085, cd: 0.075, fit: true }, pc: { h: 15, c: 0.045 }, s: { h: 12, c: 0.030 }, t: { h: 355, c: 0.040 }, n: { h: 18, c: 0.009 }, d: { h: 30, c: 0.19 },
      blobs: [{ h: 18, c: 0.035 }, { h: 355, c: 0.028 }, { h: 35, c: 0.025 }], accent: 'primary', state: STD } },
  { id: 'graphite', zh: '石墨', en: 'Graphite', seed: '#5e5e5e', group: 'mono',
    mood: { zh: '铅笔与钢：近乎单色的石墨灰，只留一道冷蓝做点睛。', en: 'Pencil and steel — near-monochrome graphite with a single cool-blue accent.' },
    spec: { p: { h: 250, c: 0.0, cd: 0.004 }, pc: { h: 250, c: 0.006 }, s: { h: 250, c: 0.008 }, t: { h: 240, c: 0.115 }, n: { h: 250, c: 0.004 }, d: { h: 25, c: 0.18 },
      blobs: [{ h: 250, c: 0.010 }, { h: 235, c: 0.022 }, { h: 250, c: 0.006 }], accent: 'tertiary', state: MONO } },
  { id: 'xforest', zh: '山绿×橘子', en: 'Forest × Tangerine', seed: '#2f6b4f', group: 'clash',
    mood: { zh: '雨后山径：松针绿撞一抹橘子橙（像林间的灯），远山是雾蓝，底色是奶油。', en: 'Mountain trail after rain — pine green against a tangerine lantern, misty-blue ridges, a cream sky.' },
    spec: { p: { h: 161.1, c: 0.078, cd: 0.085 }, s: { h: 42, c: 0.110 }, t: { h: 228, c: 0.055 }, n: { h: 105, c: 0.011 }, d: { h: 22, c: 0.20 },
      blobs: [{ h: 105, c: 0.038 }, { h: 42, c: 0.034 }, { h: 228, c: 0.032 }], accent: 'primary', slider: 'secondary', night: 't', state: STD } },
  { id: 'xterra', zh: '陶土×鼠尾草', en: 'Terracotta × Sage', seed: '#8a4b2d', group: 'clash',
    mood: { zh: '晒过太阳的陶罐：陶土撞鼠尾草绿，罐口一圈灰蓝釉，底下是细沙。', en: 'Sun-baked clay — terracotta against sage, a ring of dusty-blue glaze, fine sand below.' },
    spec: { p: { h: 45.2, c: 0.096, cd: 0.085 }, pc: { h: 50, c: 0.05 }, s: { h: 140, c: 0.055 }, t: { h: 240, c: 0.055 }, n: { h: 75, c: 0.013 }, d: { h: 22, c: 0.20 },
      blobs: [{ h: 75, c: 0.042 }, { h: 140, c: 0.034 }, { h: 240, c: 0.030 }], accent: 'primary', slider: 'secondary', night: 't', state: WARM, tune: { light: { bg: 0.965 } } } },
  { id: 'xviolet', zh: '紫×蔷薇', en: 'Violet × Rose', seed: '#6750a4', group: 'clash',
    mood: { zh: '黄昏薰衣草：柔紫配暮色玫瑰，草地上一点薄荷绿。', en: 'Dusk lavender — soft violet with twilight rose and a touch of mint.' },
    spec: { p: { h: 293.7, c: 0.130 }, s: { h: 355, c: 0.075 }, t: { h: 175, c: 0.070 }, n: { h: 300, c: 0.012 }, d: { h: 25, c: 0.19 },
      blobs: [{ h: 300, c: 0.042 }, { h: 355, c: 0.036 }, { h: 175, c: 0.032 }], accent: 'primary', slider: 'secondary', night: 't', state: STD } },
  { id: 'xrose', zh: '蔷薇×杏', en: 'Rose × Apricot', seed: '#984061', group: 'clash',
    mood: { zh: '傍晚花园：蔷薇撞杏色，叶子是鼠尾草绿，晚风带一点粉。', en: 'Garden rose at dusk — rose against apricot, sage leaves, a blush in the air.' },
    spec: { p: { h: 359, c: 0.123, cd: 0.10 }, s: { h: 55, c: 0.085 }, t: { h: 150, c: 0.055 }, n: { h: 10, c: 0.012 }, d: { h: 33, c: 0.19 },
      blobs: [{ h: 10, c: 0.040 }, { h: 55, c: 0.040 }, { h: 150, c: 0.030 }], accent: 'primary', slider: 'secondary', night: 't', state: STD } },
  { id: 'xcherry', zh: '樱桃×嫩叶', en: 'Cherry × Leaf', seed: '#ba1a20', group: 'clash',
    mood: { zh: '枝头樱桃：果红配嫩叶绿和花蕊的奶油黄，底色是樱花粉。', en: 'Cherries on the branch — fruit red, fresh leaf, buttery stamens on blossom pink.' },
    spec: { p: { h: 26.3, c: 0.192, hd: 14, cd: 0.115 }, pc: { h: 8, c: 0.065 }, s: { h: 140, c: 0.065 }, t: { h: 92, c: 0.090 }, n: { h: 5, c: 0.012 }, d: { h: 40, c: 0.17 },
      blobs: [{ h: 5, c: 0.042 }, { h: 140, c: 0.032 }, { h: 92, c: 0.040 }], accent: 'primary', slider: 'secondary', night: 's', state: VIVID } },
  { id: 'xtangerine', zh: '橘子×海蓝', en: 'Tangerine × Sea Blue', seed: '#b02e00', group: 'clash',
    mood: { zh: '地中海柑橘：橘皮撞一汪海蓝，橄榄叶和黄油般的阳光。', en: 'Mediterranean citrus — peel orange against sea blue, olive leaves, buttery sun.' },
    spec: { p: { h: 35.8, c: 0.173, cd: 0.12 }, pc: { h: 45, c: 0.07 }, s: { h: 225, c: 0.070 }, t: { h: 125, c: 0.080 }, n: { h: 85, c: 0.014 }, d: { h: 12, c: 0.20 },
      blobs: [{ h: 85, c: 0.048 }, { h: 225, c: 0.034 }, { h: 125, c: 0.034 }], accent: 'primary', slider: 'secondary', night: 's', state: VIVID } },
  { id: 'xamber', zh: '琥珀×梅子', en: 'Amber × Plum', seed: '#825500', group: 'clash',
    mood: { zh: '午后蜂蜜与无花果：琥珀配梅子紫，一片灰青的无花果叶。', en: 'Honey and figs in afternoon light — amber, ripe plum, a grey-teal fig leaf.' },
    spec: { p: { h: 73.8, c: 0.103, cd: 0.11 }, s: { h: 345, c: 0.070 }, t: { h: 180, c: 0.060 }, n: { h: 85, c: 0.012 }, d: { h: 25, c: 0.19 },
      blobs: [{ h: 85, c: 0.046 }, { h: 345, c: 0.032 }, { h: 180, c: 0.030 }], accent: 'primary', slider: 'secondary', night: 's', state: WARM } },
  { id: 'xmatcha', zh: '抹茶×焙茶', en: 'Matcha × Hojicha', seed: '#3c6a00', group: 'clash',
    mood: { zh: '茶席：抹茶绿配焙茶陶杯的暖褐，窗外一串紫藤。', en: 'Tea ceremony — matcha with a warm hojicha cup and wisteria at the window.' },
    spec: { p: { h: 132.8, c: 0.133, cd: 0.12 }, s: { h: 50, c: 0.070 }, t: { h: 290, c: 0.065 }, n: { h: 100, c: 0.012 }, d: { h: 27, c: 0.19 },
      blobs: [{ h: 100, c: 0.042 }, { h: 50, c: 0.032 }, { h: 290, c: 0.034 }], accent: 'primary', slider: 'secondary', night: 't', state: WARM } },
  { id: 'xteal', zh: '青碧×樱桃', en: 'Teal × Cherry', seed: '#00696b', group: 'clash',
    mood: { zh: '翡翠泻湖：青碧海水里落一颗樱桃红（只做小点缀），天边长春花蓝与淡紫。', en: 'Jade lagoon — teal water with a single cherry-red accent, periwinkle sky, a lilac horizon.' },
    spec: { p: { h: 197.1, c: 0.080, cd: 0.09 }, s: { h: 22, c: 0.120 }, t: { h: 272, c: 0.070 }, n: { h: 290, c: 0.010 }, d: { h: 35, c: 0.19 },
      blobs: [{ h: 290, c: 0.038 }, { h: 197, c: 0.034 }, { h: 15, c: 0.026 }], accent: 'primary', slider: 'secondary', night: 't', state: STD } },
  { id: 'xindigo', zh: '靛蓝×霓虹粉', en: 'Indigo × Neon Pink', seed: '#3d4fd3', group: 'clash',
    mood: { zh: '夜墨与霓虹晨光：靛蓝撞霓虹粉，天边一线杏色，雾是丁香紫。', en: 'Night ink meets neon dawn — indigo against neon pink, an apricot horizon, lilac haze.' },
    spec: { p: { h: 271, c: 0.202, cd: 0.11 }, s: { h: 350, c: 0.095 }, t: { h: 60, c: 0.090 }, n: { h: 290, c: 0.012 }, d: { h: 25, c: 0.19 },
      blobs: [{ h: 290, c: 0.044 }, { h: 350, c: 0.034 }, { h: 60, c: 0.030 }], accent: 'primary', slider: 'secondary', night: 'p', state: VIVID } },
  { id: 'xorchid', zh: '兰紫×石板灰', en: 'Orchid × Slate', seed: '#a62092', group: 'clash',
    mood: { zh: '热带兰花：洋红兰瓣衬一片柔和的石板灰，花心一点金。', en: 'Tropical orchid — magenta petals on soft slate grey, a gold heart.' },
    spec: { p: { h: 335.3, c: 0.203, cd: 0.12 }, pc: { h: 335, c: 0.075 }, s: { h: 255, c: 0.032 }, t: { h: 85, c: 0.090 }, n: { h: 330, c: 0.011 }, d: { h: 27, c: 0.19 },
      blobs: [{ h: 330, c: 0.042 }, { h: 255, c: 0.022 }, { h: 85, c: 0.034 }], accent: 'primary', slider: 'secondary', night: 's', state: VIVID } },
  { id: 'xdustyblue', zh: '雾霾蓝×芥末黄', en: 'Dusty Blue × Mustard', seed: '#78909c', group: 'clash',
    mood: { zh: '阴天的旧牛仔：雾霾蓝撞一道芥末黄，口袋边一点鼠尾草绿。', en: 'Overcast denim — dusty blue against a mustard stripe, a hint of sage.' },
    spec: { p: { h: 229.5, c: 0.033, lc: 0.048, cd: 0.055, fit: true }, pc: { h: 229.5, c: 0.032 }, s: { h: 87, c: 0.100 }, t: { h: 150, c: 0.050 }, n: { h: 240, c: 0.009 }, d: { h: 27, c: 0.19 },
      blobs: [{ h: 240, c: 0.030 }, { h: 87, c: 0.040 }, { h: 150, c: 0.026 }], accent: 'primary', slider: 'secondary', night: 'p', state: STD } },
  { id: 'xmustard', zh: '芥末黄×雾霾蓝', en: 'Mustard × Dusty Blue', seed: '#d4a72c', group: 'clash',
    mood: { zh: '复古毛衣：芥末黄撞雾霾蓝，袖口一圈干枯玫瑰。', en: 'Vintage knit — mustard against dusty blue, a dusty-rose cuff.' },
    spec: { p: { h: 87.1, c: 0.141, lc: 0.110, cd: 0.12, fit: true }, pc: { h: 87, c: 0.070 }, s: { h: 230, c: 0.050 }, t: { h: 18, c: 0.065 }, n: { h: 90, c: 0.013 }, d: { h: 27, c: 0.19 },
      blobs: [{ h: 90, c: 0.048 }, { h: 230, c: 0.030 }, { h: 18, c: 0.028 }], accent: 'primary', slider: 'secondary', night: 's', state: WARM } },
  { id: 'xsage', zh: '鼠尾草绿×干枯玫瑰', en: 'Sage × Dusty Rose', seed: '#9caf88', group: 'clash',
    mood: { zh: '香草小园：鼠尾草绿撞干枯玫瑰，篱笆刷着灰蓝漆。', en: 'Herb garden — sage against dried rose, a fence in dusty-blue paint.' },
    spec: { p: { h: 128.9, c: 0.059, lc: 0.070, cd: 0.07, fit: true }, pc: { h: 128.9, c: 0.045 }, s: { h: 18, c: 0.065 }, t: { h: 245, c: 0.050 }, n: { h: 110, c: 0.010 }, d: { h: 27, c: 0.19 },
      blobs: [{ h: 110, c: 0.034 }, { h: 18, c: 0.032 }, { h: 245, c: 0.026 }], accent: 'primary', slider: 'secondary', night: 't', state: STD } },
  { id: 'xdustyrose', zh: '干枯玫瑰×鼠尾草绿', en: 'Dusty Rose × Sage', seed: '#d8a7a7', group: 'clash',
    mood: { zh: '夹在书里的花：干枯玫瑰配鼠尾草绿，纸页透出一点淡紫。', en: 'Pressed flowers — dried rose with sage leaves and a faint lilac page.' },
    spec: { p: { h: 18.5, c: 0.058, lc: 0.085, cd: 0.075, fit: true }, pc: { h: 15, c: 0.045 }, s: { h: 135, c: 0.055 }, t: { h: 310, c: 0.060 }, n: { h: 20, c: 0.011 }, d: { h: 30, c: 0.19 },
      blobs: [{ h: 20, c: 0.036 }, { h: 135, c: 0.028 }, { h: 310, c: 0.030 }], accent: 'primary', slider: 'secondary', night: 't', state: STD } },
  { id: 'xgraphite', zh: '石墨×湖蓝', en: 'Graphite × Lake Blue', seed: '#5e5e5e', group: 'clash',
    mood: { zh: '铅笔与钢：近乎单色的石墨灰，只留默认色的湖蓝做点睛。', en: 'Pencil and steel — near-monochrome graphite with the default lake blue as its one accent.' },
    spec: { p: { h: 250, c: 0.0, cd: 0.004 }, pc: { h: 250, c: 0.006 }, s: { h: 250, c: 0.012 }, t: { h: 245.4, c: 0.090 }, n: { h: 250, c: 0.004 }, d: { h: 25, c: 0.18 },
      blobs: [{ h: 250, c: 0.010 }, { h: 245, c: 0.022 }, { h: 250, c: 0.006 }], accent: 'tertiary', slider: 'tertiary', night: 'p', state: MONO } },
];

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

/** 撞色色块（设置风格页 + 快捷面板）上面三条色带：种子本色 + 辅色 / 第三色的本色中间调，亮暗共用（不审计、不压深；
 *  下面几条浅色 / 深色容器带仍取各模式的角色）。gen-palettes 写进 palette-roles.json 的 presets[id].swatch。
 *  @param {string} id @returns {{p:string,s:string,t:string}|null} */
export function swatchTones(id) {
  const x = PRESETS.find((p) => p.id === id);
  if (!x) return null;
  return { p: x.seed, s: displayTone(x.spec.s), t: displayTone(x.spec.t) };
}

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

/** @param {string} seed #rrggbb @returns {{light:Object<string,any>, dark:Object<string,any>, lightState:any, darkState:any, derivedFrom:string, seedPrimary:string}} */
export function rolesFor(seed) {
  const spec = deriveSpec(seed, PRESET_LIST.filter((x) => x.group === 'mono'));
  return { light: buildMode(spec, "light"), dark: buildMode(spec, "dark"),
    lightState: spec.state.light, darkState: spec.state.dark, derivedFrom: spec.derivedFrom, seedPrimary: spec.seedPrimary };
}

/** 预设 id → 角色表（单测用来和 JSON 对照） */
export function presetRoles(id) {
  const p = PRESET_LIST.find((x) => x.id === id);
  if (!p) return null;
  return { light: buildMode(p.spec, "light"), dark: buildMode(p.spec, "dark"), lightState: p.spec.state.light, darkState: p.spec.state.dark };
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
  return `html:root{--sgx-seed: ${seed};${roleDecls(r.light, r.lightState).join("")}}` +
    `html:root.dark{${roleDecls(r.dark, r.darkState).join("")}}`;
}

export { PRESETS, deriveSpec, build, audit, contrast, hexToOklch };
/* @sgx-shell:end */
