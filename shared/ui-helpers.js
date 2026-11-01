/* ui-helpers.js — small DOM helpers shared by both applications. */
(function (g) {
  'use strict';
  const SOI = (g.SOI = g.SOI || {});

  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtInt = (n) => (n === null || n === undefined || n === '' || Number.isNaN(n) ? '—' : Math.round(n).toLocaleString('en-US'));
  const fmtNum = (n, d = 2) => (n === null || n === undefined || Number.isNaN(n) ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const fmtPct = (n, d = 2) => (n === null || n === undefined || Number.isNaN(n) ? '—' : Number(n).toFixed(d) + '%');
  const fmtUSD = (n) => {
    if (n === null || n === undefined || Number.isNaN(n)) return '—';
    const a = Math.abs(n);
    if (a >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    return '$' + Math.round(n).toLocaleString('en-US');
  };
  const fmtShares = (n) => {
    if (n === null || n === undefined || Number.isNaN(n)) return '—';
    const a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    return Math.round(n).toLocaleString('en-US');
  };
  const famBadge = (fam, label) => `<span class="badge b-${esc(fam)}">${esc(label || (SOI.models.FORM_FAMILIES[fam] || {}).label || fam)}</span>`;
  const statusBadge = (s) => {
    const cls = { valid: 'b-ok', warnings: 'b-warn', errors: 'b-err', reported: 'b-reported', inferred: 'b-inferred', calculated: 'b-calculated' }[s] || 'b-neutral';
    return `<span class="badge ${cls}">${esc(s)}</span>`;
  };
  const secLink = (url, text) => (url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(text || 'SEC')}</a>` : esc(text || ''));
  const filingIndexUrl = (rec) => {
    const acc = rec.filing ? rec.filing.accessionNumber : rec.accessionNumber;
    const cik = rec.filing ? (rec.filing.formFamily === '13F' ? rec.filing.filerCik : rec.issuer.cik || rec.filing.filerCik) : rec.cik;
    if (!acc || !cik) return '';
    return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc.replace(/-/g, '')}/${acc}-index.htm`;
  };

  /** Collapsible JSON viewer (objects/arrays open to depth `open`). */
  function jsonView(value, open = 2) {
    const render = (v, depth, key) => {
      const k = key !== undefined ? `<span class="j-key">${esc(JSON.stringify(key))}</span>: ` : '';
      if (v === null) return `${k}<span class="j-null">null</span>`;
      if (typeof v === 'string') return `${k}<span class="j-str">${esc(JSON.stringify(v))}</span>`;
      if (typeof v === 'number') return `${k}<span class="j-num">${v}</span>`;
      if (typeof v === 'boolean') return `${k}<span class="j-bool">${v}</span>`;
      const isArr = Array.isArray(v);
      const entries = isArr ? v.map((x, i) => [i, x]) : Object.entries(v);
      if (!entries.length) return `${k}${isArr ? '[]' : '{}'}`;
      const shown = entries.slice(0, 500);
      const inner = shown.map(([kk, vv]) => '<div>' + render(vv, depth + 1, isArr ? undefined : kk) + ',</div>').join('') + (entries.length > 500 ? `<div class="j-null">… ${entries.length - 500} more</div>` : '');
      return `<details${depth < open ? ' open' : ''}><summary>${k}${isArr ? `[ ${entries.length} items` : `{ ${entries.length} keys`}</summary>${inner}<div>${isArr ? ']' : '}'}</div></details>`;
    };
    return `<div class="json">${render(value, 0)}</div>`;
  }

  function modal(title, html, opts = {}) {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-head"><h3>${esc(title)}</h3>${opts.actions || ''}<button data-close>Close</button></div><div class="modal-body">${html}</div></div>`;
    const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    bg.addEventListener('click', (e) => { if (e.target === bg || e.target.hasAttribute('data-close')) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(bg);
    return { el: bg, close };
  }

  function toast(msg, kind = 'info') {
    let host = document.getElementById('toast-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'toast-host';
      host.style.cssText = 'position:fixed;right:16px;bottom:16px;display:flex;flex-direction:column;gap:8px;z-index:200;max-width:420px';
      document.body.appendChild(host);
    }
    const el = document.createElement('div');
    el.className = 'callout ' + (kind === 'error' ? 'err' : kind === 'warn' ? 'warn' : kind === 'ok' ? 'ok' : '');
    el.style.cssText = 'margin:0;box-shadow:0 6px 20px rgba(0,0,0,.15);background:var(--surface)';
    el.textContent = msg;
    host.appendChild(el);
    setTimeout(() => el.remove(), 5000);
  }

  function themeToggle(btn) {
    const apply = (t) => { if (t) document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme'); };
    let t = SOI.storage ? SOI.storage.prefs.get('theme', '') : '';
    apply(t);
    btn.addEventListener('click', () => {
      const dark = t ? t === 'dark' : g.matchMedia && g.matchMedia('(prefers-color-scheme: dark)').matches;
      t = dark ? 'light' : 'dark';
      apply(t);
      if (SOI.storage) SOI.storage.prefs.set('theme', t);
      g.dispatchEvent(new Event('soi-theme'));
    });
  }

  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  SOI.ui = { esc, fmtInt, fmtNum, fmtPct, fmtUSD, fmtShares, famBadge, statusBadge, secLink, filingIndexUrl, jsonView, modal, toast, themeToggle, cssVar };
})(typeof globalThis !== 'undefined' ? globalThis : this);
