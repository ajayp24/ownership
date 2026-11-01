/* learn-views.js — the three Learning modules. */
(function (g) {
  'use strict';
  const SOI = (g.SOI = g.SOI || {});
  const { esc, famBadge } = SOI.ui;
  const L = SOI.learn, M = SOI.models, D = SOI.diagrams;

  function terms(view, sub) {
    const current = L.CONCEPTS.find((c) => c.id === sub) || L.CONCEPTS[0];
    const groups = [...new Set(L.CONCEPTS.map((c) => c.group))];
    view.innerHTML = `
      <div class="callout"><strong>How to read this module.</strong> Each term has a definition, a real or illustrative example, its role in SEC filings, how it relates to the other terms, the forms where it appears, a diagram and common misconceptions. "Real filing" examples come from the bundled SEC data and give the accession number so you can open the original.</div>
      <div class="concept-layout">
        <div class="concept-list">${groups.map((gname) => `<div class="grp">${esc(gname)}</div>` + L.CONCEPTS.filter((c) => c.group === gname).map((c) => `<button data-c="${c.id}" class="${c === current ? 'active' : ''}">${esc(c.name)}</button>`).join('')).join('')}</div>
        <div>
          <div class="card concept-sec">
            <div class="card-head"><h2>${esc(current.name)}</h2><div class="pill-row">${current.forms.map((f) => famBadge(f)).join('')}</div></div>
            <p>${esc(current.definition)}</p>
            <div class="grid g2">
              <div>
                <h4>Example <span class="badge ${current.example.kind === 'Real filing' ? 'b-reported' : 'b-neutral'}">${esc(current.example.kind)}</span></h4>
                <div class="example">${esc(current.example.text)}</div>
                <h4>Role in SEC filings</h4><p class="small">${esc(current.role)}</p>
                <h4>Relationship with other entities</h4><p class="small">${esc(current.relations)}</p>
              </div>
              <div><h4>Diagram</h4>${D.svgMini(current.diagram)}
                <div class="small muted" style="margin-top:4px">Colours and line styles follow the legend in "Relationship models".</div></div>
            </div>
            <h4>Key questions</h4>
            <dl class="qa">${current.qa.map(([q, a]) => `<dt>${esc(q)}</dt><dd>${esc(a)}</dd>`).join('')}</dl>
            <h4>Common misconceptions</h4>
            <ul class="small">${current.misconceptions.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>
          </div>
          <div class="card">
            <h3>How the participants differ</h3>
            <div class="table-wrap"><table class="data compare">
              <tr>${L.COMPARISON_ROWS[0].map((h) => `<th>${esc(h)}</th>`).join('')}</tr>
              ${L.COMPARISON_ROWS.slice(1).map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}
            </table></div>
          </div>
        </div>
      </div>`;
    view.querySelectorAll('[data-c]').forEach((b) => b.addEventListener('click', () => { location.hash = '#/learn/terms/' + b.dataset.c; }));
  }

  function relationships(view, sub, ctx) {
    const sc = L.SCENARIOS.find((s) => s.id === sub) || L.SCENARIOS[0];
    const types = [...new Set(sc.edges.map((e) => e[2]))];
    const enabled = new Set(types);
    view.innerHTML = `
      <div class="callout">Ownership words are often used loosely. Here each kind of relationship has its own edge colour and line style, so you can see that <strong>holding legal title</strong>, <strong>having beneficial ownership</strong>, <strong>voting</strong>, <strong>making investment decisions</strong>, <strong>managing</strong>, <strong>reporting</strong> and <strong>controlling</strong> are different things. An investment manager is never treated as the owner automatically.</div>
      <div class="card">
        <div class="card-head"><h3>Seven relationships, seven meanings</h3></div>
        <div class="table-wrap"><table class="data rule-table"><tr><th>Relationship</th><th>Meaning</th><th>Edge</th></tr>
        ${L.REL_CONCEPTS.map(([n, d, t]) => { const v = M.RELATIONSHIP_TYPES[t]; return `<tr><td>${esc(n)}</td><td>${esc(d)}</td><td><span class="legend"><span><span class="ln" style="border-top:3px ${v.style === 'dotted' ? 'dotted' : v.style === 'dashed' ? 'dashed' : 'solid'} ${v.color}"></span>${esc(v.label)}</span></span></td></tr>`; }).join('')}</table></div>
      </div>
      <div class="card">
        <div class="toolbar">${L.SCENARIOS.map((s) => `<button class="${s === sc ? 'primary' : ''}" data-s="${s.id}">${esc(s.title)}</button>`).join('')}<button data-s="real" class="${sub === 'real' ? 'primary' : ''}">Real example: Berkshire 13F + Walmart 13D</button></div>
        <div id="scenario-body"></div>
      </div>`;
    view.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => { location.hash = '#/learn/relationships/' + b.dataset.s; }));
    const body = view.querySelector('#scenario-body');
    if (sub === 'real') return realExample(body, ctx);
    body.innerHTML = `<p>${esc(sc.text)} <span class="badge b-neutral">Illustrative — invented names, no real figures</span></p>
      <div class="filters"><span class="lbl">Show edges</span><div class="grp">${types.map((t) => `<label class="chip-toggle"><input type="checkbox" data-t="${t}" checked><span class="ln" style="display:inline-block;width:16px;border-top:3px ${M.RELATIONSHIP_TYPES[t].style === 'dotted' ? 'dotted' : M.RELATIONSHIP_TYPES[t].style === 'dashed' ? 'dashed' : 'solid'} ${M.RELATIONSHIP_TYPES[t].color}"></span>${esc(M.RELATIONSHIP_TYPES[t].label)}</label>`).join('')}</div></div>
      <div class="graph-box" id="sc-graph"></div>
      <div style="margin-top:10px">${D.legendHtml([...new Set(sc.nodes.map((n) => n[2]))], types)}</div>
      <p class="small muted" style="margin-top:8px">Drag nodes, scroll to zoom. Click an edge to see what it means.</p><div id="edge-info"></div>`;
    let cy;
    const draw = () => {
      if (cy) cy.destroy();
      cy = D.mountScenario(body.querySelector('#sc-graph'), sc, enabled);
      ctx.track(cy);
      cy.on('tap', 'edge', (e) => {
        const t = e.target.data('type');
        const rc = L.REL_CONCEPTS.find((r) => r[2] === t);
        body.querySelector('#edge-info').innerHTML = `<div class="callout"><strong>${esc(M.RELATIONSHIP_TYPES[t].label)}:</strong> ${esc(e.target.data('label'))}. ${rc ? esc(rc[1]) : ''} ${M.RELATIONSHIP_TYPES[t].ownership ? 'This edge asserts a form of ownership.' : 'This edge does <em>not</em> assert ownership.'}</div>`;
      });
    };
    body.querySelectorAll('[data-t]').forEach((c) => c.addEventListener('change', () => { c.checked ? enabled.add(c.dataset.t) : enabled.delete(c.dataset.t); draw(); }));
    draw();
  }

  /** Real relationships taken from bundled filings (no invented data). */
  function realExample(body, ctx) {
    const recs = ctx.bundledRecords();
    const brk = recs.filter((r) => r.filing.formFamily === '13F' && r.filing.filerCik === '0001067983').sort((a, b) => (a.filing.reportPeriod < b.filing.reportPeriod ? 1 : -1))[0];
    const wmt = recs.filter((r) => r.filing.formFamily === '13D' && r.issuer.cik === '0000104169').sort((a, b) => (a.filing.filingDate < b.filing.filingDate ? 1 : -1))[0];
    if (!brk && !wmt) { body.innerHTML = '<div class="empty">Bundled SEC data not loaded.</div>'; return; }
    const elements = [];
    const add = (id, label, kind) => { if (!elements.find((e) => e.data.id === id)) elements.push({ data: { id, label, kind } }); };
    if (brk) {
      add('brk', brk.filing.filerName + '\n(13F filing manager)', 'manager');
      brk.extension.otherIncludedManagers.forEach((m, i) => { add('om' + i, m.name, 'manager'); elements.push({ data: { id: 'oe' + i, source: 'brk', target: 'om' + i, type: 'OTHER_INCLUDED_MANAGER', label: '#' + m.sequenceNumber } }); });
    }
    if (wmt) {
      add('wmt', wmt.issuer.name, 'issuer');
      wmt.extension.reportingPersons.forEach((p, i) => { add('rp' + i, p.name, 'beneficialOwner'); elements.push({ data: { id: 're' + i, source: 'rp' + i, target: 'wmt', type: 'BENEFICIAL_OWNERSHIP', label: `${p.percentOfClass}% (event ${wmt.extension.eventDate})` } }); });
    }
    body.innerHTML = `<p>Two real structures from the bundled SEC data:</p>
      <ul class="small">${brk ? `<li><strong>${esc(brk.filing.filerName)}</strong> 13F for period ${esc(brk.filing.reportPeriod)} (accession <span class="mono">${esc(brk.filing.accessionNumber)}</span>) lists ${brk.extension.otherIncludedManagers.length} Other Included Managers. This is a <em>reporting</em> relationship: their holdings are included in this 13F.</li>` : ''}
      ${wmt ? `<li><strong>${esc(wmt.issuer.name)}</strong> Schedule 13D (${esc(wmt.filing.formType)}, accession <span class="mono">${esc(wmt.filing.accessionNumber)}</span>, event ${esc(wmt.extension.eventDate)}) has ${wmt.extension.reportingPersons.length} reporting person(s); percentages are as reported on each cover page and can overlap.</li>` : ''}</ul>
      <div class="graph-box tall" id="real-graph"></div><div style="margin-top:10px">${D.legendHtml(['manager', 'beneficialOwner', 'issuer'], ['OTHER_INCLUDED_MANAGER', 'BENEFICIAL_OWNERSHIP'])}</div>`;
    const cy = cytoscape({ container: body.querySelector('#real-graph'), elements, style: D.cyStyle(), layout: { name: 'cose', animate: false, padding: 30, nodeRepulsion: 9000 }, wheelSensitivity: 0.25 });
    ctx.track(cy);
  }

  function filings(view, sub) {
    const f = L.FILINGS.find((x) => x.id === sub) || null;
    const tabs = `<div class="tabs"><button class="tab ${!f ? 'active' : ''}" data-f="">Comparison</button>${L.FILINGS.map((x) => `<button class="tab ${f === x ? 'active' : ''}" data-f="${x.id}">${esc(x.title)}</button>`).join('')}<button class="tab ${sub === 'codes' ? 'active' : ''}" data-f="codes">Form 4 transaction codes</button></div>`;
    let body = '';
    if (sub === 'codes') {
      const groups = [...new Set(Object.values(M.TRANSACTION_CODES).map((c) => c.group))];
      body = `<div class="card"><h2>Form 4 / Form 5 transaction codes</h2><p class="small">From the General Instructions to Form 4. The code describes the type of transaction; together with the A (acquired) / D (disposed) flag and the "owned following" figure it tells you what happened.</p>
        ${groups.map((gname) => `<h4>${esc(gname)}</h4><div class="table-wrap" style="margin-bottom:12px"><table class="data rule-table"><tr><th>Code</th><th>Meaning</th></tr>${Object.entries(M.TRANSACTION_CODES).filter(([, v]) => v.group === gname).map(([k, v]) => `<tr><td class="mono">${k}</td><td>${esc(v.label)}</td></tr>`).join('')}</table></div>`).join('')}
        <div class="callout"><strong>Most common in practice:</strong> P (purchase) and S (sale) are open-market or private trades; A (award) and M (option/RSU exercise or conversion) come from compensation plans; F is shares withheld for tax or exercise price; G is a gift. A "P" is usually the strongest signal of an insider's own investment decision.</div>
        <p class="small"><a href="https://www.sec.gov/files/forms-3-4-5.pdf" target="_blank" rel="noopener">SEC: Forms 3, 4 and 5 instructions (PDF)</a></p></div>`;
    } else if (f) {
      body = `<div class="card"><div class="card-head"><h2>${esc(f.title)}</h2>${famBadge(f.family)}</div><p><strong>Purpose.</strong> ${esc(f.purpose)}</p>
        ${f.sections.map(([h, html]) => `<h4>${esc(h)}</h4><div class="small">${html}</div>`).join('')}
        <p class="small sources" style="margin-top:14px">Source: <a href="${esc(f.source)}" target="_blank" rel="noopener">${esc(f.source)}</a>. Rules change; check the SEC text before relying on a deadline or threshold.</p></div>`;
      if (f.id === '13F') body = example13F() + body;
    } else {
      const C = L.COMPARISON;
      body = `<div class="card"><h2>13F vs 13D vs 13G vs Forms 3, 4 and 5</h2>
        <div class="table-wrap"><table class="data compare"><tr>${C.cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr>${C.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table></div>
        <p class="small muted" style="margin-top:8px">Deadlines reflect the October 2023 amendments to Regulation 13D-G (effective February 2024, with 13G deadline changes from 30 September 2024) and the Section 16 rules as amended in 2022–23. This is a learning summary, not legal advice.</p></div>
        <div class="grid g2">
          <div class="card"><h3>Which filing answers which question?</h3><ul class="small">
            <li><strong>"Which institutions held the stock at quarter end?"</strong> → Form 13F (by manager, historical).</li>
            <li><strong>"Who owns more than 5%, and do they want influence?"</strong> → Schedule 13D (with Item 4 purpose) or 13G (passive/institutional).</li>
            <li><strong>"What do directors and officers own, and what did they trade?"</strong> → Forms 3, 4 and 5.</li>
            <li><strong>"Who ultimately controls the company?"</strong> → Only what the filings state. Combine 13D/G items, Section 16 indirect-ownership notes and proxy statements; never assume.</li></ul></div>
          <div class="card"><h3>Why the numbers rarely match</h3><ul class="small">
            <li>Different dates: quarter end (13F), event date (13D/G), transaction date (Form 4).</li>
            <li>Different tests: investment discretion (13F), voting/dispositive power (13D/G), pecuniary interest (Section 16).</li>
            <li>Different scope: 13F counts all client accounts; 13D/G counts power; one person can appear in all three.</li>
            <li>Different share bases: classes (Class A vs Class C), and whether options or convertible securities are included.</li></ul></div>
        </div>`;
    }
    view.innerHTML = tabs + body;
    view.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { location.hash = '#/learn/filings' + (b.dataset.f ? '/' + b.dataset.f : ''); }));
  }

  /** A real 13F, shown so it is clear where the issuers are: one row per holding, each row a different issuer. */
  function example13F() {
    const e = g.SOI_EXAMPLE_13F;
    if (!e) return '';
    const { fmtUSD, fmtInt } = SOI.ui;
    const known = { '037833100': 'AAPL', '594918104': 'MSFT', '67066G104': 'NVDA', '023135106': 'AMZN', '02079K305': 'GOOGL', '02079K107': 'GOOGL', '30303M102': 'META', '084670702': 'BRK.B', '084670108': 'BRK.B', '46625H100': 'JPM', '88160R101': 'TSLA', '931142103': 'WMT' };
    const top = e.issuers.slice(0, 6).map((i) => i.issuerName);
    return `<div class="card">
      <div class="card-head"><h2>Real example: where are the issuers in a 13F?</h2><span class="badge b-reported">Real filing</span></div>
      <p>A 13F has <strong>no single issuer</strong>. The <strong>filer</strong> is the investment manager; the <strong>issuers</strong> are in the <strong>Information Table</strong>, one per row (column "Name of issuer" + CUSIP). Below is ${esc(e.filerName)}'s 13F for the quarter ending ${esc(e.reportPeriod)}.</p>
      <div class="flow13f">
        <div class="f-box f-filer"><div class="small muted">FILER (investment manager)</div><strong>${esc(e.filerName)}</strong><div class="small mono">CIK ${esc(e.filerCik)}</div></div>
        <div class="f-arrow">files →</div>
        <div class="f-box"><div class="small muted">FORM ${esc(e.formType)}</div><strong>Period ${esc(e.reportPeriod)}</strong><div class="small">filed ${esc(e.filingDate)} · <a href="${esc(e.indexUrl)}" target="_blank" rel="noopener">${esc(e.accessionNumber)}</a></div></div>
        <div class="f-arrow">lists →</div>
        <div class="f-box f-issuers"><div class="small muted">ISSUERS (information table)</div><strong>${e.issuers.length} issuer lines in ${e.rowsInTable} rows</strong><div class="small">${top.map(esc).join(' · ')} …</div></div>
      </div>
      <p class="small muted">Why ${e.rowsInTable} rows for ${e.issuers.length} issuers? The same holding is split into several rows when different <em>other included managers</em> (here ${e.otherIncludedManagers.length} Berkshire subsidiaries, e.g. ${esc(e.otherIncludedManagers.slice(0, 3).map((m) => '#' + m.sequenceNumber + ' ' + m.name).join(', '))}) share investment discretion. The table below adds those rows together per issuer.</p>
      <div class="table-wrap" style="max-height:460px;overflow:auto"><table class="data">
        <tr><th>#</th><th>Issuer (name of issuer)</th><th>Class</th><th>CUSIP</th><th class="num">Value (USD)</th><th class="num">Shares</th><th class="num">Rows</th><th>Other managers</th></tr>
        ${e.issuers.map((i, n) => `<tr><td class="num">${n + 1}</td><td><strong>${esc(i.issuerName)}</strong>${known[i.cusip] ? ` <a class="badge b-info" href="#/company/${encodeURIComponent(known[i.cusip])}">${known[i.cusip]} page →</a>` : ''}${i.putCall ? ` <span class="badge b-neutral">${esc(i.putCall)}</span>` : ''}</td>
          <td class="small">${esc(i.titleOfClass)}</td><td class="mono small">${esc(i.cusip)}</td><td class="num">${fmtUSD(i.valueUSD)}</td><td class="num">${fmtInt(i.shares)}</td><td class="num">${i.rows}</td><td class="small mono">${esc(i.otherManagers.join(', '))}</td></tr>`).join('')}
      </table></div>
      <p class="small muted" style="margin-top:8px">Values are whole US dollars as reported (filings from 2023 onward). Sum of all rows: ${fmtUSD(e.summary.tableValueTotal)}, matching the filing's summary page. Positions are as of ${esc(e.reportPeriod)}, not today. Upload these two XML files from <span class="mono">sample-data/form-13f</span> into the Filing Parser to see every row.</p>
    </div>`;
  }

  SOI.learnViews = { terms, relationships, filings };
})(typeof globalThis !== 'undefined' ? globalThis : this);
