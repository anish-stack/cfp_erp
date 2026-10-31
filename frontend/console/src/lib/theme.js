/** hex → "h s% l%" (shadcn CSS var format) */
export function hexToHsl(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

/**
 * Apply a palette at runtime: primary (+ ring, accent tint derived), optional background/sidebar, radius.
 * Missing values keep the CSS defaults from index.css.
 */
export function applyTheme({ primary, background, sidebar, radius } = {}) {
  const root = document.documentElement.style;
  const p = hexToHsl(primary);
  if (p) {
    const [h, s, l] = p;
    root.setProperty('--primary', `${h} ${s}% ${l}%`);
    root.setProperty('--ring', `${h} ${s}% ${l}%`);
    root.setProperty('--primary-foreground', l > 62 ? '222 47% 11%' : '0 0% 100%');
    root.setProperty('--accent', `${h} ${Math.min(s, 60)}% 94%`);
    root.setProperty('--accent-foreground', `${h} ${s}% ${Math.min(l, 25)}%`);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', primary);
  }
  const bg = hexToHsl(background);
  if (bg) root.setProperty('--app-bg', `${bg[0]} ${bg[1]}% ${bg[2]}%`);
  const sb = hexToHsl(sidebar);
  if (sb) root.setProperty('--sidebar', `${sb[0]} ${sb[1]}% ${sb[2]}%`);
  if (radius !== undefined && radius !== null) root.setProperty('--radius', `${Number(radius) / 16}rem`);
}

export const PRESETS = [
  { name: 'CPF Red (default)', primary: '#e21f26', background: '#fff5f5' },
  { name: 'Teal', primary: '#137a6f' },
  { name: 'Ocean blue', primary: '#1d4ed8' },
  { name: 'Indigo', primary: '#4338ca' },
  { name: 'Emerald', primary: '#047857' },
  { name: 'Violet', primary: '#6d28d9' },
  { name: 'Rose', primary: '#be123c' },
  { name: 'Saffron', primary: '#c2410c' },
  { name: 'Slate', primary: '#334155' },
];
