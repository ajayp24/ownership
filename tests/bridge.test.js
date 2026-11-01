/*
 * Tests the parser ↔ dashboard hand-over (shared/bridge.js) with two simulated
 * browser windows, each running its own copy of the module.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const code = fs.readFileSync(path.join(__dirname, '..', 'shared', 'bridge.js'), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 5));

function makeWindow(name) {
  const listeners = [];
  const win = {
    name, closed: false, opener: null, timers: [],
    addEventListener: (t, f) => { if (t === 'message') listeners.push(f); },
    setInterval: () => 0,
    open: null,
    focus() {},
    // postMessage on this window delivers to this window's listeners, from the caller
    postMessage(data) { const source = win._caller; setTimeout(() => listeners.forEach((f) => f({ data, source })), 0); },
  };
  win.globalThis = win;
  return win;
}
function load(win) { vm.runInNewContext(code, Object.assign(win, { console })); return win.SOI.bridge; }

// postMessage needs to know who is sending: wrap so each window records its caller
function link(a, b) {
  const pa = a.postMessage, pb = b.postMessage;
  a.postMessage = (d) => { a._caller = b; pa(d); };
  b.postMessage = (d) => { b._caller = a; pb(d); };
}

const rec = (id) => ({ recordId: id, filing: {}, issuer: {}, validation: {}, holdings: [] });

test('dashboard opens parser: handshake, records delivered, acknowledged, invalid items rejected', async () => {
  const dash = makeWindow('dashboard');
  const parser = makeWindow('parser');
  link(dash, parser);
  const D = load(dash);
  dash.open = () => parser; // window.open returns the new window
  D.init('dashboard');
  const got = [];
  D.on('records', (x) => { got.push(x); D.ack(x.records.length); });
  D.openPeer('sec-filing-parser.html');

  parser.opener = dash; // the browser sets opener on the new window
  const P = load(parser);
  const acks = [];
  P.on('connect', () => P.sendRecords([rec('a'), rec('b'), { bogus: true }]));
  P.on('ack', (n) => acks.push(n));
  P.init('parser');
  for (let i = 0; i < 10; i++) await tick();

  assert.equal(P.connected(), true);
  assert.equal(D.connected(), true);
  assert.equal(got.length, 1);
  assert.deepEqual(got[0].records.map((r) => r.recordId), ['a', 'b']);
  assert.equal(got[0].rejected, 1);
  assert.deepEqual(acks, [2]);
});

test('messages from an unrelated window are ignored', async () => {
  const dash = makeWindow('dashboard');
  const stranger = makeWindow('other');
  link(dash, stranger);
  const D = load(dash);
  D.init('dashboard');
  let received = 0;
  D.on('records', () => received++);
  dash._caller = stranger;
  dash.postMessage({ soi: 'soi-bridge/1', type: 'records', records: [rec('x')] });
  await tick();
  assert.equal(received, 0);
  assert.equal(D.connected(), false);
});
