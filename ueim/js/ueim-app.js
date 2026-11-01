/* ueim-app.js — UEIM views. All views read the same masters built by shared/ueim-masters.js. */
(function () {
  'use strict';
  const { esc, fmtInt, fmtUSD, fmtPct, fmtShares, statusBadge, jsonView, modal, toast } = SOI.ui;
  const DATA = window.SOI_SEC_DATA, UE = window.UEIM_DATA;
  const view = document.getElementById('view');
  const today = new Date().toISOString().slice(0, 10);
  if (!DATA || !UE) { view.innerHTML = '<div class="callout err">Data files are missing. Run tools/fetch-sec-data.js and tools/build-ueim-data.js (see README).</div>'; return; }

  const M = SOI.ueim.build({ records: DATA.records, companies: DATA.companies, ueim: UE, asOf: today });
  const ent = (id) => M.byId.get(id);
  const byCik = (cik) => M.byCik.get(cik);
  const filing = (id) => M.filingById.get(id);
  const recById = new Map(M.records.map((r) => [r.recordId, r]));
  const relLabel = Object.fromEntries(M.relTypes.map((t) => [t.code, t]));
  const roleName = Object.fromEntries(M.roles.map((r) => [r.roleCode, r.roleName]));
  const BLK = byCik('0002012383'), BLK_OLD = byCik('0001364742'), AAPL = byCik('0000320193');
  const charts = [];
  let cy = null;

  // ---- All positions: the Position Master plus BlackRock's full 13F table, without counting the
  // overlap twice (the full table repeats the rows already loaded for the demonstration issuers).
  const fb = M.fullBlackRock;
  const posKey = (filingId, cusip, putCall, type) => `${filingId}|${cusip}|${putCall || ''}|${type || 'SH'}`;
  const masterKeys = new Set(M.positions.map((p) => posKey(p.filingId, p.cusip, p.putCall, p.sharesType)));
  const fullAsPositions = fb.positions.map((p, i) => ({
    positionId: 'PB' + String(i + 1).padStart(5, '0'), positionType: '13F', source: 'BlackRock full 13F', filingId: fb.filingId, reportingEntityId: fb.entityId,
    issuerEntityId: p.issuerEntityId, issuerNameAsReported: p.issuerName, cusip: p.cusip, securityClass: p.titleOfClass, putCall: p.putCall, sharesType: p.sharesType,
    shares: p.shares, value: p.valueUSD, investmentDiscretion: [['SOLE', p.discSOLE], ['DFND', p.discDFND], ['OTR', p.discOTR]].filter((x) => x[1]).map((x) => x[0]).join('/'),
    votingAuthority: { sole: p.votingSole, shared: p.votingShared, none: p.votingNone }, beneficialOwnership: null, reportingPeriod: fb.meta.reportPeriod, rows: p.rows,
  }));
  const fullExtra = fullAsPositions.filter((p) => !masterKeys.has(posKey(p.filingId, p.cusip, p.putCall, p.sharesType)));
  const POS = { master: M.positions.map((p) => Object.assign({ source: 'Position Master' }, p)), full: fullAsPositions };
  POS.all = POS.master.concat(fullExtra);
  POS.overlap = fullAsPositions.length - fullExtra.length;
  const bundleFilings = M.filings.filter((f) => f.recordId !== UE.blackrock13G.record.recordId).length;
  const countBy = (arr, fn) => arr.reduce((a, x) => { const k = fn(x); a[k] = (a[k] || 0) + 1; return a; }, {});
  const COUNTS = { entities: M.entities.length, relationships: M.relationships.length, filings: M.filings.length, positions: POS.all.length };

  document.getElementById('data-badge').textContent = `SEC EDGAR · ${DATA.generatedAt.slice(0, 10)}`;
  document.getElementById('data-badge').className = 'badge b-reported';
  SOI.ui.themeToggle(document.getElementById('theme-btn'));
  document.getElementById('menu-btn').addEventListener('click', () => document.getElementById('sidenav').classList.toggle('open'));

  // ------------------------------------------------------------ helpers
  const link = (route, text, cls) => `<a href="#/${route}" class="${cls || ''}">${esc(text)}</a>`;
  const entLink = (e, route) => (e ? `<a href="#/${route || 'entities/entity'}/${e.entityId}">${esc(e.legalName)}</a>` : '—');
  const accLink = (f) => (f ? (f.sourceUrl ? `<a class="mono-s" href="${esc(f.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(f.accessionNumber)}</a>` : `<span class="mono-s">${esc(f.accessionNumber)}</span>`) : '—');
  const indexUrl = (cik, acc) => (cik && acc ? `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc.replace(/-/g, '')}/${acc}-index.htm` : '');
  const rolesOf = (e, ctx) => [...new Set(M.entityRoles.filter((r) => r.entityId === e.entityId && (!ctx || r.contextEntityId === ctx.entityId || r.contextEntityId === null)).map((r) => r.roleCode))];
  const roleChips = (codes) => codes.map((c) => `<span class="chip role" title="${esc(c)}">${esc(roleName[c] || c)}</span>`).join('');
  const typeChip = (e) => `<span class="chip type" title="${esc(e.entityTypeBasis)}">${esc(e.entityType)}</span>`;
  const fam = (f) => (f ? f.formFamily : '');
  const companyOf = (e) => DATA.companies.find((c) => c.cik === e.cik);
  const filingsOf = (e) => M.filings.filter((f) => f.filerEntityId === e.entityId || f.reportingPersonEntityIds.includes(e.entityId));

  /** Generic searchable, paged table. columns: [label, fn(row) → html, {num:true, sort:fn}] */
  function table(el, columns, rows, opts = {}) {
    let page = 0, q = '', sortCol = -1, dir = 1;
    const size = opts.pageSize || 50;
    const draw = () => {
      let list = q ? rows.filter((r) => (opts.text ? opts.text(r) : JSON.stringify(r)).toLowerCase().includes(q)) : rows.slice();
      if (sortCol >= 0 && columns[sortCol][2] && columns[sortCol][2].sort) { const f = columns[sortCol][2].sort; list.sort((a, b) => (f(a) > f(b) ? dir : f(a) < f(b) ? -dir : 0)); }
      const pages = Math.max(1, Math.ceil(list.length / size));
      page = Math.min(page, pages - 1);
      const slice = list.slice(page * size, page * size + size);
      el.querySelector('.tb').innerHTML = `<tr>${columns.map((c, i) => `<th class="${c[2] && c[2].num ? 'num' : ''}" ${c[2] && c[2].sort ? `data-sort="${i}" style="cursor:pointer"` : ''}>${esc(c[0])}${sortCol === i ? (dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr>` +
        (slice.length ? slice.map((r) => `<tr>${columns.map((c) => `<td class="${c[2] && c[2].num ? 'num' : ''}">${c[1](r)}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${columns.length}" class="muted">${esc(opts.empty || 'No rows')}</td></tr>`);
      el.querySelector('.pg').innerHTML = `<span>${fmtInt(list.length)} row(s)</span>${pages > 1 ? `<button data-p="-1" ${page ? '' : 'disabled'}>‹ Prev</button><span>Page ${page + 1} of ${pages}</span><button data-p="1" ${page < pages - 1 ? '' : 'disabled'}>Next ›</button>` : ''}`;
      el.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => { page += Number(b.dataset.p); draw(); }));
      el.querySelectorAll('[data-sort]').forEach((th) => th.addEventListener('click', () => { const i = Number(th.dataset.sort); dir = sortCol === i ? -dir : opts.defaultDir || -1; sortCol = i; draw(); }));
      if (opts.after) opts.after(el);
    };
    el.innerHTML = `${opts.search === false ? '' : `<div class="toolbar"><input type="search" class="tq" placeholder="${esc(opts.placeholder || 'Search…')}" style="flex:1;min-width:200px">${opts.tools || ''}</div>`}
      <div class="table-wrap" style="max-height:${opts.maxHeight || 560}px;overflow:auto"><table class="data tb"></table></div><div class="pager pg"></div>`;
    const tq = el.querySelector('.tq');
    if (tq) tq.addEventListener('input', () => { q = tq.value.trim().toLowerCase(); page = 0; draw(); });
    draw();
  }

  function exportRows(name, rows) {
    return `<button data-exp="${esc(name)}">Export JSON</button><button data-csv="${esc(name)}">CSV</button>`;
  }
  function bindExports(el, name, rows) {
    const j = el.querySelector(`[data-exp="${name}"]`), c = el.querySelector(`[data-csv="${name}"]`);
    if (j) j.addEventListener('click', () => SOI.storage.saveBlob(new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' }), `ueim-${name}.json`));
    if (c) c.addEventListener('click', () => SOI.storage.saveBlob(new Blob([SOI.storage.toCSV(rows.map(flat))], { type: 'text/csv' }), `ueim-${name}.csv`));
  }
  const flat = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v && typeof v === 'object' ? JSON.stringify(v) : v]));

  function entitySelect(list, current, route) {
    return `<select class="ent-sel" data-route="${route}" style="max-width:420px">${list.map((e) => `<option value="${e.entityId}" ${e === current ? 'selected' : ''}>${esc(e.legalName)}${e.cik ? ' · CIK ' + e.cik : ''}</option>`).join('')}</select>`;
  }
  function bindSelect() { view.querySelectorAll('.ent-sel').forEach((s) => s.addEventListener('change', () => { location.hash = `#/${s.dataset.route}/${s.value}`; })); }

  function profileCard(e, extra) {
    const fl = filingsOf(e);
    const dates = fl.map((f) => f.filingDate).filter(Boolean).sort();
    return `<div class="card"><div class="ent-card"><div>
        <div class="ent-name">${esc(e.legalName)}</div>
        <div style="margin:4px 0 8px">${typeChip(e)}${roleChips(rolesOf(e))}</div>
        <dl class="facts">
          <dt>Entity ID</dt><dd class="mono">${esc(e.entityId)}</dd>
          <dt>Normalized name</dt><dd class="mono">${esc(e.normalizedName)}</dd>
          <dt>CIK</dt><dd class="mono">${e.cik ? `${esc(e.cik)} · <a href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${esc(e.cik)}" target="_blank" rel="noopener">EDGAR</a>` : '<span class="muted">not disclosed in the loaded filings</span>'}</dd>
          <dt>Entity type</dt><dd>${esc(e.entityType)} <span class="muted small">— ${esc(e.entityTypeBasis)}</span></dd>
          <dt>Jurisdiction</dt><dd>${e.jurisdiction ? `${esc(e.jurisdiction)} <span class="muted small">— ${esc(e.jurisdictionSource)}</span>` : '<span class="muted">not disclosed</span>'}</dd>
          <dt>Ticker</dt><dd>${esc(e.ticker || '—')}</dd>
          <dt>SEC filer status</dt><dd>${e.edgarProfile && e.edgarProfile.entityType ? `EDGAR entity type "${esc(e.edgarProfile.entityType)}"` : '<span class="muted">not loaded</span>'} · status in this data: <strong>${esc(e.entityStatus)}</strong></dd>
          <dt>Filings in loaded data</dt><dd>${fl.length} · first ${esc(dates[0] || '—')} · latest ${esc(dates[dates.length - 1] || '—')}</dd>
          ${e.otherNames && e.otherNames.length ? `<dt>Also reported as</dt><dd>${esc(e.otherNames.join('; '))}</dd>` : ''}
          ${e.nameHistory && e.nameHistory.length ? `<dt>EDGAR name history</dt><dd class="small">${e.nameHistory.map((n) => `${esc(n.name)} (${esc(n.from)} → ${esc(n.to)})`).join('<br>')}</dd>` : ''}
        </dl></div>
        <div class="small" style="max-width:360px">${extra || ''}
          ${e.sameNameOtherCiks ? `<div class="callout warn" style="margin-top:0"><strong>Same name, different CIK.</strong> ${e.sameNameOtherCiks.map((o) => `${entLink(ent(o.entityId))} (CIK ${esc(o.cik)})`).join(', ')} is a separate legal entity in EDGAR. These filings do not state how the two are related, so they are not merged.</div>` : ''}
          <div class="toolbar" style="margin-top:8px">${link('filer/' + e.entityId, 'Filer view', 'btn')}${rolesOf(e).includes('ISSUER') ? link('ownership/' + e.entityId, 'Ownership view', 'btn') : ''}${rolesOf(e).includes('INSTITUTIONAL_INVESTMENT_MANAGER') ? link('manager/' + e.entityId, 'Manager view', 'btn') : ''}${link('network/' + e.entityId, 'Network', 'btn')}</div>
        </div></div></div>`;
  }

  // ------------------------------------------------------------ 1. Dashboard (with the BlackRock & Apple walkthrough)
  function dashboard() {
    const g = UE.blackrock13G, v = g.verifiedFigures, gf = g.record.filing;
    const b = UE.blackrock13F;
    const fullApple = M.fullBlackRock.positions.find((p) => p.cusip === '037833100' && !p.putCall);
    const nonVoting = v.soleDispositive - v.soleVoting;
    const holders = SOI.ownership.buildIssuerView(M.records, issuerObj(AAPL), {});
    const lp = holders.institutional.periods[0];
    const tile = (href, label, n, sub) => `<a class="kpi kpi-link" href="${href}" title="Open the list of all ${fmtInt(n)} ${label.toLowerCase()}"><div class="label">${label} <span class="go">→</span></div><div class="value">${fmtInt(n)}</div><div class="sub">${sub}</div></a>`;
    const qa = (n, q, verdict, cls, a, ev) => `<div class="qa-card"><div class="qa-q"><span class="n">${n}</span>${q}</div><div class="qa-a">${verdict ? `<span class="verdict ${cls}">${verdict}</span>` : ''}${a}</div>${ev ? `<div class="ev">Source: ${ev}</div>` : ''}</div>`;
    const g13Link = `<a href="${esc(gf.sourceUrl)}" target="_blank" rel="noopener">${esc(gf.formType)} ${esc(gf.accessionNumber)}</a> (filed ${esc(gf.filingDate)}, event date ${esc(g.record.extension.eventDate)})`;
    const f13Link = `<a href="${esc(indexUrl(b.filerCik, b.accessionNumber))}" target="_blank" rel="noopener">${esc(b.formType)} ${esc(b.accessionNumber)}</a> (period ${esc(b.reportPeriod)}, filed ${esc(b.filingDate)})`;
    view.innerHTML = `
      <div class="grid g4" style="margin-bottom:16px">
        ${tile('#/entities', 'Entities', COUNTS.entities, `${countBy(M.entities, (e) => (e.cik ? 'cik' : 'name')).cik || 0} identified by CIK · ${countBy(M.entities, (e) => (e.cik ? 'cik' : 'name')).name || 0} by name only`)}
        ${tile('#/entities/relationships', 'Relationships', COUNTS.relationships, `${new Set(M.relationships.map((r) => r.relationshipType)).size} relationship types · every row has a source filing`)}
        ${tile('#/filings', 'Filings', COUNTS.filings, Object.entries(countBy(M.filings, (f) => (/^FORM/.test(f.formFamily) ? 'Forms 3/4/5' : f.formFamily))).map(([k, n]) => `${k} ${fmtInt(n)}`).join(' · '))}
        ${tile('#/positions', 'Positions', COUNTS.positions, `${fmtInt(POS.master.length)} in the Position Master + ${fmtInt(fullExtra.length)} more from BlackRock's full 13F`)}
      </div>
      <div class="split">
        <div class="card"><h3>Start with the demonstration</h3>
          <div class="toolbar">${link('filer/' + BLK.entityId, 'BlackRock — Filer View', 'btn primary')}${link('ownership/' + AAPL.entityId, 'Apple — Ownership View', 'btn primary')}</div>
          <div class="toolbar">${link('manager/' + BLK.entityId, 'BlackRock — Manager View', 'btn')}${link('network/' + BLK.entityId, 'Relationship Network', 'btn')}${link('quality', 'Data Quality', 'btn')}</div>
          <p class="small muted">Every view reads the same masters: one Entity Master, one Role Master, one Relationship Master, one Filing Master and one Position Master.</p></div>
        <div class="card"><h3>Four questions, four views</h3><dl class="facts">
          <dt>Filer View</dt><dd>What does this reporting entity report?</dd>
          <dt>Ownership View</dt><dd>Who reports ownership or other rights over this issuer's securities?</dd>
          <dt>Manager View</dt><dd>Which funds, portfolios or entities does this manager manage — where documented?</dd>
          <dt>Relationship Network</dt><dd>How are all these entities connected, and through which filings?</dd></dl></div>
      </div>
      <h2 style="margin-top:8px">BlackRock and Apple, explained from the filings</h2>
      <p class="muted small">Two real filings are used: BlackRock's Schedule 13G/A on Apple and BlackRock's latest Form 13F. Every number below is read from them.</p>
      ${qa(1, 'Who is BlackRock?', '', '', `There are <strong>two different legal entities</strong> named BlackRock in these filings:
        <ul><li>${entLink(BLK)} — CIK ${BLK.cik}, ticker ${esc(BLK.ticker || '')}, EDGAR name history: ${BLK.nameHistory.map((n) => esc(n.name) + ' (' + n.from + ' → ' + n.to + ')').join('; ')}. It files the current Form 13F.</li>
        <li>${entLink(BLK_OLD)} — CIK ${BLK_OLD.cik}, called "BlackRock Inc." until ${esc((BLK_OLD.nameHistory.find((n) => n.name === 'BlackRock Inc.') || {}).to || '')}. It filed the 2024 Schedule 13G/A.</li></ul>
        Both are <em>companies</em> (entity type). What they <em>do</em> is a separate question — their roles: investment manager, filer, reporting person, beneficial owner, parent. The filings do not say how the two legal entities relate, so UEIM does not merge them.`, 'EDGAR company records (data.sec.gov/submissions) and the SEC header of each filing')}
      ${qa(2, 'Who is Apple?', '', '', `${entLink(AAPL)} — CIK ${AAPL.cik}, ticker ${esc(AAPL.ticker)}, CUSIP ${esc(AAPL.cusip)}, a public company. In every filing here its role is <strong>issuer</strong>: the company whose common stock is being reported. It does not file these reports itself.`, 'EDGAR company record; CUSIP from the filings')}
      ${qa(3, 'Why does BlackRock appear in Apple\'s ownership disclosures?', '', '', `For two different reasons, in two different filings:
        <ol><li><strong>As a beneficial owner</strong>: the ${esc(gf.formType)} reports that BlackRock (as a <em>${esc(g.item3)}</em>) beneficially owned ${fmtInt(v.aggregate)} Apple shares (${v.percentOfClass}%) on ${esc(g.record.extension.eventDate)}.</li>
        <li><strong>As an institutional investment manager</strong>: its ${esc(b.formType)} lists ${fullApple ? fmtInt(fullApple.shares) : 'n/a'} Apple shares on ${esc(b.reportPeriod)} over which it exercises investment discretion.</li></ol>`, `${g13Link}; ${f13Link}`)}
      ${qa(4, 'Is BlackRock the direct legal owner?', 'Not established', 'partly', `Neither filing says BlackRock holds legal title. Item 6 of the 13G/A says: "${esc(g.item6.slice(0, 260))}${g.item6.length > 260 ? '…' : ''}" — the economic rights belong to others (funds and clients). Legal title is normally held through custodians and nominees, which these filings do not list. UEIM therefore records <em>no</em> DIRECTLY_OWNS relationship for BlackRock.`, g13Link)}
      ${qa(5, 'Is BlackRock the beneficial owner?', 'Yes — as of 31 Dec 2023', 'yes', `In the Rule 13d-3 sense (power to vote or dispose): aggregate <strong>${fmtInt(v.aggregate)}</strong> shares, <strong>${v.percentOfClass}%</strong> of the class, type of reporting person <strong>HC</strong> (parent holding company), filed under Rule 13d-1(b). The loaded data has no later BlackRock 13G on Apple, so this is the latest documented figure, not necessarily today's.`, g13Link)}
      ${qa(6, 'Is BlackRock the investment manager?', 'Yes — as of ' + b.reportPeriod, 'yes', `BlackRock, Inc. (CIK ${b.filerCik}) files Form 13F as an institutional investment manager. For Apple (CUSIP 037833100) it reports ${fullApple ? `${fmtInt(fullApple.shares)} shares, value ${fmtUSD(fullApple.valueUSD)}, investment discretion SOLE ${fmtShares(fullApple.discSOLE)} / DFND ${fmtShares(fullApple.discDFND)} / OTR ${fmtShares(fullApple.discOTR)}, in ${fullApple.rows} information-table rows` : 'n/a'}. Its 13F covers ${fmtInt(b.positions.length)} positions in total and lists ${b.otherIncludedManagers.length} other included managers.`, f13Link)}
      ${qa(7, 'Which entities or funds are managed by BlackRock?', 'Partly documented', 'partly', `Documented: <strong>${g.exhibitA.length} subsidiaries</strong> named in Exhibit A of the 13G/A as having acquired the Apple shares (e.g. ${esc(g.exhibitA.slice(0, 4).map((s) => s.name).join(', '))}), and <strong>${b.otherIncludedManagers.length} other included managers</strong> on the 13F. <strong>Individual funds</strong> (for example a named ETF) are <em>not</em> identified in these filings — that needs fund filings such as Form N-PORT, which are not loaded — so UEIM creates no fund records.`, `${g13Link} Exhibit A; ${f13Link} summary page`)}
      ${qa(8, 'Which entities hold Apple shares?', '', '', `In the loaded filings: ${holders.institutional.byPeriod[lp].length} institutional managers report Apple on Form 13F for ${esc(lp)}, ${holders.beneficial.current.length} reporting person(s) have a current Schedule 13G, and ${holders.insiders.people.length} insiders filed Forms 3/4/5. These are reports of <em>discretion</em>, <em>beneficial ownership</em> and <em>pecuniary interest</em> respectively — different things. ${link('ownership/' + AAPL.entityId, 'See the Ownership View →')}`, 'Filing Master')}
      ${qa(9, 'Who has voting power?', '', '', `Per the 13G/A: BlackRock had <strong>sole voting power over ${fmtInt(v.soleVoting)}</strong> shares and shared voting power over ${fmtInt(v.sharedVoting)}. It could <em>dispose</em> of ${fmtInt(v.soleDispositive)} shares, so for ${fmtInt(nonVoting)} shares it controlled investment decisions but <strong>not the vote</strong> (typically the client keeps it). Per the ${esc(b.reportPeriod)} 13F, voting authority on Apple: sole ${fullApple ? fmtInt(fullApple.votingSole) : 'n/a'}, shared ${fullApple ? fmtInt(fullApple.votingShared) : 'n/a'}, none ${fullApple ? fmtInt(fullApple.votingNone) : 'n/a'}.`, `${g13Link} rows 5–6; ${f13Link} Voting Authority columns`)}
      ${qa(10, 'Who has dispositive power?', '', '', `Per the 13G/A: BlackRock had <strong>sole dispositive power over ${fmtInt(v.soleDispositive)}</strong> shares and shared dispositive power over ${fmtInt(v.sharedDispositive)}. Dispositive power (deciding to sell) and voting power are reported separately and differ.`, `${g13Link} rows 7–8`)}
      ${qa(11, 'Who reports the ownership?', '', '', `The 13G/A was filed by CIK <strong>${esc(g.secHeader.filer.cik)}</strong> ("${esc(g.secHeader.filer.name)}" in the SEC header). Its accession number starts with 0001086364 — the CIK of ${entLink(byCik('0001086364'))} — because that is the entity that transmitted the submission. The 13F is filed by CIK <strong>${esc(b.filerCik)}</strong>. Filer, transmitting entity and reporting person are recorded separately.`, 'SEC header (FILED BY) of each filing')}
      ${qa(12, 'What is the source of each relationship?', '', '', `Every row in the Relationship Master has a source filing, filing date, period or event date, evidence text and a documented/inferred flag. The relationships between the BlackRock entities and Apple:<div id="qa-rels" style="margin-top:8px"></div>`, '')}
      <div class="callout warn"><strong>Why the 13F and 13G numbers differ</strong> (${fullApple ? fmtInt(fullApple.shares) : 'n/a'} vs ${fmtInt(v.aggregate)}): different legal entities (CIK ${b.filerCik} vs ${g.secHeader.filer.cik}), different dates (${esc(b.reportPeriod)} vs ${esc(g.record.extension.eventDate)}) and different tests (investment discretion vs beneficial ownership). UEIM never adds them together.</div>`;
    const rels = M.relationships.filter((r) => (r.fromEntityId === BLK.entityId || r.fromEntityId === BLK_OLD.entityId) && r.toEntityId === AAPL.entityId && (!r.putCall));
    table(view.querySelector('#qa-rels'), relColumns(true), rels, { search: false, pageSize: 20, maxHeight: 360 });
  }

  function relColumns(compact) {
    return [
      ['From', (r) => entLink(ent(r.fromEntityId))],
      ['Relationship', (r) => `<span title="${esc((relLabel[r.relationshipType] || {}).label || '')}">${esc(r.relationshipType)}</span>${(relLabel[r.relationshipType] || {}).isOwnership ? ' <span class="badge b-warn">ownership</span>' : ''}`],
      ['To', (r) => entLink(ent(r.toEntityId))],
      ['Shares', (r) => fmtInt(r.shares), { num: true, sort: (r) => r.shares || 0 }],
      ['%', (r) => (r.ownershipPercentage !== null && r.ownershipPercentage !== undefined ? fmtPct(r.ownershipPercentage) : '—'), { num: true }],
      ['Valid from', (r) => esc(r.validFrom || '—'), { sort: (r) => r.validFrom || '' }],
      ['Valid to', (r) => (r.validTo ? `<span title="${esc(r.closedBy || '')}">${esc(r.validTo)}</span>` : '<span class="muted">open</span>')],
      ['Source', (r) => { const f = filing(r.sourceFilingId); return f ? `${esc(f.formType)} ${accLink(f)}<div class="muted small">filed ${esc(f.filingDate)}</div>` : '—'; }],
      ['Status', (r) => `${statusBadge(r.isInferred ? 'inferred' : 'reported')} <span class="small muted">${esc(r.confidence)}</span>`],
    ].concat(compact ? [] : [['Evidence', (r) => `<span class="small">${esc(r.evidenceText)}</span>`]]);
  }

  /** Banner that ties a list page to the Dashboard tile with the same number. */
  function countBanner(label, n, parts, how) {
    return `<div class="callout count-banner"><div><strong>${fmtInt(n)} ${label}</strong> — the same number as the Dashboard tile.</div>
      <div class="pill-row" style="margin:6px 0">${parts.map(([k, v]) => `<span class="chip">${esc(k)}: <strong>&nbsp;${fmtInt(v)}</strong></span>`).join('')}</div><div class="small">${how}</div></div>`;
  }
  function entityGroups() {
    const roles = new Map();
    M.entityRoles.forEach((r) => { (roles.get(r.entityId) || roles.set(r.entityId, new Set()).get(r.entityId)).add(r.roleCode); });
    return countBy(M.entities, (e) => { const r = roles.get(e.entityId) || new Set(); return r.has('ISSUER') ? 'Issuers' : r.has('INSTITUTIONAL_INVESTMENT_MANAGER') ? '13F managers' : r.has('SUBSIDIARY') ? 'Exhibit A subsidiaries' : r.has('OTHER_INCLUDED_MANAGER') ? 'Other included managers' : (r.has('DIRECTOR') || r.has('EXECUTIVE_OFFICER') || r.has('TEN_PERCENT_OWNER')) ? 'Insiders' : r.has('REPORTING_PERSON') ? '13D/G reporting persons' : r.size ? 'Other roles' : 'EDGAR profile only'; });
  }

  // ------------------------------------------------------------ 2. Entity Master (+ entity detail)
  function entities(sub, id) {
    if (sub === 'entity' && id) return entityDetail(ent(id));
    const tabs = [['entities', 'Entities'], ['roles', 'Role master'], ['entityRoles', 'Entity roles'], ['relTypes', 'Relationship types'], ['relationships', 'Relationship master'], ['securities', 'Security master']];
    const cur = tabs.find((t) => t[0] === sub) ? sub : 'entities';
    const banner = cur === 'entities'
      ? countBanner('entities', COUNTS.entities, Object.entries(entityGroups()), `Every distinct party named in the ${fmtInt(COUNTS.filings)} filings, grouped by its main role (each entity is counted once). Entities with the same CIK are one record; entities without a CIK are merged only when the normalized name is identical. ${countBy(M.entities, (e) => (e.cik ? 'c' : 'n')).c || 0} have a CIK, ${countBy(M.entities, (e) => (e.cik ? 'c' : 'n')).n || 0} are known by name only.`)
      : cur === 'relationships'
        ? countBanner('relationships', COUNTS.relationships, Object.entries(countBy(M.relationships, (r) => (relLabel[r.relationshipType] || {}).category)).map(([k, n]) => [k.toLowerCase(), n]), 'Created from the filings: 13F rows give investment-discretion and voting-authority links per manager, issuer and quarter; each 13D/G cover page gives beneficial-ownership, voting and dispositive links plus joint-filing links; Forms 3/4/5 give insider roles and latest holdings; the 13G/A Exhibit A gives parent/subsidiary links. Each row has its source filing.')
        : '';
    view.innerHTML = `${banner}<div class="tabs">${tabs.map(([k, l]) => `<a class="tab ${k === cur ? 'active' : ''}" href="#/entities/${k}">${l}</a>`).join('')}</div><div id="mt"></div>`;
    const el = view.querySelector('#mt');
    const rowsFor = { entities: M.entities, roles: M.roles, entityRoles: M.entityRoles, relTypes: M.relTypes, relationships: M.relationships, securities: M.securities }[cur];
    const tools = exportRows(cur, rowsFor);
    if (cur === 'entities') {
      const typeSel = `<select class="et"><option value="">All entity types</option>${[...new Set(M.entities.map((e) => e.entityType))].sort().map((t) => `<option>${t}</option>`).join('')}</select>`;
      let rows = M.entities;
      const render = () => table(el.querySelector('#et'), [
        ['Entity ID', (e) => `<span class="mono-s">${e.entityId}</span>`],
        ['Legal name', (e) => entLink(e) + (e.resolution === 'UNRESOLVED_NAME' ? ' <span class="badge b-warn">unresolved</span>' : '')],
        ['Type', (e) => `<span title="${esc(e.entityTypeBasis)}">${esc(e.entityType)}</span>`],
        ['CIK', (e) => `<span class="mono-s">${esc(e.cik || '—')}</span>`], ['Ticker', (e) => esc(e.ticker || '—')], ['Jurisdiction', (e) => esc(e.jurisdiction || '—')],
        ['Roles', (e) => `<span class="small">${esc(rolesOf(e).map((r) => roleName[r]).join(', '))}</span>`],
        ['Status', (e) => `<span class="small">${esc(e.entityStatus)}</span>`], ['Last seen', (e) => esc(e.lastSeen || '—'), { sort: (e) => e.lastSeen || '' }],
      ], rows, { placeholder: 'Search entities…', text: (e) => [e.legalName, e.cik, e.allNames.join(' '), e.entityType].join(' '), tools: typeSel + tools });
      el.innerHTML = '<div id="et"></div>';
      render();
      el.querySelector('.et').addEventListener('change', (ev) => { rows = ev.target.value ? M.entities.filter((e) => e.entityType === ev.target.value) : M.entities; render(); el.querySelector('.et').value = ev.target.value; bindExports(el, cur, rows); });
      bindExports(el, cur, rowsFor);
      return;
    }
    const cols = {
      roles: [['Role ID', (r) => r.roleId], ['Code', (r) => `<span class="mono-s">${r.roleCode}</span>`], ['Name', (r) => esc(r.roleName)], ['Description', (r) => esc(r.description)], ['Entities', (r) => fmtInt(new Set(M.entityRoles.filter((x) => x.roleCode === r.roleCode).map((x) => x.entityId)).size), { num: true }]],
      entityRoles: [['ID', (r) => `<span class="mono-s">${r.entityRoleId}</span>`], ['Entity', (r) => entLink(ent(r.entityId))], ['Role', (r) => esc(roleName[r.roleCode])], ['In context of', (r) => (r.contextEntityId ? entLink(ent(r.contextEntityId)) : '—')], ['Valid from', (r) => esc(r.validFrom || '—')], ['Valid to', (r) => esc(r.validTo || 'open')], ['Sources', (r) => `${r.sourceFilingIds.length} filing(s)`, { num: true }]],
      relTypes: [['Category', (t) => esc(t.category)], ['Code', (t) => `<span class="mono-s">${t.code}</span>`], ['Meaning', (t) => esc(t.label)], ['Is ownership?', (t) => (t.isOwnership ? '<span class="badge b-warn">yes</span>' : 'no')], ['Rows', (t) => fmtInt(M.relationships.filter((r) => r.relationshipType === t.code).length), { num: true }]],
      relationships: relColumns(false),
      securities: [['ID', (s) => `<span class="mono-s">${s.securityId}</span>`], ['CUSIP', (s) => `<span class="mono-s">${esc(s.cusip)}</span>`], ['Issuer', (s) => (s.issuerEntityId ? entLink(ent(s.issuerEntityId)) : esc(s.issuerNameAsReported))], ['Class', (s) => esc(s.securityClass || '—')]],
    }[cur];
    table(el, cols, rowsFor, { tools, placeholder: 'Search…', pageSize: 100 });
    bindExports(el, cur, rowsFor);
  }

  function entityDetail(e) {
    if (!e) { view.innerHTML = '<div class="empty">Entity not found.</div>'; return; }
    const out = M.relationships.filter((r) => r.fromEntityId === e.entityId), inn = M.relationships.filter((r) => r.toEntityId === e.entityId);
    const er = M.entityRoles.filter((r) => r.entityId === e.entityId);
    view.innerHTML = profileCard(e) + `
      <div class="card"><h3>Roles (${er.length})</h3><div id="ed-roles"></div></div>
      <div class="card"><h3>Relationships from this entity (${out.length})</h3><div id="ed-out"></div></div>
      <div class="card"><h3>Relationships to this entity (${inn.length})</h3><div id="ed-in"></div></div>
      <div class="card"><h3>Master record (JSON)</h3>${jsonView(e, 1)}</div>`;
    table(view.querySelector('#ed-roles'), [['Role', (r) => esc(roleName[r.roleCode])], ['In context of', (r) => (r.contextEntityId ? entLink(ent(r.contextEntityId)) : '—')], ['Valid from', (r) => esc(r.validFrom || '—')], ['Valid to', (r) => esc(r.validTo || 'open')], ['Note', (r) => esc(r.note || '')], ['Source filings', (r) => r.sourceFilingIds.slice(0, 3).map((id) => accLink(filing(id))).join(' ') + (r.sourceFilingIds.length > 3 ? ` +${r.sourceFilingIds.length - 3}` : '')]], er, { search: false, pageSize: 30 });
    table(view.querySelector('#ed-out'), relColumns(true), out, { pageSize: 25 });
    table(view.querySelector('#ed-in'), relColumns(true), inn, { pageSize: 25 });
  }

  // ------------------------------------------------------------ 3. Filer View
  const filerList = () => M.entities.filter((e) => filingsOf(e).length).sort((a, b) => filingsOf(b).length - filingsOf(a).length);
  function filer(id) {
    const e = ent(id) || BLK;
    const fl = filingsOf(e);
    const count = (fn) => fl.filter(fn).length;
    const periods = fl.map((f) => f.reportPeriod || f.eventDate).filter(Boolean).sort();
    const isBLK = e === BLK && M.fullBlackRock;
    const pos = isBLK ? M.fullBlackRock.positions : M.positions.filter((p) => p.reportingEntityId === e.entityId && p.positionType === '13F');
    const latest13F = fl.filter((f) => f.formFamily === '13F').sort((a, b) => (a.reportPeriod < b.reportPeriod ? 1 : -1))[0];
    const latestPos = isBLK ? pos : pos.filter((p) => latest13F && p.filingId === latest13F.filingId);
    const issuersReported = isBLK ? new Set(pos.map((p) => p.cusip.slice(0, 6))).size : new Set(latestPos.map((p) => p.cusip.slice(0, 6))).size;
    const stat = (label, val, sub) => `<div class="kpi"><div class="label">${label}</div><div class="value">${val}</div><div class="sub">${sub || ''}</div></div>`;
    view.innerHTML = `<div class="toolbar"><label class="inline">Filer ${entitySelect(filerList(), e, 'filer')}</label></div>
      <div class="callout">Filer View answers: <strong>what has this reporting entity reported to the SEC?</strong> Reporting a position does not make the filer its owner — a 13F reports investment discretion.</div>
      ${profileCard(e)}
      <div class="grid g4" style="margin-bottom:16px">
        ${stat('13F filings', count((f) => f.formFamily === '13F'))}${stat('13D filings', count((f) => f.formFamily === '13D'))}${stat('13G filings', count((f) => f.formFamily === '13G'))}${stat('Amendments', count((f) => /\/A$/.test(f.formType)))}
        ${stat('Issuers reported', fmtInt(issuersReported), isBLK ? 'distinct issuer CUSIP prefixes in the latest 13F' : 'in the loaded 13F rows (filtered to the demo issuers)')}${stat('Latest period / event date', esc(periods[periods.length - 1] || '—'), latest13F ? 'latest 13F period: ' + esc(latest13F.reportPeriod) : '13F period or 13D/G event date')}${stat('Latest filing date', esc(fl.map((f) => f.filingDate).sort().pop() || '—'))}${stat('Forms 3/4/5', count((f) => /^FORM/.test(f.formFamily)))}
      </div>
      <div class="tabs"><button class="tab active" data-t="hold">Reported issuer holdings</button><button class="tab" data-t="files">Filer filing explorer</button><button class="tab" data-t="pos">Position analysis</button></div><div id="ft"></div>`;
    bindSelect();
    const el = view.querySelector('#ft');
    const showTab = (t) => {
      view.querySelectorAll('[data-t]').forEach((b) => b.classList.toggle('active', b.dataset.t === t));
      if (t === 'hold') holdings(el, e, isBLK, latestPos, latest13F);
      if (t === 'files') filerFilings(el, fl);
      if (t === 'pos') positionAnalysis(el, e, isBLK);
    };
    view.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.t)));
    showTab('hold');
  }

  function holdings(el, e, isBLK, rows, latest13F) {
    const meta = isBLK ? M.fullBlackRock.meta : null;
    const head = isBLK
      ? `<p class="small">All ${fmtInt(rows.length)} positions in ${esc(meta.formType)} <a href="${esc(meta.sourceUrl + meta.infoTableFile)}" target="_blank" rel="noopener">${esc(meta.accessionNumber)}</a> — period ${esc(meta.reportPeriod)}, filed ${esc(meta.filingDate)}. ${fmtInt(meta.rowsInTable)} information-table rows were added up per CUSIP. CIK and ticker are shown only where the issuer is resolved in this data (the 13F itself gives only name and CUSIP). Click a resolved issuer to open its Ownership View.</p>`
      : `<p class="small">${latest13F ? `Latest 13F in the loaded data: ${esc(latest13F.formType)} ${accLink(latest13F)}, period ${esc(latest13F.reportPeriod)}. Only rows for the demonstration issuers were loaded for this filer.` : 'No 13F filings for this entity in the loaded data.'}</p>`;
    el.innerHTML = head + '<div id="hold-t"></div>';
    if (isBLK) {
      table(el.querySelector('#hold-t'), [
        ['Issuer (as reported)', (p) => (p.issuerEntityId ? `<a href="#/ownership/${p.issuerEntityId}">${esc(p.issuerName)}</a>` : esc(p.issuerName))],
        ['Ticker', (p) => esc(p.ticker || '—')], ['CIK', (p) => `<span class="mono-s">${esc(p.issuerCik || '—')}</span>`], ['CUSIP', (p) => `<span class="mono-s">${esc(p.cusip)}</span>`],
        ['Class', (p) => esc(p.titleOfClass) + (p.putCall ? ` <span class="badge b-neutral">${esc(p.putCall)}</span>` : '')],
        ['Shares / PRN', (p) => fmtInt(p.shares) + (p.sharesType === 'PRN' ? ' PRN' : ''), { num: true, sort: (p) => p.shares }],
        ['Reported value', (p) => fmtUSD(p.valueUSD), { num: true, sort: (p) => p.valueUSD }],
        ['Discretion', (p) => `<span class="small">${[['SOLE', p.discSOLE], ['DFND', p.discDFND], ['OTR', p.discOTR]].filter((x) => x[1]).map((x) => `${x[0]} ${fmtShares(x[1])}`).join(' · ')}</span>`],
        ['Voting S / Sh / N', (p) => `<span class="small">${fmtShares(p.votingSole)} / ${fmtShares(p.votingShared)} / ${fmtShares(p.votingNone)}</span>`],
        ['Other mgrs', (p) => `<span class="small mono-s" title="Sequence numbers on the summary page">${esc((p.otherManagers || '').split(',').slice(0, 6).join(','))}${(p.otherManagers || '').split(',').length > 6 ? '…' : ''}</span>`],
        ['Rows', (p) => p.rows, { num: true }],
      ], rows, { placeholder: 'Search issuer name or CUSIP…', text: (p) => p.issuerName + ' ' + p.cusip + ' ' + p.ticker, pageSize: 50 });
    } else {
      table(el.querySelector('#hold-t'), positionCols13F(), rows, { pageSize: 50 });
    }
  }
  function positionCols13F() {
    return [
      ['Issuer', (p) => (p.issuerEntityId ? `<a href="#/ownership/${p.issuerEntityId}">${esc(ent(p.issuerEntityId).legalName)}</a>` : esc(p.issuerNameAsReported))],
      ['Ticker', (p) => esc((p.issuerEntityId && ent(p.issuerEntityId).ticker) || '—')], ['CUSIP', (p) => `<span class="mono-s">${esc(p.cusip)}</span>`],
      ['Class', (p) => esc(p.securityClass) + (p.putCall ? ` <span class="badge b-neutral">${esc(p.putCall)}</span>` : '')],
      ['Shares', (p) => fmtInt(p.shares), { num: true, sort: (p) => p.shares || 0 }], ['Reported value', (p) => fmtUSD(p.value), { num: true, sort: (p) => p.value || 0 }],
      ['Discretion', (p) => esc(p.investmentDiscretion || '—')], ['Voting S / Sh / N', (p) => (p.votingAuthority ? `${fmtShares(p.votingAuthority.sole)} / ${fmtShares(p.votingAuthority.shared)} / ${fmtShares(p.votingAuthority.none)}` : '—')],
      ['Period', (p) => esc(p.reportingPeriod), { sort: (p) => p.reportingPeriod }], ['Filing', (p) => accLink(filing(p.filingId))],
    ];
  }
  function filerFilings(el, fl) {
    el.innerHTML = '<div id="ff"></div>';
    filingTable(el.querySelector('#ff'), fl);
  }
  function filingTable(el, rows) {
    const forms = [...new Set(rows.map((f) => f.formFamily))].sort();
    const tools = `<select class="ff-form"><option value="">All form types</option>${forms.map((f) => `<option>${f}</option>`).join('')}</select><label class="inline small">From <input type="date" class="ff-from"></label><label class="inline small">To <input type="date" class="ff-to"></label>`;
    let filtered = rows;
    const cols = [
      ['Form', (f) => esc(f.formType) + (/\/A$/.test(f.formType) ? ' <span class="badge b-neutral">amendment</span>' : '')],
      ['Accession', (f) => accLink(f)], ['Filing date', (f) => esc(f.filingDate || '—'), { sort: (f) => f.filingDate || '' }],
      ['Period / event', (f) => esc(f.reportPeriod || f.eventDate || '—'), { sort: (f) => f.reportPeriod || f.eventDate || '' }],
      ['Filer', (f) => (f.filerEntityId ? entLink(ent(f.filerEntityId)) : '—')],
      ['Issuer', (f) => (f.issuerEntityId ? entLink(ent(f.issuerEntityId)) : f.formFamily === '13F' ? `<span class="muted small">${f.positionCount} position(s)</span>` : '—')],
      ['Reporting person(s)', (f) => `<span class="small">${f.reportingPersonEntityIds.slice(0, 3).map((id) => entLink(ent(id))).join(', ')}${f.reportingPersonEntityIds.length > 3 ? ` +${f.reportingPersonEntityIds.length - 3}` : ''}</span>`],
      ['Document', (f) => esc(f.documentType || '—')], ['Status', (f) => `<span class="small">${esc(f.processingStatus)}</span>`],
      ['', (f) => `<button data-rec="${esc(f.recordId)}">JSON</button>`],
    ];
    const draw = () => {
      table(el.querySelector('.ftab'), cols, filtered, { placeholder: 'Search accession, entity…', text: (f) => [f.formType, f.accessionNumber, f.filerEntityId && ent(f.filerEntityId).legalName, f.issuerEntityId && ent(f.issuerEntityId).legalName].join(' '), pageSize: 50,
        after: (t) => t.querySelectorAll('[data-rec]').forEach((b) => b.addEventListener('click', () => { const r = recById.get(b.dataset.rec) || (UE.blackrock13G.record.recordId === b.dataset.rec ? UE.blackrock13G.record : null); modal('Normalized filing record', r ? jsonView(r, 1) : '<p>Not available</p>'); })) });
    };
    el.innerHTML = `<div class="toolbar">${tools}</div><div class="ftab"></div>`;
    const apply = () => {
      const form = el.querySelector('.ff-form').value, from = el.querySelector('.ff-from').value, to = el.querySelector('.ff-to').value;
      filtered = rows.filter((f) => (!form || f.formFamily === form) && (!from || f.filingDate >= from) && (!to || f.filingDate <= to));
      draw();
    };
    el.querySelectorAll('.ff-form, .ff-from, .ff-to').forEach((x) => x.addEventListener('change', apply));
    draw();
  }

  function positionAnalysis(el, e) {
    const pos = M.positions.filter((p) => p.reportingEntityId === e.entityId);
    const by = new Map();
    pos.filter((p) => p.positionType === '13F' && !p.putCall && p.sharesType !== 'PRN').forEach((p) => { const k = p.cusip; (by.get(k) || by.set(k, []).get(k)).push(p); });
    const hist = [...by.entries()].map(([cusip, list]) => {
      list.sort((a, b) => (a.reportingPeriod < b.reportingPeriod ? 1 : -1));
      const [cur, prev] = list;
      return { cusip, cur, prev, list, issuer: cur.issuerEntityId ? ent(cur.issuerEntityId) : null, delta: prev ? cur.shares - prev.shares : null };
    }).sort((a, b) => (b.cur.value || 0) - (a.cur.value || 0));
    const dg = pos.filter((p) => p.positionType === '13DG');
    el.innerHTML = `<p class="small muted">Historical changes compare this filer's own consecutive 13F periods for the same CUSIP. Values are 13F reported values for each period, not current market values. ${e === BLK ? 'History is available for the demonstration issuers (four quarters were loaded for those CUSIPs).' : ''}</p>
      <h3>13F positions over time</h3><div id="pa-h"></div>
      <h3 style="margin-top:16px">Schedule 13D/G positions (beneficial ownership)</h3><div id="pa-dg"></div>`;
    table(el.querySelector('#pa-h'), [
      ['Issuer', (h) => (h.issuer ? `<a href="#/ownership/${h.issuer.entityId}">${esc(h.issuer.legalName)}</a>` : esc(h.cur.issuerNameAsReported))], ['CUSIP', (h) => `<span class="mono-s">${esc(h.cusip)}</span>`],
      ['Latest period', (h) => esc(h.cur.reportingPeriod)], ['Shares', (h) => fmtInt(h.cur.shares), { num: true, sort: (h) => h.cur.shares }],
      ['Previous', (h) => (h.prev ? `${fmtInt(h.prev.shares)} <span class="muted small">${esc(h.prev.reportingPeriod)}</span>` : '—'), { num: true }],
      ['Change', (h) => (h.delta === null ? '—' : `<span class="${h.delta > 0 ? 'delta-up' : h.delta < 0 ? 'delta-down' : ''}">${h.delta > 0 ? '+' : ''}${fmtInt(h.delta)}</span>`), { num: true, sort: (h) => h.delta || 0 }],
      ['History', (h) => `<span class="small">${h.list.slice().reverse().map((p) => `${p.reportingPeriod.slice(0, 7)}: ${fmtShares(p.shares)}`).join(' → ')}</span>`],
    ], hist, { search: false, pageSize: 30 });
    table(el.querySelector('#pa-dg'), [
      ['Issuer', (p) => (p.issuerEntityId ? entLink(ent(p.issuerEntityId), 'ownership') : esc(p.issuerNameAsReported))], ['Event date', (p) => esc(p.reportingPeriod)],
      ['Aggregate', (p) => fmtInt(p.beneficialOwnership.aggregateShares), { num: true }], ['% of class', (p) => fmtPct(p.beneficialOwnership.percentOfClass), { num: true }],
      ['Voting S / Sh', (p) => `${fmtShares(p.beneficialOwnership.soleVotingPower)} / ${fmtShares(p.beneficialOwnership.sharedVotingPower)}`], ['Dispositive S / Sh', (p) => `${fmtShares(p.beneficialOwnership.soleDispositivePower)} / ${fmtShares(p.beneficialOwnership.sharedDispositivePower)}`],
      ['Filing', (p) => { const f = filing(p.filingId); return `${esc(f.formType)} ${accLink(f)}`; }],
    ], dg, { search: false, pageSize: 20, empty: 'No Schedule 13D/G cover pages for this entity in the loaded data.' });
  }

  // ------------------------------------------------------------ 4. Ownership View
  function issuerObj(e) {
    const c = companyOf(e);
    return c ? { name: c.name, displayName: c.displayName, cik: c.cik, ticker: c.ticker, cusips: c.cusips, multiClass: c.multiClass, sharesOutstanding: c.sharesOutstanding } : { name: e.legalName, cik: e.cik, cusips: (e.cusip || '').split(', ').filter(Boolean) };
  }
  function ownership(id) {
    const issuers = M.entities.filter((e) => rolesOf(e).includes('ISSUER') && companyOf(e)).sort((a, b) => a.legalName.localeCompare(b.legalName));
    const e = ent(id) && companyOf(ent(id)) ? ent(id) : AAPL;
    const c = companyOf(e);
    const iss = issuerObj(e);
    const v = SOI.ownership.buildIssuerView(M.records, iss, { asOf: today });
    const inst = v.institutional, lp = inst.periods[0];
    const so = c.sharesOutstanding;
    const first = (p) => p.history[0].filingDate;
    const newcomers = v.beneficial.current.filter((p) => (new Date(today) - new Date(first(p))) / 86400000 <= 365);
    const ups = inst.changes.filter((x) => x.period === lp && x.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 5);
    const downs = inst.changes.filter((x) => x.period === lp && x.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 5);
    view.innerHTML = `<div class="toolbar"><label class="inline">Issuer ${entitySelect(issuers, e, 'ownership')}</label></div>
      <div class="callout">Ownership View answers: <strong>who reports owning, or exercising rights over, ${esc(e.legalName)}'s securities?</strong> The three sources are shown in separate sections and are never added into one total.</div>
      <div class="card"><div class="ent-card"><div><div class="ent-name">${esc(e.legalName)}</div><div style="margin:4px 0 8px">${typeChip(e)}${roleChips(rolesOf(e))}</div>
        <dl class="facts"><dt>Entity ID</dt><dd class="mono">${e.entityId}</dd><dt>Ticker</dt><dd>${esc(e.ticker)}</dd><dt>CIK</dt><dd class="mono">${esc(e.cik)}</dd><dt>Exchange</dt><dd>${esc((c.exchanges || []).join(', '))}</dd>
        <dt>Security classes</dt><dd>${esc(c.cusips.map((cu) => cu + (c.classNote ? '' : ' — common stock')).join('; '))}${c.classNote ? `<div class="small muted">${esc(c.classNote)}</div>` : ''}</dd><dt>Industry</dt><dd>${esc(c.sicDescription)}</dd>
        <dt>Shares outstanding</dt><dd>${so && so.usableAsDenominator ? `${fmtInt(so.value)} as of ${esc(so.asOf)} (${esc(so.form)} cover page)` : '<span class="muted">no reliable single-class figure</span>'}</dd>
        <dt>Latest 13F period</dt><dd>${esc(lp || '—')}</dd><dt>Data last updated</dt><dd>${esc(DATA.generatedAt.slice(0, 10))}</dd></dl></div>
        <div class="toolbar">${link('network/' + e.entityId, 'Network', 'btn')}${link('entities/entity/' + e.entityId, 'Entity record', 'btn')}</div></div></div>
      <div class="grid g3">
        <div class="card"><h3>Top institutional managers</h3><p class="small muted">13F · ${esc(lp || '')}</p>${inst.byPeriod[lp] ? inst.byPeriod[lp].slice(0, 6).map((p) => `<div class="small" style="display:flex;justify-content:space-between;gap:6px"><span>${entLink(byCik(p.managerCik), 'filer')}</span><span class="num">${fmtShares(p.shares)}${p.pctOfOutstanding !== null ? ' · ' + fmtPct(p.pctOfOutstanding) : ''}</span></div>`).join('') : ''}</div>
        <div class="card"><h3>Major beneficial ownership disclosures</h3><p class="small muted">13D / 13G · latest per person</p>${v.beneficial.current.slice(0, 6).map((p) => `<div class="small" style="display:flex;justify-content:space-between;gap:6px"><span>${esc(p.name)} <span class="muted">${esc(p.latest.eventDate)}</span></span><span class="num">${fmtPct(p.latest.percentOfClass)}</span></div>`).join('') || '<p class="small muted">None</p>'}</div>
        <div class="card"><h3>Changes</h3><p class="small muted">13F, into ${esc(lp || '')} vs each manager's prior quarter</p>
          ${ups.map((x) => `<div class="small"><span class="delta-up">▲ ${fmtShares(x.delta)}</span> ${esc(x.managerName)}</div>`).join('')}${downs.map((x) => `<div class="small"><span class="delta-down">▼ ${fmtShares(-x.delta)}</span> ${esc(x.managerName)}</div>`).join('')}
          <p class="small" style="margin-top:6px"><strong>Newly appearing reporting persons</strong> (first 13D/G in the last 12 months): ${newcomers.map((p) => esc(p.name)).join(', ') || 'none'}</p></div>
      </div>
      <div class="card"><h3>Ownership table — every reporting entity, its own figure, its own date</h3><p class="small muted">One row per entity per source. Rows are not additive: the same shares can appear under a 13F manager, a 13G reporting person and an insider.</p><div id="own-all"></div></div>
      <div class="tabs"><button class="tab active" data-o="inst">1 · Institutional holdings (13F)</button><button class="tab" data-o="ben">2 · Beneficial ownership (13D/G)</button><button class="tab" data-o="ins">3 · Insider ownership (Forms 3/4/5)</button><button class="tab" data-o="trend">Historical trend</button></div><div id="ot"></div>`;
    bindSelect();
    // consolidated table rows
    const rows = [];
    (inst.byPeriod[lp] || []).forEach((p) => rows.push({ entity: byCik(p.managerCik), name: p.managerName, role: 'Institutional investment manager', form: p.formTypes.join(', '), shares: p.shares, pct: p.pctOfOutstanding, pctBasis: p.pctOfOutstanding !== null ? 'calc' : '', date: p.period, dateBasis: 'report period', acc: p.accessionNumbers[p.accessionNumbers.length - 1] }));
    v.beneficial.persons.forEach((p) => rows.push({ entity: p.cik ? byCik(p.cik) : null, name: p.name, role: p.superseded ? 'Former beneficial owner (replaced)' : 'Reporting person / beneficial owner', form: p.latest.formType, shares: p.latest.shares, pct: p.latest.percentOfClass, pctBasis: 'reported', date: p.latest.eventDate, dateBasis: 'event date', acc: p.latest.accessionNumber, faded: !!p.superseded }));
    v.insiders.people.filter((p) => p.holdings.length).forEach((p) => rows.push({ entity: p.cik ? byCik(p.cik) : null, name: p.name, role: p.roles.join(', ') || 'Insider', form: p.holdings[0].formType, shares: p.holdings[0].shares, pct: null, pctBasis: 'not reported', date: p.holdings[0].asOfDate, dateBasis: 'transaction date', acc: p.holdings[0].accessionNumber, note: p.holdings[0].nature }));
    table(view.querySelector('#own-all'), [
      ['Reporting entity', (r) => `<span style="${r.faded ? 'opacity:.55' : ''}">${r.entity ? entLink(r.entity) : esc(r.name)}</span>`], ['Role', (r) => `<span class="small">${esc(r.role)}</span>`], ['Filing type', (r) => esc(r.form)],
      ['Shares', (r) => fmtInt(r.shares) + (r.note ? ` <span class="muted small">${esc(r.note)}</span>` : ''), { num: true, sort: (r) => r.shares || 0 }],
      ['Ownership %', (r) => (r.pct !== null && r.pct !== undefined ? `${fmtPct(r.pct)} <span class="muted small">${r.pctBasis}</span>` : '<span class="muted small">—</span>'), { num: true, sort: (r) => r.pct || 0 }],
      ['Reporting date', (r) => `${esc(r.date)} <span class="muted small">${r.dateBasis}</span>`, { sort: (r) => r.date }], ['Source', (r) => `<span class="mono-s">${esc(r.acc)}</span>`],
    ], rows, { placeholder: 'Search entity…', text: (r) => r.name + ' ' + r.role + ' ' + r.form, pageSize: 40 });
    const el = view.querySelector('#ot');
    const show = (t) => {
      view.querySelectorAll('[data-o]').forEach((b) => b.classList.toggle('active', b.dataset.o === t));
      if (t === 'inst') {
        el.innerHTML = `<div class="toolbar"><label class="inline">Period <select id="ow-p">${inst.periods.map((p) => `<option>${p}</option>`).join('')}</select></label></div><div id="ow-t"></div>`;
        const draw = (p) => table(el.querySelector('#ow-t'), [
          ['Manager', (x) => entLink(byCik(x.managerCik), 'filer')], ['Shares', (x) => fmtInt(x.shares), { num: true, sort: (x) => x.shares }], ['Reported value', (x) => fmtUSD(x.valueUSD), { num: true, sort: (x) => x.valueUSD }],
          ['% (calc)', (x) => (x.pctOfOutstanding !== null ? fmtPct(x.pctOfOutstanding) : '—'), { num: true }], ['Class / CUSIP', (x) => `<span class="small">${esc((x.byCusip[0] || {}).securityClass || '')} <span class="mono-s">${esc((x.byCusip[0] || {}).cusip || '')}</span></span>`],
          ['Discretion', (x) => `<span class="small">${Object.entries(x.discretion).map(([k, n]) => k + ' ' + fmtShares(n)).join(' · ')}</span>`], ['Voting S / Sh / N', (x) => `<span class="small">${fmtShares(x.votingAuthority.sole)} / ${fmtShares(x.votingAuthority.shared)} / ${fmtShares(x.votingAuthority.none)}</span>`],
          ['Filed', (x) => esc(x.filingDate)], ['Period', (x) => esc(x.period)], ['Accession', (x) => x.accessionNumbers.map((a) => `<a class="mono-s" target="_blank" rel="noopener" href="${esc(indexUrl(x.managerCik, a))}">${esc(a)}</a>`).join('<br>')],
        ], inst.byPeriod[p] || [], { search: false, pageSize: 40 });
        el.querySelector('#ow-p').addEventListener('change', (ev) => draw(ev.target.value));
        draw(lp);
      } else if (t === 'ben') {
        el.innerHTML = '<div id="ow-b"></div>';
        table(el.querySelector('#ow-b'), [
          ['Reporting person', (p) => `<span style="${p.superseded ? 'opacity:.55' : ''}">${p.cik && byCik(p.cik) ? entLink(byCik(p.cik)) : esc(p.name)}</span>${p.superseded ? ' <span class="badge b-warn">replaced</span>' : ''}${p.latest.jointFilers > 1 ? `<div class="small muted">joint with ${p.latest.jointFilers - 1}</div>` : ''}`],
          ['Form', (p) => esc(p.latest.formType)], ['Aggregate', (p) => fmtInt(p.latest.shares), { num: true, sort: (p) => p.latest.shares || 0 }], ['%', (p) => fmtPct(p.latest.percentOfClass), { num: true, sort: (p) => p.latest.percentOfClass || 0 }],
          ['Sole voting', (p) => fmtInt(p.latest.soleVoting), { num: true }], ['Shared voting', (p) => fmtInt(p.latest.sharedVoting), { num: true }], ['Sole dispositive', (p) => fmtInt(p.latest.soleDispositive), { num: true }], ['Shared dispositive', (p) => fmtInt(p.latest.sharedDispositive), { num: true }],
          ['Purpose (13D Item 4)', (p) => (p.latest.purpose ? `<details><summary class="small">read</summary><div class="small" style="max-width:420px;white-space:pre-wrap">${esc(p.latest.purpose.slice(0, 1200))}</div></details>` : '<span class="muted small">n/a (13G)</span>')],
          ['Filed', (p) => esc(p.latest.filingDate), { sort: (p) => p.latest.filingDate }], ['Event', (p) => esc(p.latest.eventDate)], ['Accession', (p) => `<a class="mono-s" target="_blank" rel="noopener" href="${esc(p.latest.sourceUrl)}">${esc(p.latest.accessionNumber)}</a>`],
        ], v.beneficial.persons, { placeholder: 'Search reporting person…', text: (p) => p.name, pageSize: 40 });
      } else if (t === 'ins') {
        el.innerHTML = '<div id="ow-i"></div>';
        table(el.querySelector('#ow-i'), [
          ['Insider', (x) => (x.ownerCik && byCik(x.ownerCik) ? entLink(byCik(x.ownerCik)) : esc(x.ownerName))], ['Position', (x) => `<span class="small">${esc(x.ownerRoles)}</span>`],
          ['Transaction date', (x) => esc(x.transactionDate || '—'), { sort: (x) => x.transactionDate || '' }], ['Code', (x) => `<span title="${esc(x.codeDescription || '')}">${esc(x.code || '—')}</span>`],
          ['D / I', (x) => esc(x.directOrIndirect) + (x.natureOfOwnership ? ` <span class="small muted">${esc(x.natureOfOwnership.slice(0, 24))}</span>` : '')],
          ['Acquired', (x) => (x.acquiredDisposed === 'A' ? fmtInt(x.shares) : ''), { num: true }], ['Disposed', (x) => (x.acquiredDisposed === 'D' ? fmtInt(x.shares) : ''), { num: true }],
          ['Holding after', (x) => fmtInt(x.sharesOwnedFollowing), { num: true }], ['Security', (x) => `<span class="small">${esc(x.securityTitle)}</span>`], ['Filed', (x) => esc(x.filingDate)], ['Accession', (x) => `<span class="mono-s">${esc(x.accessionNumber)}</span>`],
        ], v.insiders.transactions, { placeholder: 'Search insider or code…', text: (x) => x.ownerName + ' ' + x.code + ' ' + x.securityTitle, pageSize: 40 });
      } else {
        const top = (inst.byPeriod[lp] || []).slice(0, 8);
        const ps = inst.periods.slice().reverse();
        el.innerHTML = `<p class="small muted">Shares reported per quarter (13F report periods), largest 8 managers in ${esc(lp)}.</p><div class="table-wrap"><table class="data"><tr><th>Manager</th>${ps.map((p) => `<th class="num">${p}</th>`).join('')}</tr>${top.map((m) => `<tr><td>${esc(m.managerName)}</td>${ps.map((p) => { const x = (inst.byPeriod[p] || []).find((y) => y.managerCik === m.managerCik); return `<td class="num">${x ? fmtShares(x.shares) : '—'}</td>`; }).join('')}</tr>`).join('')}</table></div>`;
      }
    };
    view.querySelectorAll('[data-o]').forEach((b) => b.addEventListener('click', () => show(b.dataset.o)));
    show('inst');
  }

  // ------------------------------------------------------------ 5. Investment Manager View
  function manager(id) {
    const mgrs = M.entities.filter((e) => rolesOf(e).includes('INSTITUTIONAL_INVESTMENT_MANAGER') || M.relationships.some((r) => r.fromEntityId === e.entityId && r.relationshipType === 'PARENT_OF')).sort((a, b) => a.legalName.localeCompare(b.legalName));
    const e = ent(id) && mgrs.includes(ent(id)) ? ent(id) : BLK;
    const managed = M.relationships.filter((r) => r.fromEntityId === e.entityId && ['INCLUDES_OTHER_MANAGER', 'PARENT_OF', 'MANAGES', 'INVESTMENT_MANAGER_OF', 'ADVISER_TO', 'GENERAL_PARTNER_OF'].includes(r.relationshipType));
    const latestIncl = new Map();
    managed.forEach((r) => { const k = r.relationshipType + r.toEntityId; const p = latestIncl.get(k); if (!p || r.validFrom > p.validFrom) latestIncl.set(k, r); });
    const rows = [...latestIncl.values()];
    const parents = M.relationships.filter((r) => r.toEntityId === e.entityId && r.relationshipType === 'PARENT_OF');
    const funds = M.entities.filter((x) => ['FUND', 'MUTUAL_FUND', 'ETF', 'HEDGE_FUND'].includes(x.entityType) && M.relationships.some((r) => r.fromEntityId === e.entityId && r.toEntityId === x.entityId));
    const holdingsN = e === BLK ? M.fullBlackRock.positions.length : M.positions.filter((p) => p.reportingEntityId === e.entityId && p.positionType === '13F').length;
    view.innerHTML = `<div class="toolbar"><label class="inline">Manager ${entitySelect(mgrs, e, 'manager')}</label></div>
      <div class="callout">Investment Manager View answers: <strong>which funds, portfolios or entities does this manager manage, where documented — and what does it report managing?</strong> Managing is not owning: a MANAGES or included-manager link never implies legal or beneficial ownership.</div>
      ${profileCard(e, `<div class="card" style="margin:0"><strong>Parent organisation</strong><div class="small">${parents.length ? parents.map((r) => entLink(ent(r.fromEntityId))).join(', ') : 'Not documented in the loaded filings.'}</div></div>`)}
      <div class="split">
        <div class="card"><h3>Managed entity relationships</h3>
          <div class="tree"><ul><li><span class="node"><strong>${esc(e.legalName)}</strong> ${typeChip(e)}</span><ul>
            ${funds.length ? funds.map((f) => `<li><span class="node">${entLink(f)} <span class="chip">fund</span></span></li>`).join('') : '<li><span class="node muted">Funds: none documented — these filings do not name individual funds or client portfolios (that would need fund filings such as Form N-PORT).</span></li>'}
            ${rows.filter((r) => r.relationshipType === 'INCLUDES_OTHER_MANAGER').length ? `<li><span class="node"><strong>Other included managers</strong> (13F summary page)</span><ul>${rows.filter((r) => r.relationshipType === 'INCLUDES_OTHER_MANAGER').map((r) => `<li><span class="node">${entLink(ent(r.toEntityId))}</span></li>`).join('')}</ul></li>` : ''}
            ${rows.filter((r) => r.relationshipType === 'PARENT_OF').length ? `<li><span class="node"><strong>Subsidiaries</strong> (Schedule 13G Exhibit A)</span><ul>${rows.filter((r) => r.relationshipType === 'PARENT_OF').map((r) => `<li><span class="node">${entLink(ent(r.toEntityId))}</span></li>`).join('')}</ul></li>` : ''}
          </ul></li></ul></div></div>
        <div class="card"><h3>What the links mean</h3><dl class="facts">
          <dt>Other included manager</dt><dd>The manager's 13F also reports holdings over which this other manager shares investment discretion. A reporting link — not proof of ownership or of a parent/subsidiary relationship.</dd>
          <dt>Subsidiary (Exhibit A)</dt><dd>The parent holding company's 13G names the subsidiaries that acquired the reported security. Documented by that filing, for that date.</dd>
          <dt>Fund</dt><dd>Only created when a filing names it. Name similarity ("BlackRock …") is never enough.</dd>
          <dt>Holdings</dt><dd>${fmtInt(holdingsN)} reported 13F position(s) — see ${link('filer/' + e.entityId, 'Filer View')}.</dd></dl></div>
      </div>
      <div class="card"><h3>Manager relationship details</h3><div id="mg"></div></div>`;
    bindSelect();
    table(view.querySelector('#mg'), [
      ['Manager', (r) => entLink(ent(r.fromEntityId))], ['Managed / related entity', (r) => entLink(ent(r.toEntityId))], ['Relationship type', (r) => `<span class="mono-s">${esc(r.relationshipType)}</span>`],
      ['Effective date', (r) => esc(r.validFrom || '—')], ['Source document', (r) => { const f = filing(r.sourceFilingId); return f ? `${esc(f.formType)} ${accLink(f)}` : '—'; }],
      ['Evidence status', (r) => `${esc(r.evidenceStatus)} · ${esc(r.confidence)}`], ['Evidence', (r) => `<span class="small">${esc(r.evidenceText)}</span>`],
    ], rows, { placeholder: 'Search…', pageSize: 40, empty: 'No documented managed-entity relationships for this manager in the loaded filings.' });
  }

  // ------------------------------------------------------------ 6. Relationship Network
  function network(id) {
    const focus = ent(id) || BLK;
    const st = network.state || (network.state = { viaFilings: true, cats: ['OWNERSHIP', 'REPORTING', 'AUTHORITY', 'INVESTMENT', 'CORPORATE', 'INSIDER'], latest: true, scope: 'pair', other: AAPL.entityId, sameName: true });
    if (!st.mode) st.mode = 'table';
    if (st.mode === 'table') return networkTable(focus, st);
    // Scope "pair": only the links between the focus (plus same-name CIKs) and one counterpart — the simple default picture.
    const isBlk = focus === BLK || focus === BLK_OLD;
    const other = ent(st.other) && st.other !== focus.entityId ? ent(st.other) : (focus === AAPL ? BLK : AAPL);
    const extraFocus = st.sameName && focus.sameNameOtherCiks ? focus.sameNameOtherCiks.map((o) => ent(o.entityId)) : [];
    const ids = new Set([focus.entityId].concat(extraFocus.map((x) => x.entityId)));
    const pairOK = (r) => (ids.has(r.fromEntityId) && r.toEntityId === other.entityId) || (ids.has(r.toEntityId) && r.fromEntityId === other.entityId);
    let rels = M.relationships.filter((r) => (st.scope === 'pair' ? pairOK(r) : ids.has(r.fromEntityId) || ids.has(r.toEntityId)) && st.cats.includes((relLabel[r.relationshipType] || {}).category) && !r.putCall);
    if (st.latest) { const best = new Map(); rels.forEach((r) => { const k = r.relationshipType + r.fromEntityId + r.toEntityId; const p = best.get(k); if (!p || (r.validFrom || '') > (p.validFrom || '')) best.set(k, r); }); rels = [...best.values()]; }
    // "All links": keep the 40 largest per category so the picture stays readable
    let capped = false;
    if (st.scope !== 'pair') {
      const byCat = new Map();
      rels.forEach((r) => { const c = (relLabel[r.relationshipType] || {}).category; (byCat.get(c) || byCat.set(c, []).get(c)).push(r); });
      rels = [...byCat.values()].flatMap((list) => { if (list.length > 40) capped = true; return list.sort((a, b) => (b.shares || 0) - (a.shares || 0)).slice(0, 40); });
    }
    const partners = [...new Set(M.relationships.filter((r) => ids.has(r.fromEntityId) || ids.has(r.toEntityId)).map((r) => (ids.has(r.fromEntityId) ? r.toEntityId : r.fromEntityId)))].map(ent).filter((x) => x && !ids.has(x.entityId)).sort((a, b) => a.legalName.localeCompare(b.legalName));
    const els = [], seenN = new Set();
    const node = (e, extra) => { if (!seenN.has(e.entityId)) { seenN.add(e.entityId); els.push({ data: Object.assign({ id: e.entityId, label: e.legalName, kind: e.entityType, focus: ids.has(e.entityId) ? 1 : 0 }, extra || {}) }); } };
    rels.forEach((r, i) => {
      const a = ent(r.fromEntityId), b = ent(r.toEntityId);
      node(a); node(b);
      const f = filing(r.sourceFilingId);
      if (st.viaFilings && f) {
        const fid = 'F:' + f.filingId;
        if (!seenN.has(fid)) { seenN.add(fid); els.push({ data: { id: fid, label: `${f.formType}\n${f.reportPeriod || f.eventDate || f.filingDate}`, kind: 'FILING', filingId: f.filingId } }); }
        els.push({ data: { id: 'a' + i, source: a.entityId, target: fid, label: (roleName[relRole(r)] || ''), cat: (relLabel[r.relationshipType] || {}).category, rel: r.relationshipId } });
        els.push({ data: { id: 'b' + i, source: fid, target: b.entityId, label: r.relationshipType.replace(/_/g, ' ').toLowerCase(), cat: (relLabel[r.relationshipType] || {}).category, rel: r.relationshipId } });
      } else {
        els.push({ data: { id: 'e' + i, source: a.entityId, target: b.entityId, label: r.relationshipType.replace(/_/g, ' ').toLowerCase(), cat: (relLabel[r.relationshipType] || {}).category, rel: r.relationshipId } });
      }
    });
    const cats = ['OWNERSHIP', 'REPORTING', 'AUTHORITY', 'INVESTMENT', 'CORPORATE', 'INSIDER'];
    const colors = { OWNERSHIP: '#dc6b19', REPORTING: '#64748b', AUTHORITY: '#ca8a04', INVESTMENT: '#2563eb', CORPORATE: '#b91c1c', INSIDER: '#16a34a' };
    view.innerHTML = `${modeSwitch(st)}<div class="toolbar"><label class="inline">Focus ${entitySelect(networkEntities(), focus, 'network')}</label>
        <label class="chip-toggle"><input type="checkbox" id="nw-f" ${st.viaFilings ? 'checked' : ''}> show filings as nodes</label><label class="chip-toggle"><input type="checkbox" id="nw-l" ${st.latest ? 'checked' : ''}> latest filing per link</label>
        <label class="inline">Show <select id="nw-s"><option value="pair" ${st.scope === 'pair' ? 'selected' : ''}>only links with…</option><option value="all" ${st.scope === 'all' ? 'selected' : ''}>all links (largest 40 per category)</option></select></label>
        ${st.scope === 'pair' ? `<select id="nw-o" style="max-width:260px">${partners.map((x) => `<option value="${x.entityId}" ${x === other ? 'selected' : ''}>${esc(x.legalName)}</option>`).join('')}</select>` : ''}
        ${focus.sameNameOtherCiks ? `<label class="chip-toggle"><input type="checkbox" id="nw-a" ${st.sameName ? 'checked' : ''}> include same-name CIK(s)</label>` : ''}<button id="nw-fit">Fit</button></div>
      <div class="filters-row"><span class="small muted">Relationship categories:</span>${cats.map((c) => `<label class="chip-toggle"><input type="checkbox" data-cat="${c}" ${st.cats.includes(c) ? 'checked' : ''}><span style="display:inline-block;width:14px;border-top:3px solid ${colors[c]}"></span>${c.toLowerCase()}</label>`).join('')}</div>
      <p class="small muted">${seenN.size} nodes · ${rels.length} relationships. ${st.viaFilings ? 'Each link passes through the filing that documents it (entity → filing → entity).' : ''} ${capped ? 'Only the 40 largest links per category are drawn.' : ''} ${st.scope === 'pair' ? `Showing only how ${esc(focus.legalName)} is linked to ${esc(other.legalName.replace(/\.$/, ""))}.` : ''} Click a node or a line for details.</p>
      <div class="split" style="grid-template-columns:minmax(0,2fr) minmax(0,1fr)"><div class="graph-box" id="nw"></div><div class="card" id="nw-d" style="max-height:520px;overflow:auto"><p class="muted">Click a node or a line.</p></div></div>`;
    bindSelect();
    const text = SOI.ui.cssVar('--text'), surf = SOI.ui.cssVar('--surface');
    if (cy) cy.destroy();
    cy = cytoscape({
      container: view.querySelector('#nw'), elements: els, wheelSensitivity: 0.25,
      style: [
        { selector: 'node', style: { label: 'data(label)', 'font-size': 10, color: text, 'text-outline-color': surf, 'text-outline-width': 2, 'text-wrap': 'wrap', 'text-max-width': 140, 'text-valign': 'bottom', 'text-margin-y': 4, 'background-color': '#64748b', width: 22, height: 22 } },
        { selector: 'node[kind="PUBLIC_COMPANY"]', style: { 'background-color': '#0f2b4c', shape: 'round-rectangle', width: 34, height: 34 } },
        { selector: 'node[kind="COMPANY"]', style: { 'background-color': '#2563eb' } }, { selector: 'node[kind="INDIVIDUAL"]', style: { 'background-color': '#16a34a', shape: 'round-triangle' } },
        { selector: 'node[kind="TRUST"], node[kind="PARTNERSHIP"]', style: { 'background-color': '#7c3aed', shape: 'hexagon' } },
        { selector: 'node[kind="FILING"]', style: { 'background-color': '#94a3b8', shape: 'rectangle', width: 16, height: 12, 'font-size': 8.5, color: SOI.ui.cssVar('--text-3') } },
        { selector: 'node[focus=1]', style: { 'border-width': 4, 'border-color': '#f59e0b', 'font-weight': 700, 'font-size': 12 } },
        { selector: 'edge', style: { width: 1.6, 'curve-style': 'bezier', 'target-arrow-shape': 'triangle', 'arrow-scale': 0.8, label: 'data(label)', 'font-size': 8, color: text, 'text-outline-color': surf, 'text-outline-width': 2, 'text-rotation': 'autorotate', 'line-color': '#94a3b8', 'target-arrow-color': '#94a3b8' } },
      ].concat(cats.map((c) => ({ selector: `edge[cat="${c}"]`, style: { 'line-color': colors[c], 'target-arrow-color': colors[c] } }))),
      layout: st.scope === 'pair' ? { name: 'breadthfirst', directed: true, roots: [...ids].filter((x) => seenN.has(x)), spacingFactor: 1.3, padding: 30 } : { name: 'cose', animate: false, padding: 30, nodeRepulsion: 30000, idealEdgeLength: 120, numIter: 1500 },
    });
    const det = view.querySelector('#nw-d');
    cy.on('tap', 'node', (ev) => {
      const d = ev.target.data();
      if (d.kind === 'FILING') { const f = filing(d.filingId); det.innerHTML = `<h3>${esc(f.formType)}</h3><dl class="facts"><dt>Accession</dt><dd>${accLink(f)}</dd><dt>Filed</dt><dd>${esc(f.filingDate)}</dd><dt>Period / event</dt><dd>${esc(f.reportPeriod || f.eventDate)}</dd><dt>Filer</dt><dd>${entLink(ent(f.filerEntityId))}</dd><dt>Issuer</dt><dd>${f.issuerEntityId ? entLink(ent(f.issuerEntityId)) : 'multiple (13F)'}</dd></dl>`; return; }
      const e = ent(d.id);
      det.innerHTML = `<h3>${esc(e.legalName)}</h3><div>${typeChip(e)}${roleChips(rolesOf(e))}</div><dl class="facts" style="margin-top:8px"><dt>CIK</dt><dd>${esc(e.cik || '—')}</dd><dt>Entity ID</dt><dd>${e.entityId}</dd></dl>
        <div class="toolbar" style="margin-top:8px">${link('entities/entity/' + e.entityId, 'Entity record', 'btn')}${link('network/' + e.entityId, 'Focus here', 'btn')}${rolesOf(e).includes('ISSUER') && companyOf(e) ? link('ownership/' + e.entityId, 'Ownership', 'btn') : ''}${filingsOf(e).length ? link('filer/' + e.entityId, 'Filer', 'btn') : ''}</div>`;
    });
    cy.on('tap', 'edge', (ev) => {
      const r = M.relationships.find((x) => x.relationshipId === ev.target.data('rel'));
      const f = filing(r.sourceFilingId);
      det.innerHTML = `<h3>${esc(r.relationshipType)}</h3><p class="small">${entLink(ent(r.fromEntityId))} → ${entLink(ent(r.toEntityId))}</p><dl class="facts">
        <dt>Category</dt><dd>${esc((relLabel[r.relationshipType] || {}).category)}${(relLabel[r.relationshipType] || {}).isOwnership ? ' (ownership)' : ' (not ownership)'}</dd>
        ${r.shares !== null && r.shares !== undefined ? `<dt>Shares</dt><dd>${fmtInt(r.shares)}</dd>` : ''}${r.ownershipPercentage !== null && r.ownershipPercentage !== undefined ? `<dt>%</dt><dd>${fmtPct(r.ownershipPercentage)}</dd>` : ''}
        <dt>Valid</dt><dd>${esc(r.validFrom || '—')} → ${esc(r.validTo || 'open')}</dd><dt>Source</dt><dd>${f ? esc(f.formType) + ' ' + accLink(f) + ' filed ' + esc(f.filingDate) : '—'}</dd>
        <dt>Status</dt><dd>${esc(r.evidenceStatus)} · ${esc(r.confidence)}${r.isInferred ? ' · inferred' : ''}</dd></dl><p class="small">${esc(r.evidenceText)}</p>`;
    });
    const rer = () => network(focus.entityId);
    view.querySelector('#nw-f').addEventListener('change', (ev) => { st.viaFilings = ev.target.checked; rer(); });
    view.querySelector('#nw-l').addEventListener('change', (ev) => { st.latest = ev.target.checked; rer(); });
    const wa = view.querySelector('#nw-a'); if (wa) wa.addEventListener('change', (ev) => { st.sameName = ev.target.checked; rer(); });
    view.querySelector('#nw-s').addEventListener('change', (ev) => { st.scope = ev.target.value; rer(); });
    const wo = view.querySelector('#nw-o'); if (wo) wo.addEventListener('change', (ev) => { st.other = ev.target.value; rer(); });
    view.querySelector('#nw-fit').addEventListener('click', () => cy.fit(undefined, 30));
    bindModeSwitch(st, focus);
    view.querySelectorAll('[data-cat]').forEach((c) => c.addEventListener('change', () => { st.cats = [...view.querySelectorAll('[data-cat]:checked')].map((x) => x.dataset.cat); rer(); }));
  }
  const networkEntities = () => M.entities.filter((x) => M.relationships.some((r) => r.fromEntityId === x.entityId || r.toEntityId === x.entityId)).sort((a, b) => a.legalName.localeCompare(b.legalName));
  const modeSwitch = (st) => `<div class="tabs"><button class="tab ${st.mode === 'table' ? 'active' : ''}" data-mode="table">Hierarchy table</button><button class="tab ${st.mode === 'graph' ? 'active' : ''}" data-mode="graph">Diagram</button></div>`;
  function bindModeSwitch(st, focus) { view.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { st.mode = b.dataset.mode; network(focus.entityId); })); }

  /**
   * Relationship network as a folding table:
   *   entity → relationship category → relationship type → one row per connected entity (with figures and source filing).
   */
  function networkTable(focus, st) {
    const CAT_INFO = {
      OWNERSHIP: ['Ownership', 'Reported ownership: beneficial (13D/G), direct or indirect (Forms 3/4/5), or securities named in a filing.'],
      AUTHORITY: ['Voting and dispositive power', 'Who can vote the shares and who can decide to sell them — reported separately.'],
      INVESTMENT: ['Investment management', 'Investment discretion reported on Form 13F. Managing is not owning.'],
      REPORTING: ['Reporting links', 'Who files for whom, who reports jointly, and whose holdings are included in a 13F.'],
      CORPORATE: ['Corporate structure', 'Parent and subsidiary links documented in a filing (e.g. Schedule 13G Exhibit A).'],
      INSIDER: ['Insider roles', 'Director, officer or 10% owner, from the boxes ticked on Forms 3/4/5.'],
    };
    const ids = new Set([focus.entityId].concat(st.sameName && focus.sameNameOtherCiks ? focus.sameNameOtherCiks.map((o) => o.entityId) : []));
    let rels = M.relationships.filter((r) => (ids.has(r.fromEntityId) || ids.has(r.toEntityId)) && !r.putCall);
    if (st.latest) { const best = new Map(); rels.forEach((r) => { const k = r.relationshipType + r.fromEntityId + r.toEntityId + (r.natureOfOwnership || ''); const p = best.get(k); if (!p || (r.validFrom || '') > (p.validFrom || '')) best.set(k, r); }); rels = [...best.values()]; }
    const q = (st.tq || '').toLowerCase();
    const other = (r) => ent(ids.has(r.fromEntityId) ? r.toEntityId : r.fromEntityId);
    if (q) rels = rels.filter((r) => other(r).legalName.toLowerCase().includes(q));
    const self = (r) => ent(ids.has(r.fromEntityId) ? r.fromEntityId : r.toEntityId);
    const cats = Object.keys(CAT_INFO).map((c) => [c, rels.filter((r) => (relLabel[r.relationshipType] || {}).category === c)]).filter(([, list]) => list.length);
    const row = (r) => {
      const out = ids.has(r.fromEntityId);
      const o = other(r), f = filing(r.sourceFilingId);
      return `<tr><td class="hier-leaf">${out ? '<span class="dir" title="This entity → other">→</span>' : '<span class="dir in" title="Other → this entity">←</span>'} ${entLink(o)} <span class="muted small">${esc(o.entityType)}</span>${ids.size > 1 && self(r) !== focus ? `<div class="small muted">via ${esc(self(r).legalName)} (CIK ${esc(self(r).cik)})</div>` : ''}</td>
        <td class="num">${r.shares !== null && r.shares !== undefined ? fmtInt(r.shares) : '—'}</td>
        <td class="num">${r.ownershipPercentage !== null && r.ownershipPercentage !== undefined ? fmtPct(r.ownershipPercentage) : '—'}</td>
        <td class="nowrap">${esc(r.validFrom || '—')} → ${r.validTo ? esc(r.validTo) : '<span class="muted">open</span>'}</td>
        <td>${f ? `${esc(f.formType)} ${accLink(f)}<div class="small muted">filed ${esc(f.filingDate)}</div>` : '—'}</td>
        <td>${statusBadge(r.isInferred ? 'inferred' : 'reported')}</td></tr>`;
    };
    const typeBlock = (code, list) => {
      const t = relLabel[code] || { label: code };
      list.sort((a, b) => (b.shares || 0) - (a.shares || 0) || other(a).legalName.localeCompare(other(b).legalName));
      return `<details class="hier hier-2" ${list.length <= 12 ? 'open' : ''}><summary><span class="hier-title">${esc(t.label)}</span> <span class="mono-s muted">${esc(code)}</span> <span class="chip">${list.length}</span>${t.isOwnership ? ' <span class="badge b-warn">ownership</span>' : ''}</summary>
        <div class="table-wrap"><table class="data"><tr><th>Connected entity</th><th class="num">Shares</th><th class="num">%</th><th>Valid</th><th>Source filing</th><th>Status</th></tr>${list.slice(0, 200).map(row).join('')}</table></div>
        ${list.length > 200 ? `<p class="small muted">Showing 200 of ${list.length}. Use the search box to narrow.</p>` : ''}</details>`;
    };
    view.innerHTML = `${modeSwitch(st)}
      <div class="toolbar"><label class="inline">Entity ${entitySelect(networkEntities(), focus, 'network')}</label>
        <input type="search" id="nt-q" placeholder="Filter connected entities…" value="${esc(st.tq || '')}" style="min-width:200px">
        <label class="chip-toggle"><input type="checkbox" id="nt-l" ${st.latest ? 'checked' : ''}> latest filing per link</label>
        ${focus.sameNameOtherCiks ? `<label class="chip-toggle"><input type="checkbox" id="nt-a" ${st.sameName ? 'checked' : ''}> include same-name CIK(s)</label>` : ''}
        <button id="nt-open">Expand all</button><button id="nt-close">Collapse all</button></div>
      <p class="small muted">Read top to bottom: the entity, then each kind of relationship, then every connected entity with its figures and the filing that documents it. → means this entity acts on the other; ← means the other acts on this entity.</p>
      <div class="card hier-root">
        <div class="hier-head"><span class="ent-name">${esc(focus.legalName)}</span> ${typeChip(focus)} ${roleChips(rolesOf(focus))}<div class="small muted">CIK ${esc(focus.cik || '—')} · ${rels.length} relationship(s)${ids.size > 1 ? ` · including ${[...ids].filter((x) => x !== focus.entityId).map((x) => esc(ent(x).legalName) + ' (CIK ' + esc(ent(x).cik) + ')').join(', ')}` : ''}</div></div>
        ${cats.length ? cats.map(([c, list]) => {
          const types = [...new Set(list.map((r) => r.relationshipType))];
          return `<details class="hier hier-1" open><summary><span class="hier-title">${esc(CAT_INFO[c][0])}</span> <span class="chip">${list.length}</span><div class="small muted hier-desc">${esc(CAT_INFO[c][1])}</div></summary>
            ${c === 'INVESTMENT' && ids.has(BLK.entityId) ? `<p class="small muted" style="margin-left:24px">Relationships are built for the demonstration issuers. BlackRock's full 13F has ${fmtInt(M.fullBlackRock.positions.length)} positions — see ${link('filer/' + BLK.entityId, 'Filer View')}.</p>` : ''}
            ${types.map((t) => typeBlock(t, list.filter((r) => r.relationshipType === t))).join('')}</details>`;
        }).join('') : '<div class="empty">No relationships match.</div>'}
      </div>`;
    bindSelect();
    bindModeSwitch(st, focus);
    const rer = () => networkTable(focus, st);
    const tq = view.querySelector('#nt-q');
    tq.addEventListener('change', () => { st.tq = tq.value.trim(); rer(); });
    view.querySelector('#nt-l').addEventListener('change', (e) => { st.latest = e.target.checked; rer(); });
    const na = view.querySelector('#nt-a'); if (na) na.addEventListener('change', (e) => { st.sameName = e.target.checked; rer(); });
    view.querySelector('#nt-open').addEventListener('click', () => view.querySelectorAll('details.hier').forEach((d) => { d.open = true; }));
    view.querySelector('#nt-close').addEventListener('click', () => view.querySelectorAll('details.hier-2').forEach((d) => { d.open = false; }));
  }

  const relRole = (r) => ({ REPORTS_BENEFICIAL_OWNERSHIP_OF: 'REPORTING_PERSON', BENEFICIALLY_OWNS: 'BENEFICIAL_OWNER', EXERCISES_INVESTMENT_DISCRETION_OVER: 'INSTITUTIONAL_INVESTMENT_MANAGER', HAS_SOLE_VOTING_POWER: 'VOTING_AUTHORITY_HOLDER', HAS_SHARED_VOTING_POWER: 'VOTING_AUTHORITY_HOLDER', HAS_SOLE_DISPOSITIVE_POWER: 'DISPOSITIVE_AUTHORITY_HOLDER', HAS_SHARED_DISPOSITIVE_POWER: 'DISPOSITIVE_AUTHORITY_HOLDER', PARENT_OF: 'PARENT', SUBSIDIARY_OF: 'SUBSIDIARY', DIRECTOR_OF: 'DIRECTOR', OFFICER_OF: 'EXECUTIVE_OFFICER', INSIDER_OF: 'TEN_PERCENT_OWNER', DIRECTLY_OWNS: 'DIRECT_OWNER', INDIRECTLY_OWNS: 'INDIRECT_OWNER', INCLUDES_OTHER_MANAGER: 'INSTITUTIONAL_INVESTMENT_MANAGER', FILES_FOR: 'FILER', JOINT_REPORTING_PERSON: 'REPORTING_PERSON' }[r.relationshipType]);

  // ------------------------------------------------------------ 7. Filing Explorer / 8. Position Explorer
  function filings() {
    view.innerHTML = countBanner('filings', COUNTS.filings, Object.entries(countBy(M.filings, (f) => f.formFamily)), `${fmtInt(bundleFilings)} filings from the bundled SEC data (14 companies' 13D/G, Forms 3/4/5 and 13Fs from ${new Set(M.filings.filter((f) => f.formFamily === '13F').map((f) => f.filerEntityId)).size} managers over four quarters, amendments included) + ${fmtInt(COUNTS.filings - bundleFilings)} BlackRock 13G/A on Apple added for UEIM. Duplicate copies of the same accession number are counted once. One filing can carry several reporting persons, many issuers and many positions.`) + '<div id="fx"></div>';
    filingTable(view.querySelector('#fx'), M.filings.slice().sort((a, b) => (a.filingDate < b.filingDate ? 1 : -1)));
  }
  function positions(src) {
    const st = { type: '', src: ['all', 'master', 'full'].includes(src) ? src : 'all' };
    const sets = { all: POS.all, master: POS.master, full: POS.full };
    view.innerHTML = countBanner('positions', COUNTS.positions, [['Position Master — 13F', countBy(POS.master, (p) => p.positionType)['13F'] || 0], ['Position Master — 13D/G cover pages', countBy(POS.master, (p) => p.positionType)['13DG'] || 0], ['Position Master — Section 16 holdings', countBy(POS.master, (p) => p.positionType).SECTION16 || 0], ["BlackRock's full 13F, not already above", fullExtra.length]],
      `The Position Master holds the positions behind the relationships (13F rows for the demonstration issuers, 13D/G cover pages, Section 16 holdings). BlackRock's full 13F for ${esc(fb.meta.reportPeriod)} adds ${fmtInt(fb.positions.length)} positions, of which ${fmtInt(POS.overlap)} are already in the Position Master (the same filing and CUSIP), so they are counted once: ${fmtInt(POS.master.length)} + ${fmtInt(fb.positions.length)} − ${fmtInt(POS.overlap)} = ${fmtInt(POS.all.length)}.`) +
      `<div class="toolbar"><select id="px-s"><option value="all">All positions (${fmtInt(POS.all.length)})</option><option value="master">Position Master only (${fmtInt(POS.master.length)})</option><option value="full">BlackRock's full 13F only (${fmtInt(POS.full.length)})</option></select>
        <select id="px-t"><option value="">All position types</option>${['13F', '13DG', 'SECTION16'].map((t) => `<option>${t}</option>`).join('')}</select><button id="px-j">Export JSON</button><button id="px-c">CSV</button></div><div id="px"></div>`;
    view.querySelector('#px-s').value = st.src;
    const current = () => sets[st.src].filter((p) => !st.type || p.positionType === st.type);
    const draw = () => table(view.querySelector('#px'), [
      ['ID', (p) => `<span class="mono-s">${p.positionId}</span>`], ['Type', (p) => esc(p.positionType) + (p.source === 'BlackRock full 13F' ? ' <span class="small muted">full table</span>' : '')], ['Reporting entity', (p) => entLink(ent(p.reportingEntityId))],
      ['Issuer', (p) => (p.issuerEntityId ? entLink(ent(p.issuerEntityId), 'ownership') : esc(p.issuerNameAsReported))], ['CUSIP', (p) => `<span class="mono-s">${esc(p.cusip || '—')}</span>`],
      ['Class', (p) => esc(p.securityClass || '') + (p.putCall ? ` <span class="badge b-neutral">${esc(p.putCall)}</span>` : '')], ['Shares', (p) => fmtInt(p.shares), { num: true, sort: (p) => p.shares || 0 }],
      ['Value', (p) => (p.value ? fmtUSD(p.value) : '—'), { num: true, sort: (p) => p.value || 0 }], ['Details', (p) => `<span class="small">${p.votingAuthority ? `discretion ${esc(p.investmentDiscretion)} · vote ${fmtShares(p.votingAuthority.sole)}/${fmtShares(p.votingAuthority.shared)}/${fmtShares(p.votingAuthority.none)}` : p.beneficialOwnership ? `${fmtPct(p.beneficialOwnership.percentOfClass)} · vote ${fmtShares(p.beneficialOwnership.soleVotingPower)}/${fmtShares(p.beneficialOwnership.sharedVotingPower)} · dispose ${fmtShares(p.beneficialOwnership.soleDispositivePower)}/${fmtShares(p.beneficialOwnership.sharedDispositivePower)}` : `${esc(p.directIndirect || '')} ${esc(p.natureOfOwnership || '')}`}</span>`],
      ['Period / date', (p) => esc(p.reportingPeriod), { sort: (p) => p.reportingPeriod || '' }], ['Filing', (p) => accLink(filing(p.filingId))],
    ], current(), { placeholder: 'Search entity, issuer, CUSIP…', text: (p) => [ent(p.reportingEntityId).legalName, p.issuerNameAsReported, p.cusip].join(' '), pageSize: 50 });
    view.querySelector('#px-s').addEventListener('change', (e) => { st.src = e.target.value; draw(); });
    view.querySelector('#px-t').addEventListener('change', (e) => { st.type = e.target.value; draw(); });
    view.querySelector('#px-j').addEventListener('click', () => SOI.storage.saveBlob(new Blob([JSON.stringify(current(), null, 2)], { type: 'application/json' }), `ueim-positions-${st.src}.json`));
    view.querySelector('#px-c').addEventListener('click', () => SOI.storage.saveBlob(new Blob([SOI.storage.toCSV(current().map(flat))], { type: 'text/csv' }), `ueim-positions-${st.src}.csv`));
    draw();
  }

  // ------------------------------------------------------------ 9. Data Quality
  function quality() {
    const items = [];
    M.entities.filter((e) => e.sameNameOtherCiks).forEach((e) => items.push(['warning', 'Same name, different CIK', `${e.legalName} (CIK ${e.cik}) shares a name with ${e.sameNameOtherCiks.map((o) => o.legalName + ' (CIK ' + o.cik + ')').join(', ')}. Kept as separate entities.`, e]));
    M.entities.filter((e) => e.resolution === 'UNRESOLVED_NAME').forEach((e) => items.push(['warning', 'Unresolved name', `${e.allNames[0]}: ${e.resolutionNote}`, e]));
    const nameOnly = M.entities.filter((e) => e.resolution === 'NAME_ONLY');
    items.push(['info', 'Entities without a CIK', `${nameOnly.length} entities are known by name only (e.g. subsidiaries in Exhibit A, other included managers, persons on cover pages without a CIK). They are matched only by identical normalized name.`, null]);
    const unmapped = M.fullBlackRock.positions.filter((p) => !p.issuerEntityId).length;
    items.push(['info', 'Unresolved 13F issuers', `${fmtInt(unmapped)} of ${fmtInt(M.fullBlackRock.positions.length)} positions in BlackRock's full 13F are not resolved to an issuer CIK: a 13F gives only the issuer name and CUSIP. They are kept as positions with the name as reported.`, BLK]);
    M.relationships.filter((r) => r.closedBy && /no longer names/.test(r.closedBy) && r.relationshipType === 'REPORTS_BENEFICIAL_OWNERSHIP_OF').forEach((r) => items.push(['warning', 'Replaced by a later filing', `${ent(r.fromEntityId).legalName} → ${ent(r.toEntityId).legalName}: ${r.closedBy}`, ent(r.fromEntityId)]));
    M.filings.filter((f) => f.processingStatus !== 'PROCESSED').forEach((f) => { const r = recById.get(f.recordId) || UE.blackrock13G.record; if (r && r.validation.warnings.some((w) => /heuristic/i.test(w))) items.push(['warning', 'Heuristic extraction', `${f.formType} ${f.accessionNumber} is a legacy text/HTML filing; values were read heuristically and checked by unit tests for the BlackRock/Apple example.`, null]); });
    const stale = M.relationships.filter((r) => r.relationshipType === 'REPORTS_BENEFICIAL_OWNERSHIP_OF' && !r.validTo && r.validFrom && (new Date(today) - new Date(r.validFrom)) / 86400000 > 540);
    stale.forEach((r) => items.push(['info', 'Old but still the latest', `${ent(r.fromEntityId).legalName} → ${ent(r.toEntityId).legalName}: latest 13D/G in the data is from ${r.validFrom}. Ownership may have changed without a new filing being loaded.`, ent(r.fromEntityId)]));
    const conf = M.filings.filter((f) => f.formFamily === '13F').map((f) => recById.get(f.recordId)).filter((r) => r && (r.extension.confidentialTreatment || {}).isConfidentialOmitted);
    conf.forEach((r) => items.push(['warning', 'Confidential treatment', `${r.filing.filerName} ${r.filing.reportPeriod}: the 13F states that confidential information was omitted.`, byCik(r.filing.filerCik)]));
    const vw = M.filings.map((f) => recById.get(f.recordId)).filter((r) => r && r.validation.warnings.some((w) => /Summary page says/.test(w)));
    vw.forEach((r) => items.push(['warning', 'Row count differs from summary page', `${r.filing.formType} ${r.filing.accessionNumber}: ${r.validation.warnings.find((w) => /Summary page says/.test(w))}`, byCik(r.filing.filerCik)]));
    items.push(['info', 'Not populated on purpose', 'LEI and tax identifiers are not disclosed in these filings and are left empty. No fund records are created: the loaded filings do not name individual funds.', null]);
    const counts = items.reduce((a, i) => ((a[i[1]] = (a[i[1]] || 0) + 1), a), {});
    view.innerHTML = `<div class="callout">Data Quality lists everything that limits what the masters can say. Nothing here is fixed by guessing.</div>
      <div class="pill-row" style="margin-bottom:12px">${Object.entries(counts).map(([k, n]) => `<span class="chip">${esc(k)}: ${n}</span>`).join('')}</div>
      ${items.map(([lvl, kind, text, e]) => `<div class="finding"><div class="fh"><span class="badge ${lvl === 'warning' ? 'b-warn' : 'b-info'}">${lvl}</span><strong>${esc(kind)}</strong>${e ? ' · ' + entLink(e) : ''}</div>${esc(text)}</div>`).join('')}`;
  }

  // ------------------------------------------------------------ search + router
  const sIn = document.getElementById('entity-search'), sOut = document.getElementById('search-results');
  sIn.addEventListener('input', () => {
    const q = sIn.value.trim().toLowerCase();
    if (q.length < 2) { sOut.classList.add('hidden'); return; }
    const hits = M.entities.filter((e) => e.cik.includes(q) || e.allNames.concat([e.legalName]).some((n) => n.toLowerCase().includes(q))).slice(0, 15);
    sOut.innerHTML = hits.length ? hits.map((e) => `<a href="#/entities/entity/${e.entityId}">${esc(e.legalName)} <span class="muted small">${esc(e.entityType)}${e.cik ? ' · CIK ' + esc(e.cik) : ''}</span><div class="small muted">${esc(rolesOf(e).map((r) => roleName[r]).slice(0, 4).join(', '))}</div></a>`).join('') : '<div class="small muted" style="padding:8px">No match</div>';
    sOut.classList.remove('hidden');
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.search-box')) sOut.classList.add('hidden'); });
  sOut.addEventListener('click', () => { sOut.classList.add('hidden'); sIn.value = ''; });

  function route() {
    if (cy) { cy.destroy(); cy = null; }
    charts.forEach((c) => c.destroy());
    const [top, a, b] = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('/');
    document.querySelectorAll('.nav-link[data-route]').forEach((l) => l.classList.toggle('active', l.dataset.route === top));
    document.getElementById('sidenav').classList.remove('open');
    const titles = { dashboard: 'Dashboard', entities: 'Entity Master', filer: 'Filer View', ownership: 'Ownership View', manager: 'Investment Manager View', network: 'Relationship Network', filings: 'Filing Explorer', positions: 'Position Explorer', quality: 'Data Quality' };
    document.getElementById('page-title').textContent = titles[top] || 'UEIM';
    document.title = (titles[top] || 'UEIM') + ' · UEIM';
    window.scrollTo(0, 0);
    try {
      ({ dashboard, entities: () => entities(a, b), filer: () => filer(a), ownership: () => ownership(a), manager: () => manager(a), network: () => network(a), filings, positions: () => positions(a), quality }[top] || dashboard)();
    } catch (err) { console.error(err); view.innerHTML = `<div class="callout err">Something went wrong: ${esc(err.message)}</div>`; }
  }
  window.addEventListener('hashchange', route);
  route();
  window.UEIM = M; // for inspection in the browser console
})();
