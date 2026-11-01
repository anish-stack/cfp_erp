/** Print a standalone HTML document through a hidden iframe (no popup blocker, no app shell in the print). */
export function printHtml(html) {
  const f = document.createElement('iframe');
  f.setAttribute('aria-hidden', 'true');
  Object.assign(f.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0', visibility: 'hidden' });
  document.body.appendChild(f);
  const doc = f.contentDocument;
  doc.open();
  doc.write(html);
  doc.close();
  const go = () => {
    try { f.contentWindow.focus(); f.contentWindow.print(); } finally { setTimeout(() => f.remove(), 1500); }
  };
  const imgs = [...doc.images].filter((i) => !i.complete);
  if (!imgs.length) return setTimeout(go, 150);
  let left = imgs.length;
  const done = () => { if (--left <= 0) go(); };
  imgs.forEach((i) => { i.onload = done; i.onerror = done; });
  setTimeout(() => { if (left > 0) { left = 0; go(); } }, 3000);
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
