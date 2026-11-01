/* parser-app.js — UI for the standalone SEC Filing Parser. */
(function () {
  'use strict';
  const { esc, fmtInt, fmtUSD, fmtPct, famBadge, statusBadge, jsonView, toast, modal, secLink } = SOI.ui;
  const DB = SOI.storage.db;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const FAMILIES = [['13F', 'Form 13F-HR / 13F-HR/A'], ['13D', 'Schedule 13D / 13D/A'], ['13G', 'Schedule 13G / 13G/A'], ['FORM3', 'Form 3'], ['FORM4', 'Form 4'], ['FORM5', 'Form 5']];

  const state = { queue: [], active: null, records: [], selected: new Set(), viewerTab: 'summary', storageOk: true };
  let seq = 0;

  // ------------------------------------------------------------ navigation
  function show(view) {
    $$('[data-panel]').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== view));
    $$('.nav-link[data-view]').forEach((a) => a.classList.toggle('active', a.dataset.view === view));
    $('#page-title').textContent = $(`.nav-link[data-view="${view}"]`).textContent.replace(/\d+$/, '').trim();
    SOI.storage.prefs.set('parser.view', view);
    $('#sidenav').classList.remove('open');
    if (view === 'database') renderDb();
    if (view === 'compare') renderCompareOptions();
  }
  $$('.nav-link[data-view]').forEach((a) => a.addEventListener('click', () => show(a.dataset.view)));
  $('#menu-btn').addEventListener('click', () => $('#sidenav').classList.toggle('open'));
  SOI.ui.themeToggle($('#theme-btn'));

  // ------------------------------------------------------------ input
  const drop = $('#drop');
  $('#pick-btn').addEventListener('click', (e) => { e.stopPropagation(); $('#file-input').click(); });
  drop.addEventListener('click', () => $('#file-input').click());
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#file-input').click(); } });
  $('#file-input').addEventListener('change', (e) => { handleFiles([...e.target.files]); e.target.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => handleFiles([...e.dataTransfer.files]));
  $('#clear-queue').addEventListener('click', () => { state.queue = []; state.active = null; renderQueue(); renderViewer(); });

  async function expand(files) {
    const docs = [];
    for (const f of files) {
      if (/\.zip$/i.test(f.name)) {
        try {
          const zip = await JSZip.loadAsync(f);
          const entries = Object.values(zip.files).filter((z) => !z.dir && !/(^|\/)(__MACOSX|\.)/.test(z.name));
          for (const z of entries) {
            if (!/\.(xml|htm|html|txt|csv)$/i.test(z.name)) { toast(`Skipped ${z.name} in ${f.name}: unsupported file type`, 'warn'); continue; }
            const blob = await z.async('blob');
            docs.push({ name: z.name.split('/').pop(), folder: f.name + '/' + z.name.split('/').slice(0, -1).join('/'), text: await blob.text(), blob, size: blob.size });
          }
        } catch (e) { toast(`${f.name}: could not read ZIP (${e.message})`, 'error'); }
      } else if (/\.(xml|htm|html|txt|csv)$/i.test(f.name)) {
        docs.push({ name: f.name, folder: '', text: await f.text(), blob: f, size: f.size });
      } else toast(`${f.name}: unsupported file type`, 'warn');
    }
    return docs;
  }

  async function handleFiles(files) {
    if (!files.length) return;
    const docs = await expand(files);
    docs.forEach((d) => { d.detection = SOI.parsers.detect(d); });
    // Pair 13F cover pages with information tables uploaded in the same batch
    const covers = docs.filter((d) => d.detection.family === '13F' && d.detection.role === 'cover');
    const tables = docs.filter((d) => d.detection.family === '13F' && d.detection.role === 'infoTable');
    const paired = new Set();
    const items = [];
    for (const c of covers) {
      const acc = SOI.parserBase.guessAccession(c.name);
      let t = tables.find((x) => !paired.has(x) && ((acc && SOI.parserBase.guessAccession(x.name) === acc) || (c.folder && x.folder === c.folder)));
      if (!t && covers.length === 1 && tables.length === 1) t = tables[0];
      if (t) paired.add(t);
      items.push({ docs: t ? [c, t] : [c] });
    }
    docs.filter((d) => !covers.includes(d) && !paired.has(d)).forEach((d) => items.push({ docs: [d] }));
    for (const it of items) {
      const q = { id: ++seq, name: it.docs.map((d) => d.name).join(' + '), docs: it.docs, detection: it.docs[0].detection, status: 'pending', record: null, error: '' };
      state.queue.push(q);
    }
    renderQueue();
    for (const q of state.queue.filter((x) => x.status === 'pending')) {
      await processItem(q);
    }
  }

  async function processItem(q, family) {
    const det = q.detection;
    if (!family && (!det.family || det.confidence === 'low')) {
      q.status = 'needs-type';
      renderQueue();
      if (!state.active) select(q.id);
      return;
    }
    q.status = 'parsing';
    renderQueue();
    await new Promise((r) => setTimeout(r, 20)); // let the UI paint before heavy parsing
    try {
      const [main, companion] = q.docs;
      const ctx = { family: family || det.family };
      if (companion) ctx.companion = { name: companion.name, text: companion.text };
      const rec = await SOI.parsers.parse({ name: main.name, text: main.text }, ctx);
      rec.filing.sourceFile = q.name;
      q.record = rec;
      q.status = 'done';
      await persist(rec, q.docs);
      if ($('#auto-send').checked && SOI.bridge.connected()) SOI.bridge.sendRecords([rec]);
    } catch (e) {
      if (e.code === 'AMBIGUOUS') { q.status = 'needs-type'; q.detection = e.detection; }
      else { q.status = 'error'; q.error = e.message; }
    }
    renderQueue();
    if (!state.active || state.active === q.id) select(q.id);
  }

  async function persist(rec, docs) {
    try {
      await DB.putRecords([rec]);
      for (const d of docs) {
        const fileId = `${rec.recordId}|${d.name}`;
        await DB.putFile({ fileId, name: d.name, size: d.size, type: d.blob.type || 'text/plain', uploadedAt: new Date().toISOString(), recordIds: [rec.recordId], blob: d.blob });
      }
      updateCount();
    } catch (e) {
      state.storageOk = false;
      toast('Could not save to IndexedDB: ' + e.message + '. The record is still shown and can be exported.', 'warn');
    }
  }

  // ------------------------------------------------------------ queue + viewer
  function renderQueue() {
    const el = $('#queue');
    if (!state.queue.length) { el.innerHTML = '<div class="empty">No files yet</div>'; return; }
    el.innerHTML = state.queue.map((q) => {
      const r = q.record;
      const st = q.status === 'done' ? statusBadge(r.validation.status) : q.status === 'error' ? '<span class="badge b-err">error</span>' : q.status === 'needs-type' ? '<span class="badge b-warn">choose type</span>' : `<span class="badge b-neutral">${q.status}</span>`;
      const fam = (r && r.filing.formFamily) || q.detection.family;
      return `<div class="q-item ${state.active === q.id ? 'active' : ''}" data-id="${q.id}">
        <div class="q-name">${esc(q.name)}</div>
        <div class="q-meta">${fam ? famBadge(fam, r ? r.filing.formType : q.detection.formType || fam) : ''}${st}<span>${esc(q.detection.format)}</span>${q.detection.confidence ? `<span>detection: ${esc(q.detection.confidence)}</span>` : ''}</div>
        ${q.status === 'parsing' ? '<div class="progress"><div></div></div>' : ''}
      </div>`;
    }).join('');
    $$('.q-item', el).forEach((n) => n.addEventListener('click', () => select(Number(n.dataset.id))));
  }

  function select(id) {
    state.active = id;
    renderQueue();
    renderViewer();
  }

  function renderViewer() {
    const v = $('#viewer');
    const q = state.queue.find((x) => x.id === state.active);
    if (!q) { v.innerHTML = '<div class="empty">Parsed records appear here. Select an item in the queue.</div>'; return; }
    if (q.status === 'needs-type') {
      v.innerHTML = `<h3>${esc(q.name)}</h3>
        <div class="callout warn"><strong>Filing type could not be identified with confidence.</strong><p>${q.detection.reasons.map(esc).join('<br>')}</p></div>
        <div class="toolbar"><label class="inline">Parse as <select id="pick-family">${FAMILIES.map(([k, l]) => `<option value="${k}" ${q.detection.candidates.includes(k) ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <button class="primary" id="parse-as">Parse</button></div>`;
      $('#parse-as').addEventListener('click', () => processItem(q, $('#pick-family').value));
      return;
    }
    if (q.status === 'error') { v.innerHTML = `<h3>${esc(q.name)}</h3><div class="callout err"><strong>Parsing failed.</strong><p>${esc(q.error)}</p></div>`; return; }
    if (!q.record) { v.innerHTML = '<div class="empty">Parsing…</div>'; return; }
    v.innerHTML = recordView(q.record, true);
    bindRecordView(v, q.record);
  }

  // shared by the queue viewer and the database modal
  function recordView(rec, editable) {
    const f = rec.filing, val = rec.validation;
    const tabs = [['summary', 'Summary'], ['data', 'Extracted data'], ['rels', `Relationships (${rec.ownershipRelationships.length})`], ['validation', `Validation (${val.errors.length + val.warnings.length + val.missing.length})`], ['unmapped', `Unmapped (${rec.unmapped.length})`], ['json', 'JSON']];
    return `<div class="card-head"><h2 style="overflow-wrap:anywhere">${esc(f.filerName || f.sourceFile)}</h2>${famBadge(f.formFamily, f.formType)}${statusBadge(val.status)}<div class="spacer"></div>
      <button data-act="send">Send to dashboard</button><button data-act="dl-json">Download JSON</button><button data-act="dl-xlsx">Excel</button></div>
      <div class="tabs">${tabs.map(([k, l]) => `<button class="tab ${state.viewerTab === k ? 'active' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
      <div data-tabbody>${tabBody(rec, state.viewerTab, editable)}</div>`;
  }

  function bindRecordView(root, rec) {
    $$('.tab', root).forEach((t) => t.addEventListener('click', () => {
      state.viewerTab = t.dataset.tab;
      $$('.tab', root).forEach((x) => x.classList.toggle('active', x === t));
      $('[data-tabbody]', root).innerHTML = tabBody(rec, state.viewerTab, true);
      bindMeta(root, rec);
    }));
    $('[data-act="dl-json"]', root).addEventListener('click', () => SOI.storage.exporters.json([rec]));
    $('[data-act="dl-xlsx"]', root).addEventListener('click', () => SOI.storage.exporters.xlsx([rec]));
    $('[data-act="send"]', root).addEventListener('click', () => sendToDashboard([rec]));
    bindMeta(root, rec);
  }

  function bindMeta(root, rec) {
    const btn = $('#meta-save', root);
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const get = (k) => $(`[name="${k}"]`, root).value.trim();
      const M = SOI.models;
      rec.filing.accessionNumber = M.formatAccession(get('accessionNumber'));
      rec.filing.filingDate = M.isoDate(get('filingDate'));
      if ($('[name="reportPeriod"]', root)) rec.filing.reportPeriod = M.isoDate(get('reportPeriod'));
      if ($('[name="issuerTicker"]', root)) rec.issuer.ticker = get('issuerTicker').toUpperCase();
      rec.filing.metadataEditedByUser = true;
      rec.validation.missing = rec.validation.missing.filter((m) => !((m === 'filing.accessionNumber' && rec.filing.accessionNumber) || (m === 'filing.filingDate' && rec.filing.filingDate) || (m === 'filing.reportPeriod' && rec.filing.reportPeriod)));
      rec.ownershipRelationships.forEach((r) => { r.evidence.accessionNumber = rec.filing.accessionNumber; r.evidence.filingDate = rec.filing.filingDate; });
      const oldId = rec.recordId;
      rec.recordId = M.makeRecordId(rec);
      M.finalizeValidation(rec);
      try {
        if (oldId !== rec.recordId) {
          await DB.deleteRecords([oldId]);
          const files = (await DB.listFiles()).filter((x) => x.recordIds.includes(oldId));
          for (const fl of files) { const full = await DB.getFile(fl.fileId); full.recordIds = full.recordIds.map((id) => (id === oldId ? rec.recordId : id)); await DB.putFile(full); }
        }
        await DB.putRecords([rec]);
      } catch (e) { toast('Saved in this view only: ' + e.message, 'warn'); }
      toast('Filing metadata updated', 'ok');
      renderQueue(); renderViewer();
    });
  }

  function tabBody(rec, tab, editable) {
    const f = rec.filing, ext = rec.extension || {};
    if (tab === 'summary') {
      const needMeta = editable && (!f.accessionNumber || !f.filingDate || (f.formFamily === '13F' && !f.reportPeriod));
      return `${rec.detection ? `<div class="callout"><strong>Detected:</strong> ${esc(rec.detection.reasons.join('; '))}${rec.detection.chosenByUser ? ' — <strong>type chosen by user</strong>' : ''}</div>` : ''}
      ${rec.validation.errors.length ? `<div class="callout err"><strong>${rec.validation.errors.length} error(s).</strong> ${esc(rec.validation.errors[0])}</div>` : ''}
      <div class="grid fit2">
        <div><h4>Filing</h4><dl class="facts">
          <dt>Form type</dt><dd>${esc(f.formType)}${f.isAmendment ? ` (amendment${f.amendmentNumber ? ' no. ' + f.amendmentNumber : ''}${f.amendmentType ? ', ' + esc(f.amendmentType) : ''})` : ''}</dd>
          <dt>Accession no.</dt><dd class="mono">${esc(f.accessionNumber) || '<span class="badge b-warn">missing</span>'}</dd>
          <dt>Filing date</dt><dd>${esc(f.filingDate) || '<span class="badge b-warn">unknown</span>'}</dd>
          <dt>${f.formFamily === '13F' ? 'Report period' : f.formFamily.startsWith('FORM') ? 'Period of report' : 'Event date'}</dt><dd>${esc(f.reportPeriod || f.eventDate) || '—'}</dd>
          <dt>Filer</dt><dd>${esc(f.filerName)} ${f.filerCik ? `<span class="mono muted">CIK ${esc(f.filerCik)}</span>` : ''}</dd>
          <dt>Source</dt><dd>${esc(f.sourceFile)} <span class="muted">(${esc(f.sourceFormat)})</span></dd>
          <dt>Parser</dt><dd>${esc(f.parser)}</dd>
        </dl></div>
        <div><h4>${f.formFamily === '13F' ? 'Issuers (from the information table)' : 'Issuer'}</h4>${f.formFamily === '13F' ? issuerList(rec) : `<dl class="facts">
          <dt>Name</dt><dd>${esc(rec.issuer.name) || '—'}</dd><dt>CIK</dt><dd class="mono">${esc(rec.issuer.cik) || '—'}</dd>
          <dt>Ticker</dt><dd>${esc(rec.issuer.ticker) || '—'}</dd><dt>CUSIP</dt><dd class="mono">${esc((rec.issuer.cusips || []).join(', ')) || '—'}</dd></dl>`}
          <h4 style="margin-top:12px">${f.formFamily === '13F' ? 'Managers' : 'Reporting persons'}</h4>
          <div class="small">${(f.formFamily === '13F' ? rec.investmentManagers.map((m) => `${esc(m.name)} <span class="muted">${m.role === 'filingManager' ? '(filing manager)' : '(other included manager #' + (m.sequenceNumber || '?') + ')'}</span>`) : rec.reportingPersons.map((p) => `${esc(p.name)} ${p.cik ? `<span class="mono muted">${esc(p.cik)}</span>` : ''} <span class="muted">${esc((p.roles || p.typeLabels || []).join(', '))}</span>`)).join('<br>') || '—'}</div>
        </div>
      </div>
      ${needMeta ? `<div class="callout warn" style="margin-top:14px"><strong>Some filing metadata is not inside this document.</strong> If you know it (from the EDGAR filing index), enter it here.
        <div class="meta-form"><label>Accession number<input type="text" name="accessionNumber" value="${esc(f.accessionNumber)}" placeholder="0001234567-26-000001"></label>
        <label>Filing date<input type="date" name="filingDate" value="${esc(f.filingDate)}"></label>
        ${f.formFamily === '13F' ? `<label>Report period<input type="date" name="reportPeriod" value="${esc(f.reportPeriod)}"></label>` : `<label>Issuer ticker<input type="text" name="issuerTicker" value="${esc(rec.issuer.ticker)}"></label>`}</div>
        <button class="primary" id="meta-save">Save metadata</button></div>` : ''}`;
    }
    if (tab === 'data') return dataTables(rec);
    if (tab === 'rels') {
      if (!rec.ownershipRelationships.length) return `<div class="empty">${f.formFamily === '13F' ? 'For 13F filings, manager → issuer edges are derived from the holdings rows by the ownership engine (one per issuer), so they are not stored per row here.' : 'No relationships extracted.'}</div>`;
      return `<div class="table-wrap"><table class="data"><tr><th>Type</th><th>From</th><th>To</th><th class="num">Shares</th><th class="num">% of class</th><th>As of</th><th>Status</th><th>Evidence</th></tr>
      ${rec.ownershipRelationships.map((r) => `<tr><td>${esc((SOI.models.RELATIONSHIP_TYPES[r.type] || {}).label || r.type)}</td><td>${esc(r.from.name)}</td><td>${esc(r.to.name)}</td><td class="num">${fmtInt(r.shares)}</td><td class="num">${r.percentOfClass !== null && r.percentOfClass !== undefined ? fmtPct(r.percentOfClass) + ' <span class="muted small">reported</span>' : '—'}</td><td>${esc(r.asOfDate)} <span class="muted small">${esc(r.dateBasis)}</span></td><td>${statusBadge(r.status)} <span class="small muted">${esc(r.confidence)}</span></td><td class="small">${esc(r.evidence.note)}<div class="mono muted">${esc(r.evidence.path)}</div></td></tr>`).join('')}</table></div>`;
    }
    if (tab === 'validation') {
      const v = rec.validation;
      const li = (arr, cls) => arr.map((m) => `<li><span class="badge ${cls}">${cls === 'b-err' ? 'error' : cls === 'b-warn' ? 'warning' : 'missing'}</span> ${esc(m)}</li>`).join('');
      return `<p>Status: ${statusBadge(v.status)}</p>${v.errors.length + v.warnings.length + v.missing.length ? `<ul style="padding-left:18px;line-height:1.9">${li(v.errors, 'b-err')}${li(v.warnings, 'b-warn')}${li(v.missing, 'b-neutral')}</ul>` : '<div class="callout ok">All required fields were found and all checks passed.</div>'}`;
    }
    if (tab === 'unmapped') {
      return `<p class="small muted">Fields present in the document that this parser did not map to a normalized field. They are kept here (and in exports) rather than discarded.</p>
      ${rec.unmapped.length ? `<div class="table-wrap" style="max-height:480px;overflow:auto"><table class="data"><tr><th>Path</th><th>Value</th></tr>${rec.unmapped.map((u) => `<tr><td class="mono small">${esc(u.path)}</td><td class="small">${esc(String(u.value).slice(0, 400))}</td></tr>`).join('')}</table></div>` : '<div class="empty">Every field was mapped.</div>'}`;
    }
    if (tab === 'json') return jsonView(rec, 2);
    return '';
  }

  /** A 13F has no single issuer: each information-table row names one. Group the rows by CUSIP. */
  function issuerList(rec) {
    const by = new Map();
    rec.holdings.forEach((h) => { const e = by.get(h.cusip) || { name: h.issuerName, cusip: h.cusip, value: 0, rows: 0 }; e.value += h.valueUSD || 0; e.rows++; by.set(h.cusip, e); });
    const list = [...by.values()].sort((a, b) => b.value - a.value);
    if (!list.length) return '<p class="small muted">No information table rows, so no issuers. Upload the information table XML together with this cover page.</p>';
    return `<p class="small">This 13F is filed by the manager and lists <strong>${list.length} issuers</strong> in ${rec.holdings.length} rows${rec.extension.holdingsFilter ? ' (filtered)' : ''}. Largest by reported value:</p>
      <div class="table-wrap"><table class="data"><tr><th>Issuer</th><th>CUSIP</th><th class="num">Value</th><th class="num">Rows</th></tr>
      ${list.slice(0, 10).map((e) => `<tr><td>${esc(e.name)}</td><td class="mono small">${esc(e.cusip)}</td><td class="num">${fmtUSD(e.value)}</td><td class="num">${e.rows}</td></tr>`).join('')}</table></div>
      ${list.length > 10 ? `<p class="small muted">…and ${list.length - 10} more on the "Extracted data" tab.</p>` : ''}`;
  }

  function dataTables(rec) {
    const ext = rec.extension || {};
    if (rec.filing.formFamily === '13F') {
      const s = ext.summary || {};
      const rows = rec.holdings.slice(0, 1000);
      return `<div class="grid g4" style="margin-bottom:12px">
        <div class="kpi"><div class="label">Rows</div><div class="value">${fmtInt(rec.holdings.length)}</div><div class="sub">summary page: ${fmtInt(s.tableEntryTotal)}</div></div>
        <div class="kpi"><div class="label">Table value</div><div class="value">${fmtUSD(rec.holdings.reduce((a, h) => a + (h.valueUSD || 0), 0))}</div><div class="sub">unit: ${esc(ext.valueUnit)}</div></div>
        <div class="kpi"><div class="label">Other included managers</div><div class="value">${fmtInt((ext.otherIncludedManagers || []).length)}</div></div>
        <div class="kpi"><div class="label">Report type</div><div class="value" style="font-size:14px">${esc(ext.reportType || '—')}</div></div></div>
        <p class="small muted">Value unit: ${esc(ext.valueUnitReason)}.${ext.holdingsFilter ? ' ' + esc(ext.holdingsFilter.note) : ''}</p>
        <div class="table-wrap" style="max-height:480px;overflow:auto"><table class="data"><tr><th>#</th><th>Issuer</th><th>Class</th><th>CUSIP</th><th class="num">Value (USD)</th><th class="num">Shares / PRN</th><th>Type</th><th>Put/Call</th><th>Discretion</th><th>Other mgrs</th><th class="num">Vote sole</th><th class="num">Shared</th><th class="num">None</th></tr>
        ${rows.map((h) => `<tr><td class="num">${h.row}</td><td>${esc(h.issuerName)}</td><td>${esc(h.titleOfClass)}</td><td class="mono">${esc(h.cusip)}</td><td class="num">${fmtInt(h.valueUSD)}</td><td class="num">${fmtInt(h.shares)}</td><td>${esc(h.sharesType)}</td><td>${esc(h.putCall)}</td><td>${esc(h.investmentDiscretion)}</td><td>${esc(h.otherManagers.join(','))}</td><td class="num">${fmtInt(h.votingAuthority.sole)}</td><td class="num">${fmtInt(h.votingAuthority.shared)}</td><td class="num">${fmtInt(h.votingAuthority.none)}</td></tr>`).join('')}</table></div>
        ${rec.holdings.length > 1000 ? `<p class="small muted">Showing the first 1,000 of ${fmtInt(rec.holdings.length)} rows. Exports include every row.</p>` : ''}
        ${(ext.otherIncludedManagers || []).length ? `<h4 style="margin-top:14px">Other included managers</h4><div class="table-wrap"><table class="data"><tr><th>Seq</th><th>Name</th><th>13F file no.</th><th>CIK</th></tr>${ext.otherIncludedManagers.map((m) => `<tr><td>${m.sequenceNumber}</td><td>${esc(m.name)}</td><td class="mono">${esc(m.form13FFileNumber)}</td><td class="mono">${esc(m.cik)}</td></tr>`).join('')}</table></div>` : ''}`;
    }
    if (ext.type === '13DG') {
      return `<dl class="facts" style="margin-bottom:12px"><dt>Class of securities</dt><dd>${esc(ext.securitiesClassTitle)}</dd><dt>Event date</dt><dd>${esc(ext.eventDate)}</dd>
        ${ext.rulesDesignated && ext.rulesDesignated.length ? `<dt>Rule relied on</dt><dd>${esc(ext.rulesDesignated.join(', '))} ${ext.filerCategories ? '<span class="muted">(' + esc(ext.filerCategories.join(', ')) + ')</span>' : ''}</dd>` : ''}
        <dt>Format</dt><dd>${esc(ext.format)}${ext.heuristic ? ' <span class="badge b-warn">heuristic extraction</span>' : ''}</dd></dl>
        <div class="table-wrap"><table class="data"><tr><th>Reporting person</th><th>Type</th><th class="num">Sole voting</th><th class="num">Shared voting</th><th class="num">Sole dispositive</th><th class="num">Shared dispositive</th><th class="num">Aggregate</th><th class="num">% of class</th></tr>
        ${ext.reportingPersons.map((p) => `<tr><td>${esc(p.name)}${p.cik ? `<div class="mono muted small">${esc(p.cik)}</div>` : ''}</td><td>${esc((p.typeOfReportingPerson || []).join(', '))}</td><td class="num">${fmtInt(p.soleVotingPower)}</td><td class="num">${fmtInt(p.sharedVotingPower)}</td><td class="num">${fmtInt(p.soleDispositivePower)}</td><td class="num">${fmtInt(p.sharedDispositivePower)}</td><td class="num">${fmtInt(p.aggregateAmountOwned)}</td><td class="num">${fmtPct(p.percentOfClass)}</td></tr>`).join('')}</table></div>
        ${ext.purposeOfTransaction ? `<h4 style="margin-top:14px">Item 4 — Purpose of transaction</h4><p class="small" style="white-space:pre-wrap">${esc(ext.purposeOfTransaction.slice(0, 3000))}</p>` : ''}
        ${ext.contractsArrangements ? `<h4>Item 6 — Contracts, arrangements, understandings</h4><p class="small" style="white-space:pre-wrap">${esc(ext.contractsArrangements.slice(0, 2000))}</p>` : ''}
        ${ext.exhibits ? `<h4>Item 7 — Exhibits</h4><p class="small" style="white-space:pre-wrap">${esc(ext.exhibits.slice(0, 1500))}</p>` : ''}`;
    }
    if (ext.type === 'SECTION16') {
      const rowsHtml = (list) => list.map((t) => `<tr><td>${esc(t.securityTitle)}</td><td>${esc(t.transactionDate)}</td><td>${t.code ? `<span class="badge b-neutral" title="${esc(t.codeDescription)}">${esc(t.code)}</span>` : ''}</td><td class="num">${fmtInt(t.shares)}</td><td>${esc(t.acquiredDisposed)}</td><td class="num">${t.pricePerShare !== null ? '$' + t.pricePerShare : '—'}</td><td class="num">${fmtInt(t.sharesOwnedFollowing)}</td><td>${esc(t.directOrIndirect)}${t.natureOfOwnership ? ' — ' + esc(t.natureOfOwnership) : ''}</td><td class="small">${esc((t.footnoteIds || []).join(' '))}</td></tr>`).join('');
      const head = '<tr><th>Security</th><th>Date</th><th>Code</th><th class="num">Shares</th><th>A/D</th><th class="num">Price</th><th class="num">Owned after</th><th>D/I — nature</th><th>Notes</th></tr>';
      return `<dl class="facts" style="margin-bottom:12px"><dt>Reporting owner(s)</dt><dd>${ext.reportingOwners.map((o) => `${esc(o.name)} <span class="muted">(${esc(o.roles.join(', '))})</span>`).join('<br>')}</dd>
        <dt>Period of report</dt><dd>${esc(ext.periodOfReport)}</dd>${ext.aff10b5One !== null ? `<dt>Rule 10b5-1 box</dt><dd>${ext.aff10b5One ? 'Checked' : 'Not checked'}</dd>` : ''}</dl>
        <h4>Table I — Non-derivative securities</h4><div class="table-wrap"><table class="data">${head}${rowsHtml(ext.nonDerivativeTransactions.concat(ext.nonDerivativeHoldings)) || '<tr><td colspan="9" class="muted">None</td></tr>'}</table></div>
        <h4 style="margin-top:14px">Table II — Derivative securities</h4><div class="table-wrap"><table class="data">${head}${rowsHtml(ext.derivativeTransactions.concat(ext.derivativeHoldings)) || '<tr><td colspan="9" class="muted">None</td></tr>'}</table></div>
        ${Object.keys(ext.footnotes).length ? `<h4 style="margin-top:14px">Footnotes</h4><ol class="small" style="padding-left:18px">${Object.entries(ext.footnotes).map(([k, v]) => `<li><strong>${esc(k)}</strong> ${esc(v)}</li>`).join('')}</ol>` : ''}
        ${ext.remarks ? `<h4>Remarks</h4><p class="small">${esc(ext.remarks)}</p>` : ''}`;
    }
    return '<div class="empty">No data</div>';
  }

  // ------------------------------------------------------------ database
  async function loadRecords() {
    try { state.records = await DB.getRecords(); } catch (e) { state.records = []; state.storageOk = false; }
    updateCount();
    return state.records;
  }
  function updateCount() { DB.getRecords().then((r) => { $('#nav-count').textContent = r.length; }).catch(() => {}); }

  function filteredRecords() {
    const q = $('#db-search').value.trim().toLowerCase();
    const form = $('#db-form').value, iss = $('#db-issuer').value, filer = $('#db-filer').value;
    return state.records.filter((r) => {
      if (form && r.filing.formFamily !== form) return false;
      if (iss && (r.issuer.cik || r.issuer.name) !== iss) return false;
      if (filer && !(r.filing.filerName === filer || r.reportingPersons.some((p) => p.name === filer) || r.investmentManagers.some((m) => m.name === filer))) return false;
      if (q) {
        const hay = [r.filing.filerName, r.filing.accessionNumber, r.filing.formType, r.issuer.name, r.issuer.ticker, r.issuer.cik, ...r.reportingPersons.map((p) => p.name), ...r.investmentManagers.map((m) => m.name), ...r.holdings.slice(0, 2000).map((h) => h.issuerName + ' ' + h.cusip)].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  async function renderDb() {
    await loadRecords();
    const issuers = new Map(), filers = new Set();
    state.records.forEach((r) => {
      if (r.issuer.name) issuers.set(r.issuer.cik || r.issuer.name, r.issuer.name);
      if (r.filing.filerName) filers.add(r.filing.filerName);
      r.reportingPersons.forEach((p) => filers.add(p.name));
      r.investmentManagers.forEach((m) => filers.add(m.name));
    });
    const keepI = $('#db-issuer').value, keepF = $('#db-filer').value;
    $('#db-issuer').innerHTML = '<option value="">All issuers</option>' + [...issuers].sort((a, b) => a[1].localeCompare(b[1])).map(([k, n]) => `<option value="${esc(k)}">${esc(n)}</option>`).join('');
    $('#db-filer').innerHTML = '<option value="">All filers / managers / owners</option>' + [...filers].sort().map((n) => `<option>${esc(n)}</option>`).join('');
    $('#db-issuer').value = keepI; $('#db-filer').value = keepF;
    drawDbTable();
  }

  function drawDbTable() {
    const rows = filteredRecords().sort((a, b) => (a.filing.filingDate < b.filing.filingDate ? 1 : -1));
    const t = $('#db-table');
    if (!state.storageOk) { t.innerHTML = '<tr><td><div class="callout warn">IndexedDB is not available here (private window or blocked storage). Records parsed in this session can still be exported from the viewer.</div></td></tr>'; return; }
    if (!rows.length) { t.innerHTML = `<tr><td><div class="empty">${state.records.length ? 'No records match the filters.' : 'No records stored yet. Parse a filing or import a JSON/Excel export.'}</div></td></tr>`; return; }
    t.innerHTML = `<tr><th><input type="checkbox" id="db-all" aria-label="Select all"></th><th>Form</th><th>Filer / reporting person</th><th>Issuer</th><th>Accession</th><th>Filed</th><th>Period / event</th><th class="num">Rows</th><th>Status</th><th>Origin</th></tr>` +
      rows.map((r) => `<tr data-id="${esc(r.recordId)}" class="${state.selected.has(r.recordId) ? 'selected' : ''}"><td><input type="checkbox" data-sel ${state.selected.has(r.recordId) ? 'checked' : ''}></td>
        <td>${famBadge(r.filing.formFamily, r.filing.formType)}</td><td><a href="#" data-open>${esc(r.filing.filerName || r.filing.sourceFile)}</a></td>
        <td>${esc(r.issuer.name || (r.filing.formFamily === '13F' ? 'multiple issuers' : '—'))}</td><td class="mono small">${esc(r.filing.accessionNumber)}</td>
        <td class="nowrap">${esc(r.filing.filingDate)}</td><td class="nowrap">${esc(r.filing.reportPeriod || r.filing.eventDate)}</td><td class="num">${r.holdings.length || r.ownershipRelationships.length}</td>
        <td>${statusBadge(r.validation.status)}</td><td class="small muted">${esc(r.filing.dataOrigin)}</td></tr>`).join('');
    $('#db-all').addEventListener('change', (e) => { rows.forEach((r) => (e.target.checked ? state.selected.add(r.recordId) : state.selected.delete(r.recordId))); drawDbTable(); });
    $$('tr[data-id]', t).forEach((tr) => {
      $('[data-sel]', tr).addEventListener('change', (e) => { e.target.checked ? state.selected.add(tr.dataset.id) : state.selected.delete(tr.dataset.id); tr.classList.toggle('selected', e.target.checked); updateSel(); });
      $('[data-open]', tr).addEventListener('click', (e) => {
        e.preventDefault();
        const rec = state.records.find((r) => r.recordId === tr.dataset.id);
        const m = modal(rec.filing.formType + ' — ' + (rec.filing.filerName || ''), `<div>${recordView(rec, false)}</div>`);
        bindRecordView($('.modal-body', m.el), rec);
      });
    });
    updateSel();
  }
  function updateSel() { $('#db-selected').textContent = `${state.selected.size} selected · ${filteredRecords().length} shown`; }
  ['#db-search', '#db-form', '#db-issuer', '#db-filer'].forEach((s) => $(s).addEventListener('input', drawDbTable));

  const exportSet = () => { const sel = state.records.filter((r) => state.selected.has(r.recordId)); return sel.length ? sel : filteredRecords(); };
  const guard = (fn) => async () => { try { const recs = exportSet(); if (!recs.length) return toast('Nothing to export', 'warn'); const r = await fn(recs); if (r !== 'cancelled') toast(`Exported ${recs.length} record(s)`, 'ok'); } catch (e) { toast('Export failed: ' + e.message, 'error'); } };
  $('#exp-json').addEventListener('click', guard((r) => SOI.storage.exporters.json(r)));
  $('#exp-xlsx').addEventListener('click', guard((r) => SOI.storage.exporters.xlsx(r)));
  $('#exp-csv').addEventListener('click', guard((r) => SOI.storage.exporters.csv(r, $('#exp-csv-table').value)));
  $('#exp-zip').addEventListener('click', guard((r) => SOI.storage.exporters.zip(r)));
  $('#dl-orig').addEventListener('click', async () => {
    const ids = new Set(exportSet().map((r) => r.recordId));
    const files = (await DB.listFiles()).filter((f) => f.recordIds.some((id) => ids.has(id)));
    if (!files.length) return toast('No original files stored for these records (records imported from JSON or bundled SEC data have none; use their SEC links).', 'warn');
    if (files.length === 1) { const f = await DB.getFile(files[0].fileId); return SOI.storage.saveBlob(f.blob, f.name); }
    const zip = new JSZip();
    for (const fl of files) { const f = await DB.getFile(fl.fileId); zip.file(f.name, f.blob); }
    SOI.storage.saveBlob(await zip.generateAsync({ type: 'blob' }), 'original-filings.zip');
  });
  $('#db-delete').addEventListener('click', async () => {
    const ids = [...state.selected];
    if (!ids.length) return toast('Select records to delete first', 'warn');
    const m = modal('Delete records', `<p>Delete ${ids.length} record(s) and their stored original files from this browser? This cannot be undone. Export them first if you may need them.</p><div class="toolbar"><button class="danger" id="confirm-del">Delete ${ids.length}</button></div>`);
    $('#confirm-del', m.el).addEventListener('click', async () => {
      await DB.deleteRecords(ids);
      for (const f of (await DB.listFiles()).filter((x) => x.recordIds.some((id) => ids.includes(id)))) await DB.deleteFile(f.fileId);
      state.selected.clear(); m.close(); toast(`Deleted ${ids.length} record(s)`, 'ok'); renderDb();
    });
  });
  $('#import-input').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try { const recs = await SOI.storage.importFile(f); await DB.putRecords(recs); toast(`Imported ${recs.length} record(s)`, 'ok'); renderDb(); }
    catch (err) { toast('Import failed: ' + err.message, 'error'); }
  });

  // ------------------------------------------------------------ compare
  async function renderCompareOptions() {
    await loadRecords();
    const opts = state.records.filter((r) => ['13F', '13D', '13G'].includes(r.filing.formFamily))
      .sort((a, b) => ((a.filing.filerName + (a.filing.reportPeriod || a.filing.eventDate)) < (b.filing.filerName + (b.filing.reportPeriod || b.filing.eventDate)) ? -1 : 1))
      .map((r) => `<option value="${esc(r.recordId)}">${esc(r.filing.formType)} · ${esc(r.filing.filerName)} · ${esc(r.issuer.name || '')} · ${r.filing.formFamily === '13F' ? 'period' : 'event'} ${esc(r.filing.reportPeriod || r.filing.eventDate)} · filed ${esc(r.filing.filingDate)}</option>`).join('');
    $('#cmp-a').innerHTML = opts; $('#cmp-b').innerHTML = opts;
    if ($('#cmp-b').options.length > 1) $('#cmp-b').selectedIndex = 1;
  }
  $('#cmp-run').addEventListener('click', () => {
    const a = state.records.find((r) => r.recordId === $('#cmp-a').value);
    const b = state.records.find((r) => r.recordId === $('#cmp-b').value);
    const out = $('#cmp-out');
    if (!a || !b || a === b) { out.innerHTML = '<div class="callout warn">Choose two different records.</div>'; return; }
    if ((a.filing.formFamily === '13F') !== (b.filing.formFamily === '13F')) { out.innerHTML = '<div class="callout warn">Both records must be 13F filings, or both Schedule 13D/G filings.</div>'; return; }
    if (a.filing.formFamily === '13F') {
      const warn = a.filing.filerCik !== b.filing.filerCik ? '<div class="callout warn">These filings are from different managers. A period comparison is most meaningful for the same manager.</div>' : '';
      const key = (h) => `${h.cusip}|${h.putCall || ''}|${h.sharesType}`;
      const agg = (r) => { const m = new Map(); r.holdings.forEach((h) => { const k = key(h); const p = m.get(k) || { name: h.issuerName, cls: h.titleOfClass, cusip: h.cusip, pc: h.putCall, shares: 0, value: 0 }; p.shares += h.shares || 0; p.value += h.valueUSD || 0; m.set(k, p); }); return m; };
      const A = agg(a), B = agg(b);
      const keys = [...new Set([...A.keys(), ...B.keys()])];
      const rows = keys.map((k) => { const x = A.get(k), y = B.get(k); const d = (y ? y.shares : 0) - (x ? x.shares : 0); return { k, name: (y || x).name, cls: (y || x).cls, cusip: (y || x).cusip, pc: (y || x).pc, a: x ? x.shares : null, b: y ? y.shares : null, d, st: !x ? 'new' : !y ? 'exited' : d > 0 ? 'increased' : d < 0 ? 'decreased' : 'unchanged' }; })
        .sort((p, q) => Math.abs(q.d) - Math.abs(p.d));
      const counts = rows.reduce((c, r) => ((c[r.st] = (c[r.st] || 0) + 1), c), {});
      out.innerHTML = `${warn}<p><strong>${esc(a.filing.filerName)}</strong> period ${esc(a.filing.reportPeriod)} → <strong>${esc(b.filing.filerName)}</strong> period ${esc(b.filing.reportPeriod)}. ${Object.entries(counts).map(([k, v]) => `<span class="badge b-neutral">${k}: ${v}</span>`).join(' ')}</p>
        ${a.extension.holdingsFilter || b.extension.holdingsFilter ? '<div class="callout warn">At least one record was filtered to selected CUSIPs, so "new"/"exited" only applies to those securities.</div>' : ''}
        <div class="table-wrap" style="max-height:60vh;overflow:auto"><table class="data"><tr><th>Issuer</th><th>Class</th><th>CUSIP</th><th>Put/Call</th><th class="num">Earlier</th><th class="num">Later</th><th class="num">Change</th><th>Status</th></tr>
        ${rows.slice(0, 1500).map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.cls)}</td><td class="mono">${esc(r.cusip)}</td><td>${esc(r.pc)}</td><td class="num">${fmtInt(r.a)}</td><td class="num">${fmtInt(r.b)}</td><td class="num ${r.d > 0 ? 'diff-up' : r.d < 0 ? 'diff-down' : ''}">${r.d > 0 ? '+' : ''}${fmtInt(r.d)}</td><td>${esc(r.st)}</td></tr>`).join('')}</table></div>`;
    } else {
      const people = (r) => new Map(r.extension.reportingPersons.map((p) => [SOI.entities ? p.cik || p.name : p.name, p]));
      const A = people(a), B = people(b);
      const keys = [...new Set([...A.keys(), ...B.keys()])];
      out.innerHTML = `${a.issuer.cik !== b.issuer.cik ? '<div class="callout warn">These filings concern different issuers.</div>' : ''}<p>Event ${esc(a.extension.eventDate)} (${esc(a.filing.formType)}) → event ${esc(b.extension.eventDate)} (${esc(b.filing.formType)})</p>
        <div class="table-wrap"><table class="data"><tr><th>Reporting person</th><th class="num">Earlier shares</th><th class="num">Later shares</th><th class="num">Earlier %</th><th class="num">Later %</th><th>Status</th></tr>
        ${keys.map((k) => { const x = A.get(k), y = B.get(k); return `<tr><td>${esc((y || x).name)}</td><td class="num">${fmtInt(x && x.aggregateAmountOwned)}</td><td class="num">${fmtInt(y && y.aggregateAmountOwned)}</td><td class="num">${fmtPct(x && x.percentOfClass)}</td><td class="num">${fmtPct(y && y.percentOfClass)}</td><td>${!x ? 'new reporting person' : !y ? 'no longer reporting' : ''}</td></tr>`; }).join('')}</table></div>`;
    }
  });

  // ------------------------------------------------------------ formats reference
  $('#formats-card').innerHTML = `<h2>Supported inputs and how they are detected</h2>
    <div class="table-wrap"><table class="data"><tr><th>Filing</th><th>Accepted input</th><th>Detection rule</th><th>Notes</th></tr>
    <tr><td>${famBadge('13F', '13F-HR, 13F-HR/A')}</td><td>primary_doc.xml + information table XML; EDGAR full submission .txt; information table CSV; ZIP</td><td>&lt;edgarSubmission&gt; in the thirteenffiler namespace, or root &lt;informationTable&gt;</td><td>Values are whole dollars for filings from 3 Jan 2023; thousands before. The unit applied is recorded.</td></tr>
    <tr><td>${famBadge('13D', 'SCHEDULE 13D, 13D/A')}</td><td>Structured XML (from Dec 2024); legacy SC 13D HTML/TXT</td><td>edgarSubmission submissionType / schedule13D namespace; text "SCHEDULE 13D"</td><td>Legacy documents are read with text heuristics and flagged for checking.</td></tr>
    <tr><td>${famBadge('13G', 'SCHEDULE 13G, 13G/A')}</td><td>Structured XML (from Dec 2024); legacy SC 13G HTML/TXT</td><td>edgarSubmission submissionType / schedule13g namespace; text "SCHEDULE 13G"</td><td>Rule 13d-1(b)/(c)/(d) basis and Item 5 exit flag are captured.</td></tr>
    <tr><td>${famBadge('FORM3', 'Form 3 / 3/A')}</td><td>ownershipDocument XML; full submission .txt</td><td>&lt;ownershipDocument&gt; with &lt;documentType&gt;3&lt;/documentType&gt;</td><td>Holdings only.</td></tr>
    <tr><td>${famBadge('FORM4', 'Form 4 / 4/A')}</td><td>ownershipDocument XML; full submission .txt</td><td>&lt;documentType&gt;4&lt;/documentType&gt;</td><td>HTML renderings are not parsed; download the .xml from the filing index.</td></tr>
    <tr><td>${famBadge('FORM5', 'Form 5 / 5/A')}</td><td>ownershipDocument XML; full submission .txt</td><td>&lt;documentType&gt;5&lt;/documentType&gt;</td><td>Flags for late Form 3/Form 4 items are captured.</td></tr>
    </table></div>
    <h3 style="margin-top:18px">Where to get the files</h3>
    <p>On EDGAR, open a filing's index page (for example from <a href="https://www.sec.gov/edgar/search/" target="_blank" rel="noopener">EDGAR full-text search</a>) and download the <code>.xml</code> documents, or the complete submission text file (<code>&lt;accession&gt;.txt</code>), which contains every document and the SEC header with the accession number and filing date.</p>
    <h3>Normalized output</h3>
    <p>Every input becomes one JSON record with <code>filing</code>, <code>issuer</code>, <code>reportingPersons</code>, <code>investmentManagers</code>, <code>holdings</code>, <code>ownershipRelationships</code> (each with evidence), a form-specific <code>extension</code>, <code>sourceRefs</code> (XML paths), <code>unmapped</code> fields and <code>validation</code>. See the README for the full schema.</p>`;

  // ------------------------------------------------------------ link to the dashboard (automatic hand-over)
  const B = SOI.bridge;
  B.init('parser');
  const dashUrl = $('#open-dash').getAttribute('href');
  let pending = null;
  const autoBox = $('#auto-send');
  autoBox.checked = SOI.storage.prefs.get('parser.autoSend', true);
  autoBox.addEventListener('change', () => SOI.storage.prefs.set('parser.autoSend', autoBox.checked));
  function linkStatus() {
    const on = B.connected();
    const el = $('#link-status');
    el.textContent = on ? 'Linked to dashboard' : 'Dashboard not linked';
    el.className = 'badge ' + (on ? 'b-ok' : 'b-neutral');
  }
  async function allRecords() {
    const stored = await DB.getRecords().catch(() => []);
    const session = state.queue.filter((q) => q.record).map((q) => q.record);
    return [...new Map(stored.concat(session).map((r) => [r.recordId, r])).values()];
  }
  function sendToDashboard(records) {
    if (!records.length) return toast('Nothing to send yet — parse a filing first', 'warn');
    if (B.connected()) { B.sendRecords(records); toast(`Sending ${records.length} record(s) to the dashboard…`); }
    else { pending = records; B.openPeer(dashUrl + '#/data'); toast('Opening the dashboard…'); }
  }
  B.on('connect', async () => {
    linkStatus();
    const recs = pending || (await allRecords());
    pending = null;
    if (recs.length) B.sendRecords(recs);
  });
  B.on('ack', (n) => toast(`Dashboard received ${n} record(s)`, 'ok'));
  B.on('disconnect', () => { linkStatus(); toast('Dashboard window closed', 'warn'); });
  $('#open-dash').addEventListener('click', (e) => { e.preventDefault(); B.openPeer(dashUrl); });
  $('#send-dash').addEventListener('click', async () => sendToDashboard(await allRecords()));
  $('#db-send').addEventListener('click', () => sendToDashboard(exportSet()));
  linkStatus();

  // ------------------------------------------------------------ boot
  show(SOI.storage.prefs.get('parser.view', 'parse'));
  updateCount();
})();
