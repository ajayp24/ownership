/* network-view.js — View 3: the interactive ownership network (zoom, pan, search, expand/collapse, filters). */
(function (g) {
  'use strict';
  const SOI = (g.SOI = g.SOI || {});
  const { esc, fmtInt, fmtPct, fmtShares } = SOI.ui;
  const M = SOI.models, D = SOI.diagrams;
  const FAMS = ['13F', '13D', '13G', 'FORM3', 'FORM4', 'FORM5'];
  const REL_TYPES = ['REPORTED_13F_HOLDING', 'BENEFICIAL_OWNERSHIP', 'DIRECT_OWNERSHIP', 'INDIRECT_OWNERSHIP', 'INSIDER_ROLE', 'JOINT_FILER', 'OTHER_INCLUDED_MANAGER'];

  function render(view, ctx, issuers, selectedKey, state) {
    const f = state.net || (state.net = { fams: FAMS.slice(), rels: REL_TYPES.filter((r) => r !== 'INSIDER_ROLE' && r !== 'OTHER_INCLUDED_MANAGER'), period: '', minPct: 0, hideNoPct: false, latestOnly: true });
    if (f.topN === undefined) f.topN = 10;
    const chosen = selectedKey === 'all' ? issuers : issuers.filter((i) => i.ticker === selectedKey || i.cik === selectedKey);
    const records = ctx.records(true);
    const allPeriods = new Set();
    const views = chosen.map((iss) => {
      const v = SOI.ownership.buildIssuerView(records, iss, { asOf: ctx.today });
      v.institutional.periods.forEach((p) => allPeriods.add(p));
      return v;
    });
    const periods = [...allPeriods].sort().reverse();
    if (!f.period || !periods.includes(f.period)) f.period = periods[0] || '';

    view.innerHTML = `
      <div class="card">
        <div class="filters">
          <span class="lbl">Company</span><select id="net-iss"><option value="all" ${selectedKey === 'all' ? 'selected' : ''}>All companies</option>${issuers.map((i) => `<option value="${esc(i.ticker || i.cik)}" ${chosen.length === 1 && chosen[0] === i ? 'selected' : ''}>${esc(i.ticker || '')} ${esc(i.displayName || i.name)}</option>`).join('')}</select>
          <span class="lbl">Show</span><select id="net-top"><option value="5" ${f.topN === 5 ? 'selected' : ''}>Top 5 of each kind</option><option value="10" ${f.topN === 10 ? 'selected' : ''}>Top 10 of each kind</option><option value="0" ${f.topN === 0 ? 'selected' : ''}>Everything</option></select>
          <input type="search" id="net-search" placeholder="Find a name…" style="width:180px">
          <button id="net-fit">Fit to screen</button><span class="small muted" id="net-stats"></span>
        </div>
        <p class="small muted" style="margin:0">Blue = institutional managers (13F), orange = big owners (13D/G), green = insiders (Forms 3/4/5). Click any dot or line for its source filing.</p>
        <details class="more-filters"><summary>More filters</summary>
          <div class="filters" style="margin-top:8px"><span class="lbl">13F quarter</span><select id="net-period">${periods.map((p) => `<option ${p === f.period ? 'selected' : ''}>${p}</option>`).join('')}</select>
            <span class="lbl">Min. %</span><input type="range" id="net-pct" min="0" max="10" step="0.5" value="${f.minPct}" style="width:110px"><span class="small mono" id="net-pct-val">${f.minPct}%</span>
            <label class="chip-toggle"><input type="checkbox" id="net-nopct" ${f.hideNoPct ? 'checked' : ''}> hide lines without a %</label>
            <label class="chip-toggle"><input type="checkbox" id="net-latest" ${f.latestOnly ? 'checked' : ''}> latest filing only</label></div>
          <div class="filters"><span class="lbl">Filing types</span><div class="grp">${FAMS.map((x) => `<label class="chip-toggle"><input type="checkbox" data-fam="${x}" ${f.fams.includes(x) ? 'checked' : ''}>${esc(M.FORM_FAMILIES[x].label)}</label>`).join('')}</div></div>
          <div class="filters"><span class="lbl">Relationships</span><div class="grp">${REL_TYPES.map((t) => { const v = M.RELATIONSHIP_TYPES[t]; return `<label class="chip-toggle"><input type="checkbox" data-rel="${t}" ${f.rels.includes(t) ? 'checked' : ''}><span style="display:inline-block;width:16px;border-top:3px ${v.style === 'dotted' ? 'dotted' : v.style === 'dashed' ? 'dashed' : 'solid'} ${v.color}"></span>${esc(v.label.split(' (')[0])}</label>`; }).join('')}</div></div>
          <div class="toolbar" style="margin:0"><button id="net-expand">Expand all</button><button id="net-collapse">Collapse to companies</button><span class="small muted">Tip: double-click a dot to hide or show its neighbours. The % filter uses the 13D/G reported % and the 13F calculated % (single-class companies only).</span></div>
        </details>
      </div>
      <div class="graph-side"><div class="graph-box tall" id="net"></div><div class="card detail-panel" id="net-detail"><p class="muted">Click a dot or a line to see who it is, the figure, the date and the source filing.</p></div></div>
      <details class="card" style="margin-top:12px"><summary class="small">Legend</summary><div style="margin-top:8px">${D.legendHtml(['issuer', 'manager', 'beneficialOwner', 'insider', 'entity'], REL_TYPES)}</div></details>`;

    const rels = [];
    views.forEach((v) => {
      const iss = v.issuer;
      // 13F: one edge per manager for the selected period (amendments already resolved by the engine)
      if (f.fams.includes('13F')) (v.institutional.byPeriod[f.period] || []).forEach((p) => {
        p.edges.forEach((e) => rels.push(Object.assign({}, e, { percentOfClass: p.pctOfOutstanding, percentBasis: p.pctOfOutstanding !== null ? 'calculated' : 'not-available', issuerKey: iss.cik })));
      });
      v.relationships.filter((r) => r.type !== 'REPORTED_13F_HOLDING' && (r.type !== 'OTHER_INCLUDED_MANAGER' || f.fams.includes('13F'))).forEach((r) => {
        const fam = M.familyForForm(r.evidence.formType);
        if (fam && !f.fams.includes(fam)) return;
        if (fam === '13F' && r.evidence.reportPeriod !== f.period) return;
        rels.push(Object.assign({}, r, { issuerKey: iss.cik }));
      });
    });
    let filtered = rels.filter((r) => f.rels.includes(r.type));
    filtered = filtered.filter((r) => {
      const pct = r.percentOfClass;
      if (pct === null || pct === undefined) return !f.hideNoPct;
      return pct >= f.minPct;
    });
    if (f.latestOnly) {
      const best = new Map();
      filtered.forEach((r) => {
        const k = `${r.type}|${r.from.cik || r.from.name}|${r.to.cik || r.to.name}|${r.securityClass || ''}|${r.natureDetail || ''}|${r.cusip || ''}`;
        const prev = best.get(k);
        if (!prev || (r.evidence.filingDate || '') > (prev.evidence.filingDate || '')) best.set(k, r);
      });
      filtered = [...best.values()];
    }
    // Keep only the largest entries of each kind per company, so the picture stays readable
    if (f.topN) {
      const size = (r) => (r.percentOfClass !== null && r.percentOfClass !== undefined ? r.percentOfClass * 1e12 : 0) + (r.shares || 0);
      const groups = new Map();
      filtered.forEach((r) => { const k = r.issuerKey + '|' + r.type; (groups.get(k) || groups.set(k, []).get(k)).push(r); });
      filtered = [...groups.values()].flatMap((list) => list.sort((a, b) => size(b) - size(a)).slice(0, f.topN));
    }
    const graph = SOI.relationships.toGraph(filtered, chosen[0] || { name: '', cik: '' }, {
      edgeLabel: (r) => (r.percentOfClass !== null && r.percentOfClass !== undefined ? fmtPct(r.percentOfClass, 1) : r.shares ? fmtShares(r.shares) : ''),
    });
    // issuers keep issuer kind
    graph.nodes.forEach((n) => { if (chosen.some((i) => i.cik && i.cik === n.data.cik)) n.data.kind = 'issuer'; });
    view.querySelector('#net-stats').textContent = `${graph.nodes.length} entities · ${graph.edges.length} relationships`;

    const cy = cytoscape({
      container: view.querySelector('#net'), elements: graph.nodes.concat(graph.edges), style: D.cyStyle(), wheelSensitivity: 0.25,
      layout: { name: 'cose', animate: false, padding: 30, nodeRepulsion: 40000, idealEdgeLength: 170, edgeElasticity: 60, numIter: 2000 },
    });
    ctx.track(cy);
    const det = view.querySelector('#net-detail');
    cy.on('tap', 'edge', (e) => { det.innerHTML = SOI.companyViews.relDetail(e.target.data('rel')); });
    cy.on('tap', 'node', (e) => {
      const n = e.target;
      const edges = n.connectedEdges(':visible');
      det.innerHTML = `<h3>${esc(n.data('label'))}</h3><p class="small muted">${esc((M.ENTITY_KINDS[n.data('kind')] || {}).label || '')}${n.data('cik') ? ' · CIK ' + esc(n.data('cik')) : ''}</p>
        ${n.data('names').length > 1 ? `<p class="small">Also reported as: ${esc(n.data('names').slice(1).join('; '))}</p>` : ''}
        <p class="small">${edges.length} visible relationship(s)</p>` + edges.slice(0, 40).map((x) => SOI.companyViews.relDetail(x.data('rel'), true)).join('');
    });
    // expand / collapse
    cy.on('dbltap', 'node', (e) => {
      const n = e.target;
      const leaves = n.neighborhood('node').filter((x) => x.degree(false) === 1);
      if (n.data('collapsed')) { leaves.style('display', 'element'); n.connectedEdges().style('display', 'element'); n.data('collapsed', false); }
      else { leaves.style('display', 'none'); n.data('collapsed', true); }
    });
    view.querySelector('#net-fit').addEventListener('click', () => cy.fit(undefined, 30));
    view.querySelector('#net-expand').addEventListener('click', () => { cy.elements().style('display', 'element'); cy.nodes().data('collapsed', false); });
    view.querySelector('#net-collapse').addEventListener('click', () => {
      cy.nodes('[kind="issuer"]').forEach((n) => { n.neighborhood('node').filter((x) => x.degree(false) === 1).style('display', 'none'); n.data('collapsed', true); });
    });
    view.querySelector('#net-search').addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      cy.elements().removeClass('faded hl');
      if (!q) return;
      const hit = cy.nodes().filter((n) => (n.data('names') || [n.data('label')]).join(' ').toLowerCase().includes(q));
      if (!hit.length) return;
      cy.elements().addClass('faded');
      hit.closedNeighborhood().removeClass('faded');
      hit.addClass('hl');
      cy.animate({ fit: { eles: hit.closedNeighborhood(), padding: 60 } }, { duration: 300 });
    });
    const rerender = () => { ctx.saveState(); render(view, ctx, issuers, view.querySelector('#net-iss').value, state); };
    view.querySelector('#net-iss').addEventListener('change', (e) => { location.hash = '#/network/' + encodeURIComponent(e.target.value); });
    view.querySelector('#net-top').addEventListener('change', (e) => { f.topN = Number(e.target.value); rerender(); });
    view.querySelector('#net-period').addEventListener('change', (e) => { f.period = e.target.value; rerender(); });
    const pct = view.querySelector('#net-pct');
    pct.addEventListener('input', () => { view.querySelector('#net-pct-val').textContent = pct.value + '%'; });
    pct.addEventListener('change', () => { f.minPct = Number(pct.value); rerender(); });
    view.querySelector('#net-nopct').addEventListener('change', (e) => { f.hideNoPct = e.target.checked; rerender(); });
    view.querySelector('#net-latest').addEventListener('change', (e) => { f.latestOnly = e.target.checked; rerender(); });
    view.querySelectorAll('[data-fam]').forEach((c) => c.addEventListener('change', () => { f.fams = [...view.querySelectorAll('[data-fam]:checked')].map((x) => x.dataset.fam); rerender(); }));
    view.querySelectorAll('[data-rel]').forEach((c) => c.addEventListener('change', () => { f.rels = [...view.querySelectorAll('[data-rel]:checked')].map((x) => x.dataset.rel); rerender(); }));
  }

  SOI.networkView = { render };
})(typeof globalThis !== 'undefined' ? globalThis : this);
