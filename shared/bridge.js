/*
 * bridge.js — automatic hand-over of parsed filings from the parser to the dashboard.
 *
 * Browsers may give pages opened from file:// separate storage, so the two apps
 * cannot rely on one shared IndexedDB. Instead, when one app opens the other
 * (window.open), the two windows talk with postMessage:
 *
 *   child  → opener : { soi: 'bridge', type: 'hello', app }
 *   opener → child  : { soi: 'bridge', type: 'hello-ack', app }
 *   parser → dash   : { soi: 'bridge', type: 'records', records: [...] }
 *   dash   → parser : { soi: 'bridge', type: 'ack', count }
 *
 * Only messages from the linked window (the opener, or the window this page
 * opened) are accepted, and records are shape-checked before use.
 */
(function (g) {
  'use strict';
  const SOI = (g.SOI = g.SOI || {});
  const TAG = 'soi-bridge/1';
  let peer = null;
  let app = '';
  const handlers = { connect: [], records: [], ack: [], disconnect: [] };
  const emit = (k, v) => handlers[k].forEach((f) => { try { f(v); } catch (e) { console.error(e); } });

  const post = (msg) => {
    if (!peer || peer.closed) return false;
    try { peer.postMessage(Object.assign({ soi: TAG, app }, msg), '*'); return true; } catch (e) { return false; }
  };

  function isRecord(r) {
    return r && typeof r === 'object' && typeof r.recordId === 'string' && r.filing && r.issuer && r.validation && Array.isArray(r.holdings);
  }

  function init(appName) {
    app = appName;
    g.addEventListener('message', (e) => {
      const m = e.data;
      if (!m || m.soi !== TAG) return;
      const fromOpener = g.opener && e.source === g.opener;
      const fromChild = peer && e.source === peer;
      if (!fromOpener && !fromChild) return;
      if (m.type === 'hello') { peer = e.source; post({ type: 'hello-ack' }); emit('connect', m.app); }
      else if (m.type === 'hello-ack') { peer = e.source; emit('connect', m.app); }
      else if (m.type === 'records' && Array.isArray(m.records)) {
        const ok = m.records.filter(isRecord);
        emit('records', { records: ok, rejected: m.records.length - ok.length });
      } else if (m.type === 'ack') emit('ack', m.count);
    });
    if (g.opener && !g.opener.closed) { peer = g.opener; post({ type: 'hello' }); }
    setInterval(() => { if (peer && peer.closed) { peer = null; emit('disconnect'); } }, 2000);
  }

  /** Open (or focus) the other app as a linked window. */
  function openPeer(url) {
    if (peer && !peer.closed) {
      try { peer.focus(); return peer; } catch (e) { /* fall through */ }
    }
    const w = g.open(url, 'soi-' + (app === 'parser' ? 'dashboard' : 'parser'));
    if (w) peer = w; // the new page says hello once it has loaded
    return w;
  }

  SOI.bridge = {
    init, openPeer,
    on: (k, f) => handlers[k].push(f),
    connected: () => !!(peer && !peer.closed),
    sendRecords: (records) => post({ type: 'records', records }),
    ack: (count) => post({ type: 'ack', count }),
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
