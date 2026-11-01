/* dashboard-app.js — routing, data loading and the overview / imported-data pages. */
(function () {
  'use strict';
  const { esc, fmtInt, famBadge, toast } = SOI.ui;
  const DATA = window.SOI_SEC_DATA || null;
  const view = document.getElementById('view');
  const CLASS_LABELS = {
    '02079K305': 'Class A (GOOGL)', '02079K107': 'Class C (GOOG)',
    '084670702': 'Class B (BRK.B)', '084670108': 'Class A (BRK.A)',
  };

  // ------------------------------------------------------------ state
  const state = Object.assign({ company: {}, includeImported: true }, SOI.storage.prefs.get('dash.state', {}));
  const live = { cys: [], charts: [], imported: [] };
  const today = new Date().toISOString().slice(0, 10);

  const issuers = (DATA ? DATA.companies : []).map((c) => Object.assign({}, c, {
    name: c.name, displayName: c.displayName, ticker: c.ticker, classLabels: CLASS_LABELS,
  }));

  const bundled = DATA ? DATA.records : [];
  const bundledAcc = new Set(bundled.map((r) => `${r.filing.accessionNumber}|${r.filing.formFamily}`));
  let duplicatesSkipped = 0;

  const ctx = {
    today,
    bundledRecords: () => bundled,
    importedCount: () => live.imported.length,
    records(includeImported) {
      if (!includeImported || !live.imported.length) return bundled;
      duplicatesSkipped = 0;
      const extra = live.imported.filter((r) => {
        const dup = r.filing.accessionNumber && bundledAcc.has(`${r.filing.accessionNumber}|${r.filing.formFamily}`);
        if (dup) duplicatesSkipped++;
        return !dup;
      });
      return bundled.concat(extra);
    },
    track(cy) { live.cys.push(cy); },
    trackChart(c) { live.charts.push(c); },
    saveState() { SOI.storage.prefs.set('dash.state', state); },
  };

  function cleanup() {
    live.cys.forEach((c) => { try { c.destroy(); } catch (e) { /* already gone */ } });
    live.charts.forEach((c) => { try { c.destroy(); } catch (e) { /* already gone */ } });
    live.cys = []; live.charts = [];
  }

  async function loadImported() {
    try { live.imported = await SOI.storage.db.getRecords(); } catch (e) { live.imported = []; }
    document.getElementById('nav-imported').textContent = live.imported.length;
  }

  // ------------------------------------------------------------ chrome
  const navLink = (c) => `<a class="nav-link" href="#/company/${encodeURIComponent(c.ticker)}" data-route="company/${esc(c.ticker)}">${esc(c.displayName.replace(/,? Inc\.?$|,? Corporation$| Corp$|\.com, Inc\.$/, ''))}<span class="tk">${esc(c.ticker)}</span></a>`;
  const large = issuers.filter((c) => c.size !== 'small'), small = issuers.filter((c) => c.size === 'small');
  document.getElementById('nav-companies').innerHTML = large.map(navLink).join('') + (small.length ? '<div class="nav-group">Small companies</div>' + small.map(navLink).join('') : '');
  const sel = document.getElementById('company-select');
  sel.innerHTML = '<option value="">Go to company…</option>' + issuers.map((c) => `<option value="${esc(c.ticker)}">${esc(c.ticker)} · ${esc(c.displayName)}</option>`).join('');
  sel.addEventListener('change', () => { if (sel.value) location.hash = '#/company/' + encodeURIComponent(sel.value); });
  document.getElementById('menu-btn').addEventListener('click', () => document.getElementById('sidenav').classList.toggle('open'));
  SOI.ui.themeToggle(document.getElementById('theme-btn'));
  window.addEventListener('soi-theme', () => route());
  const badge = document.getElementById('data-badge');
  if (DATA) { badge.textContent = `SEC EDGAR data · retrieved ${DATA.generatedAt.slice(0, 10)}`; badge.className = 'badge b-reported'; }
  else { badge.textContent = 'No SEC data loaded'; badge.className = 'badge b-warn'; }

  // ------------------------------------------------------------ router
  async function route() {
    cleanup();
    const parts = (location.hash.replace(/^#\/?/, '') || 'home').split('/').map(decodeURIComponent);
    const [top, a, b] = parts;
    document.querySelectorAll('.nav-link[data-route]').forEach((l) => {
      const r = l.dataset.route;
      l.classList.toggle('active', r === parts.slice(0, r.split('/').length).join('/'));
    });
    document.getElementById('sidenav').classList.remove('open');
    window.scrollTo(0, 0);
    const title = (t) => { document.getElementById('page-title').textContent = t; document.title = t + ' · Ownership Intelligence'; };
    if (top === 'learn') {
      const fn = { terms: SOI.learnViews.terms, relationships: SOI.learnViews.relationships, filings: SOI.learnViews.filings }[a] || SOI.learnViews.terms;
      title({ terms: 'Ownership terminology', relationships: 'Relationship models', filings: 'SEC filing types' }[a] || 'Ownership terminology');
      return fn(view, b, ctx);
    }
    if (top === 'company') {
      const iss = issuers.find((c) => c.ticker === a);
      if (!iss) return notFound();
      sel.value = iss.ticker;
      title(`${iss.displayName} · ${iss.ticker}`);
      const st = state.company[iss.ticker] || (state.company[iss.ticker] = { tab: 'overview' });
      st.includeImported = st.includeImported !== undefined ? st.includeImported : true;
      return SOI.companyViews.render(view, ctx, iss, st);
    }
    if (top === 'issuer') {
      const imp = importedIssuer(a);
      if (!imp) return notFound();
      title(imp.name);
      const st = state.company['imp:' + a] || (state.company['imp:' + a] = { tab: 'overview', includeImported: true });
      st.includeImported = true;
      return SOI.companyViews.render(view, ctx, imp, st);
    }
    if (top === 'explain') { title('One company, explained'); return SOI.explainView.render(view, ctx, issuers, a || 'AAPL'); }
    if (top === 'network') { title('Ownership network'); return SOI.networkView.render(view, ctx, issuers, a || state.netKey || 'AAPL', state); }
    if (top === 'data') { title('Imported data'); return dataPage(); }
    sel.value = '';
    title('Overview');
    return home();
  }
  function notFound() { view.innerHTML = '<div class="empty">Page not found. <a href="#/home">Back to overview</a></div>'; }
  window.addEventListener('hashchange', route);

  // ------------------------------------------------------------ home
  function home() {
    const counts = {};
    bundled.forEach((r) => { counts[r.filing.formFamily] = (counts[r.filing.formFamily] || 0) + 1; });
    const per = (cik, fams) => bundled.filter((r) => fams.includes(r.filing.formFamily) && r.issuer.cik === cik).length;
    const card = (c) => `<a class="company-card" href="#/company/${encodeURIComponent(c.ticker)}"><div class="tk">${esc(c.ticker)}</div><div class="nm">${esc(c.displayName)}</div>
        <div class="meta"><span>CIK</span><span class="mono">${esc(c.cik)}</span><span>Exchange</span><span>${esc(c.exchanges.join(', '))}</span><span>Industry</span><span>${esc(c.sicDescription)}</span>
        <span>13D/G</span><span>${per(c.cik, ['13D', '13G'])} filings</span><span>Forms 3/4/5</span><span>${per(c.cik, ['FORM3', 'FORM4', 'FORM5'])} filings</span></div></a>`;
    view.innerHTML = `
      <div class="hero"><h1>SEC Ownership Intelligence</h1>
        <p>Understand who holds, who owns, who votes and who reports — for the shares of US public companies — using the SEC filings themselves. Every figure links back to its filing, carries its own date, and is kept in its own category: 13F institutional holdings, 13D/G beneficial ownership, and Section 16 insider holdings are never silently added together.</p>
        <div class="steps">
          <a class="step" href="#/learn/terms"><b>1 · Learn the terms</b>Filer, issuer, beneficial owner, manager and nine more.</a>
          <a class="step" href="#/learn/filings"><b>2 · Know the filings</b>13F, 13D, 13G and Forms 3, 4, 5 compared.</a>
          <a class="step" href="#/explain/AAPL"><b>3 · One company, explained</b>A company's real filings read step by step.</a>
          <a class="step" href="../sec-filing-parser/sec-filing-parser.html" data-open-parser><b>4 · Parse your own</b>Upload filings in the parser; they arrive here automatically.</a>
        </div></div>
      ${!DATA ? `<div class="callout err"><strong>No bundled SEC data found.</strong> Run <code>SEC_USER_AGENT="Your Name you@example.com" node tools/fetch-sec-data.js</code> from the project folder (needs internet), then reload. The learning modules work without it.</div>` : ''}
      <div class="card-head"><h2>Large companies</h2><span class="small muted">Counts are filings in the bundled data set about each issuer</span></div>
      <div class="company-grid">${issuers.filter((c) => c.size !== 'small').map(card).join('')}</div>
      ${issuers.some((c) => c.size === 'small') ? `<div class="card-head" style="margin-top:18px"><h2>Small companies</h2><span class="small muted">Fewer institutions, and founders, families or activists often hold large stakes — compare them with the large companies</span></div>
      <div class="company-grid">${issuers.filter((c) => c.size === 'small').map(card).join('')}</div>` : ''}
      ${DATA ? `<div class="grid g2" style="margin-top:16px">
        <div class="card"><h3>Data provenance</h3><dl class="facts">
          <dt>Source</dt><dd>${esc(DATA.source)}</dd><dt>Retrieved</dt><dd>${esc(DATA.generatedAt.replace('T', ' ').slice(0, 16))} UTC</dd>
          <dt>Records</dt><dd>${Object.entries(counts).map(([k, n]) => `${famBadge(k)} ${n}`).join(' ')}</dd>
          <dt>13F managers</dt><dd class="small">${DATA.managers.map((m) => `${esc(m.name)} <span class="muted">(${esc(m.periods.join(', '))})</span>`).join('<br>')}</dd>
          <dt>Requests</dt><dd>${fmtInt(DATA.fetchLog.requests + DATA.fetchLog.cachedResponses)} EDGAR documents${DATA.fetchLog.errors.length ? `; ${DATA.fetchLog.errors.length} not available: <span class="small muted">${esc(DATA.fetchLog.errors.join('; '))}</span>` : ''}</dd></dl>
          <ul class="small">${DATA.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>
        <div class="card"><h3>How the views are built</h3><ol class="small">
          <li>Each filing is parsed into a normalized record that keeps the accession number, dates, XML paths and every unmapped field.</li>
          <li>For a company, the engine collects 13F rows by CUSIP, 13D/G cover pages by issuer CIK and Forms 3/4/5 by issuer CIK.</li>
          <li>13F amendments are resolved (restatements replace; new-holdings amendments add), and positions are compared only between a manager's own reporting periods.</li>
          <li>Percentages: 13D/G use the filer's reported %; 13F % is calculated only with a single-class shares-outstanding figure, and labelled "calc".</li>
          <li>Overlaps (same organisation in 13F and 13G, insiders who also file 13D/G, affiliated managers, joint filers) are listed with their basis and confidence.</li></ol>
          <p class="small muted">Not covered: Form N-PORT fund holdings, proxy-statement ownership tables, short positions. The tool never names an ultimate owner the filings do not establish.</p></div></div>` : ''}`;
  }

  // ------------------------------------------------------------ imported data
  function importedIssuer(key) {
    if (key.startsWith('cusip:')) {
      const cusip = key.slice(6).toUpperCase();
      const row = live.imported.flatMap((r) => r.holdings).find((h) => h.cusip === cusip);
      return { name: row ? row.issuerName : cusip, displayName: row ? row.issuerName : 'CUSIP ' + cusip, cik: '', ticker: '', cusips: [cusip], multiClass: false };
    }
    const list = SOI.ownership.listIssuers(live.imported.concat(bundled));
    const i = list.find((x) => x.cik === key || x.name === key);
    if (!i) return null;
    const known = issuers.find((c) => c.cik === i.cik);
    return known || Object.assign({}, i, { displayName: i.name, multiClass: false });
  }

  async function dataPage() {
    await loadImported();
    const recs = live.imported;
    const list = SOI.ownership.listIssuers(recs);
    const managers = recs.filter((r) => r.filing.formFamily === '13F');
    view.innerHTML = `
      <div class="callout"><strong>Combine your own filings with the bundled data.</strong> Click <strong>Get filings from parser</strong>: the Filing Parser opens linked to this page and every filing it has parsed is sent here automatically, now and whenever you parse more (its <em>Send to dashboard</em> button does the same). If you opened the two files separately, use the parser's Export and the Import button below instead. Imported records are stored only in this browser.</div>
      <div class="card"><div class="toolbar"><button class="primary" id="imp-parser">${SOI.bridge.connected() ? 'Parser linked — open it' : 'Get filings from parser'}</button><label class="btn" for="imp-file">Import JSON / Excel…</label><input type="file" id="imp-file" accept=".json,.xlsx" multiple hidden>
        <button id="imp-refresh">Reload from local database</button><button id="imp-export">Export imported as JSON</button><button class="danger" id="imp-clear">Remove all imported</button>
        <span class="small muted">${recs.length} imported record(s)${duplicatesSkipped ? ` · ${duplicatesSkipped} duplicate(s) of bundled filings are ignored in combined views` : ''}</span></div></div>
      <div class="grid g2">
        <div class="card"><h3>Issuers in imported 13D/G and Forms 3/4/5</h3>${list.length ? `<div class="table-wrap"><table class="data"><tr><th>Issuer</th><th>CIK</th><th>CUSIP</th><th class="num">Records</th><th></th></tr>${list.map((i) => `<tr><td>${esc(i.name)}</td><td class="mono">${esc(i.cik)}</td><td class="mono small">${esc(i.cusips.join(', '))}</td><td class="num">${i.records}</td><td><a href="${issuers.find((c) => c.cik === i.cik) ? '#/company/' + encodeURIComponent(issuers.find((c) => c.cik === i.cik).ticker) : '#/issuer/' + encodeURIComponent(i.cik || i.name)}">Ownership view →</a></td></tr>`).join('')}</table></div>` : '<div class="empty">None yet</div>'}</div>
        <div class="card"><h3>Imported 13F filings</h3>${managers.length ? `<div class="table-wrap"><table class="data"><tr><th>Manager</th><th>Period</th><th class="num">Rows</th></tr>${managers.map((r) => `<tr><td>${esc(r.filing.filerName)}</td><td>${esc(r.filing.reportPeriod)}</td><td class="num">${fmtInt(r.holdings.length)}</td></tr>`).join('')}</table></div>
          <div class="toolbar" style="margin-top:10px"><input type="text" id="cusip-in" placeholder="CUSIP, e.g. 037833100" style="width:200px"><button id="cusip-go">Build ownership view for CUSIP</button></div>` : '<div class="empty">None yet</div>'}</div>
      </div>
      <div class="card"><h3>All imported records</h3>${recs.length ? `<div class="table-wrap" style="max-height:420px;overflow:auto"><table class="data"><tr><th>Form</th><th>Filer</th><th>Issuer</th><th>Accession</th><th>Filed</th><th>Status</th></tr>${recs.map((r) => `<tr><td>${famBadge(r.filing.formFamily, r.filing.formType)}</td><td>${esc(r.filing.filerName)}</td><td>${esc(r.issuer.name || '—')}</td><td class="mono small">${esc(r.filing.accessionNumber)}</td><td>${esc(r.filing.filingDate)}</td><td>${SOI.ui.statusBadge(r.validation.status)}</td></tr>`).join('')}</table></div>` : '<div class="empty">No imported records</div>'}</div>`;
    view.querySelector('#imp-file').addEventListener('change', async (e) => {
      let n = 0;
      for (const f of e.target.files) {
        try { const r = await SOI.storage.importFile(f); await SOI.storage.db.putRecords(r); n += r.length; }
        catch (err) { toast(`${f.name}: ${err.message}`, 'error'); }
      }
      if (n) toast(`Imported ${n} record(s)`, 'ok');
      dataPage();
    });
    view.querySelector('#imp-refresh').addEventListener('click', dataPage);
    view.querySelector('#imp-parser').addEventListener('click', openParser);
    view.querySelector('#imp-export').addEventListener('click', () => (recs.length ? SOI.storage.exporters.json(recs) : toast('Nothing to export', 'warn')));
    view.querySelector('#imp-clear').addEventListener('click', () => {
      if (!recs.length) return;
      const m = SOI.ui.modal('Remove imported records', `<p>Remove all ${recs.length} imported record(s) from this browser's local database? Bundled SEC data is not affected. This also removes them from the Filing Parser's database when both apps share an origin.</p><div class="toolbar"><button class="danger" id="do-clear">Remove ${recs.length}</button></div>`);
      m.el.querySelector('#do-clear').addEventListener('click', async () => { await SOI.storage.db.clearRecords(); m.close(); toast('Imported records removed', 'ok'); dataPage(); });
    });
    const go = view.querySelector('#cusip-go');
    if (go) go.addEventListener('click', () => { const c = view.querySelector('#cusip-in').value.trim(); if (/^[0-9A-Za-z]{9}$/.test(c)) location.hash = '#/issuer/cusip:' + c.toUpperCase(); else toast('Enter a 9-character CUSIP', 'warn'); });
  }

  // ------------------------------------------------------------ boot
  // ------------------------------------------------------------ link to the parser (automatic hand-over)
  const B = SOI.bridge;
  B.init('dashboard');
  const parserUrl = document.getElementById('open-parser').getAttribute('href');
  function openParser() { B.openPeer(parserUrl); }
  function linkStatus() { document.getElementById('link-status').classList.toggle('hidden', !B.connected()); }
  document.getElementById('open-parser').addEventListener('click', (e) => { e.preventDefault(); openParser(); });
  document.addEventListener('click', (e) => { const a = e.target.closest('[data-open-parser]'); if (a) { e.preventDefault(); openParser(); } });
  B.on('connect', linkStatus);
  B.on('disconnect', linkStatus);
  B.on('records', async ({ records, rejected }) => {
    try { await SOI.storage.db.putRecords(records); await loadImported(); }
    catch (e) { // no IndexedDB here: keep them for this session only
      const ids = new Set(records.map((r) => r.recordId));
      live.imported = live.imported.filter((r) => !ids.has(r.recordId)).concat(records);
      document.getElementById('nav-imported').textContent = live.imported.length;
    }
    B.ack(records.length);
    toast(`Received ${records.length} filing(s) from the parser${rejected ? ` (${rejected} invalid item(s) ignored)` : ''}`, 'ok');
    route();
  });

  loadImported().then(route);
})();
