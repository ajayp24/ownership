/* company-views.js — the per-issuer detail page (works for bundled companies and imported issuers). */
(function (g) {
  'use strict';
  const SOI = (g.SOI = g.SOI || {});
  const { esc, fmtInt, fmtUSD, fmtPct, fmtShares, famBadge, statusBadge, secLink, filingIndexUrl, jsonView, modal } = SOI.ui;
  const M = SOI.models, D = SOI.diagrams;

  const TABS = [['overview', 'Overview'], ['institutional', 'Institutional (13F)'], ['beneficial', 'Beneficial owners (13D/G)'], ['insiders', 'Insiders (Forms 3/4/5)'], ['summary', 'Ownership summary'], ['visualize', 'Visualise'], ['history', 'History'], ['filings', 'Filing explorer']];
  const accLink = (acc, url) => (acc ? `<a class="mono small" href="${esc(url || '')}" target="_blank" rel="noopener noreferrer">${esc(acc)}</a>` : '—');
  const indexUrlFor = (cik, acc) => (cik && acc ? `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc.replace(/-/g, '')}/${acc}-index.htm` : '');

  function render(view, ctx, issuer, state) {
    const opts = { asOf: ctx.today, cusip: state.cusip };
    const records = ctx.records(state.includeImported);
    const v = SOI.ownership.buildIssuerView(records, issuer, opts);
    state.period = state.period && v.institutional.periods.includes(state.period) ? state.period : v.institutional.periods[0];
    const importedCount = ctx.importedCount();
    view.innerHTML = `
      <div class="card-head" style="margin-bottom:6px"><h1 style="margin:0">${esc(issuer.displayName || issuer.name)}</h1>
        ${issuer.ticker ? `<span class="badge b-neutral mono">${esc(issuer.ticker)}</span>` : ''}${issuer.cik ? `<span class="badge b-neutral mono">CIK ${esc(issuer.cik)}</span>` : ''}
        <div class="spacer"></div>
        ${issuer.cusips && issuer.cusips.length > 1 ? `<label class="inline">Share class <select id="cusip-sel">${issuer.cusips.map((c) => `<option value="${c}" ${c === v.institutional.cusip ? 'selected' : ''}>${esc(c)} ${esc((issuer.classLabels || {})[c] || '')}</option>`).join('')}</select></label>` : ''}
        <label class="inline" title="Combine filings you imported from the parser with the bundled SEC data"><input type="checkbox" id="inc-imp" ${state.includeImported ? 'checked' : ''} ${importedCount ? '' : 'disabled'}> Include imported (${importedCount})</label>
      </div>
      <div class="tabs">${TABS.map(([k, l]) => `<button class="tab ${state.tab === k ? 'active' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
      <div id="tab-body"></div>`;
    view.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { state.tab = b.dataset.tab; ctx.saveState(); render(view, ctx, issuer, state); }));
    const cs = view.querySelector('#cusip-sel');
    if (cs) cs.addEventListener('change', () => { state.cusip = cs.value; ctx.saveState(); render(view, ctx, issuer, state); });
    view.querySelector('#inc-imp').addEventListener('change', (e) => { state.includeImported = e.target.checked; ctx.saveState(); render(view, ctx, issuer, state); });
    const body = view.querySelector('#tab-body');
    const rerender = () => render(view, ctx, issuer, state);
    ({ overview, institutional, beneficial, insiders, summary, visualize, history, filings })[state.tab](body, v, issuer, state, ctx, rerender, records);
  }

  // ------------------------------------------------------------------ A. overview
  function overview(body, v, issuer, state, ctx) {
    const so = issuer.sharesOutstanding;
    const inst = v.institutional, ben = v.beneficial, ins = v.insiders;
    const lp = inst.periods[0];
    const latestBen = ben.persons.map((p) => p.latest.filingDate).sort().pop();
    const latestIns = ins.window ? ins.window.to : '';
    const topMgr = lp ? inst.byPeriod[lp][0] : null;
    body.innerHTML = `
      <div class="grid g4" style="margin-bottom:16px">
        <div class="kpi"><div class="label">13F managers in data set</div><div class="value">${lp ? inst.byPeriod[lp].length : 0}</div><div class="sub">latest period ${esc(lp || '—')}</div></div>
        <div class="kpi"><div class="label">13D/G reporting persons</div><div class="value">${ben.persons.length}</div><div class="sub">latest filed ${esc(latestBen || '—')}</div></div>
        <div class="kpi"><div class="label">Insiders who filed</div><div class="value">${ins.people.length}</div><div class="sub">${ins.window ? `Forms 3/4/5 ${esc(ins.window.from)} → ${esc(ins.window.to)}` : 'no filings loaded'}</div></div>
        <div class="kpi"><div class="label">Overlap findings</div><div class="value">${v.overlaps.length}</div><div class="sub">see Ownership summary</div></div>
      </div>
      <div class="grid g2">
        <div class="card"><h3>Company profile</h3><dl class="facts">
          <dt>Issuer name (EDGAR)</dt><dd>${esc(issuer.name)}</dd>
          <dt>Ticker(s)</dt><dd>${esc((issuer.tickers || [issuer.ticker]).filter(Boolean).join(', ') || '—')}</dd>
          <dt>CIK</dt><dd class="mono">${esc(issuer.cik)} ${issuer.cik ? secLink(`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${issuer.cik}`, 'EDGAR') : ''}</dd>
          <dt>Exchange</dt><dd>${esc((issuer.exchanges || []).join(', ') || '—')}</dd>
          <dt>Industry (SIC)</dt><dd>${esc(issuer.sicDescription || '—')} ${issuer.sic ? `<span class="muted">(${esc(issuer.sic)})</span>` : ''}</dd>
          <dt>State of incorporation</dt><dd>${esc(issuer.stateOfIncorporation || '—')}</dd>
          <dt>Fiscal year end</dt><dd>${issuer.fiscalYearEnd ? esc(issuer.fiscalYearEnd.slice(0, 2) + '-' + issuer.fiscalYearEnd.slice(2)) + ' (MM-DD)' : '—'}</dd>
          <dt>CUSIP(s) used</dt><dd class="mono">${esc((issuer.cusips || []).join(', '))}</dd>
          ${issuer.classNote ? `<dt>Share classes</dt><dd>${esc(issuer.classNote)}</dd>` : ''}
          <dt>Shares outstanding</dt><dd>${so ? `${fmtInt(so.value)} as of ${esc(so.asOf)} <span class="muted">(${esc(so.form)} filed ${esc(so.filed)}, ${esc(so.concept)})</span>${so.usableAsDenominator ? '' : `<div class="small muted">${esc(so.note)}</div>`}` : '<span class="muted">Not available from the XBRL cover-page data; percentages of outstanding are not calculated.</span>'}</dd>
          <dt>Data retrieved</dt><dd>${esc((issuer.retrievedAt || '').slice(0, 10) || '—')}</dd>
        </dl></div>
        <div class="card"><h3>Who is who for ${esc(issuer.displayName || issuer.name)}</h3>
          <div class="who-grid" style="grid-template-columns:1fr 1fr">
            <div class="who"><b><span class="cat-dot" style="background:var(--c-issuer)"></span> Issuer</b>${esc(issuer.name)} — the company whose securities are reported. It does not file the 13Fs or 13Gs about itself.</div>
            <div class="who"><b><span class="cat-dot" style="background:var(--c-manager)"></span> Investment managers (13F filers)</b>${topMgr ? `e.g. ${esc(topMgr.managerName)} reported ${fmtShares(topMgr.shares)} shares for ${esc(lp)} under its investment discretion — not necessarily its own.` : 'No 13F data loaded.'}</div>
            <div class="who"><b><span class="cat-dot" style="background:var(--c-beneficial)"></span> Beneficial owners (13D/G reporting persons)</b>${ben.persons[0] ? `e.g. ${esc(ben.persons[0].name)}: ${fmtPct(ben.persons[0].latest.percentOfClass)} reported on ${esc(ben.persons[0].latest.formType)} (event ${esc(ben.persons[0].latest.eventDate)}).` : 'No 13D/G filings in the data set.'}</div>
            <div class="who"><b><span class="cat-dot" style="background:var(--c-insider)"></span> Insiders (Forms 3/4/5 filers)</b>${ins.people[0] ? `e.g. ${esc(ins.people[0].name)} (${esc(ins.people[0].roles.join(', '))}). Each insider is the filer of their own Forms 3/4/5.` : 'No Section 16 filings in the data set.'}</div>
          </div>
          <p class="small muted" style="margin-top:10px">The <strong>filer</strong> is whoever submitted each filing: the manager for a 13F, the reporting person(s) for a 13D/G, the insider for Forms 3/4/5.</p>
        </div>
      </div>
      <div class="card"><h3>Data coverage and dates</h3>
        ${v.quality.length ? v.quality.slice(0, 6).map((q) => `<div class="callout ${q.level === 'warning' ? 'warn' : ''}" style="margin-bottom:8px">${esc(q.text)}</div>`).join('') + (v.quality.length > 6 ? `<p class="small muted">${v.quality.length - 6} more notes in Ownership summary.</p>` : '') : '<p class="muted">No data-quality notes.</p>'}
      </div>`;
  }

  // ------------------------------------------------------------------ B. institutional
  function institutional(body, v, issuer, state, ctx, rerender) {
    const inst = v.institutional;
    if (!inst.periods.length) { body.innerHTML = '<div class="empty">No 13F data for this issuer in the loaded records.</div>'; return; }
    const rows = inst.byPeriod[state.period] || [];
    const prevMap = new Map(inst.changes.filter((c) => c.period === state.period).map((c) => [c.managerCik || c.managerName, c]));
    const missing = inst.latestByManager.filter((m) => m && !rows.find((r) => r.managerCik === m.managerCik));
    const confidential = inst.positions.filter((p) => p.period === state.period && p.confidentialOmitted && !p.shares);
    body.innerHTML = `
      <div class="callout"><strong>What this table is.</strong> Each row is one institutional investment manager's Form 13F position in ${esc(issuer.name)} (CUSIP <span class="mono">${esc(inst.cusip)}</span>) at the end of the reporting period. A 13F reports securities over which the manager has <em>investment discretion</em>; the manager is not necessarily the legal or beneficial owner. Positions are historical (quarter end) and do not show current holdings.</div>
      <div class="toolbar"><label class="inline">Reporting period <select id="period-sel">${inst.periods.map((p) => `<option ${p === state.period ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
        <span class="small muted">${rows.length} manager(s) reporting · data set contains ${inst.latestByManager.filter(Boolean).length} managers</span></div>
      <div class="table-wrap"><table class="data">
        <tr><th>Investment manager</th><th class="num">Shares</th><th class="num">Reported value</th><th class="num">% of outstanding</th><th>Change vs prior period</th><th>Investment discretion</th><th class="num">Voting: sole / shared / none</th><th>Period</th><th>Filed</th><th>Filing</th></tr>
        ${rows.map((p) => {
          const ch = prevMap.get(p.managerCik || p.managerName);
          const disc = Object.entries(p.discretion).map(([k, n]) => `${k} ${fmtShares(n)}`).join(', ');
          return `<tr><td><strong>${esc(p.managerName)}</strong><div class="mono muted small">CIK ${esc(p.managerCik)}</div>${p.otherManagersCount ? `<div class="small muted">${p.otherManagersCount} other included managers</div>` : ''}</td>
            <td class="num">${fmtInt(p.shares)}</td><td class="num">${fmtUSD(p.valueUSD)}</td>
            <td class="num">${p.pctOfOutstanding !== null ? `${fmtPct(p.pctOfOutstanding)} <span class="badge b-calculated" title="${esc(p.pctBasis)}">calc</span>` : `<span class="muted" title="${esc(p.pctBasis)}">n/a</span>`}</td>
            <td>${ch ? `<span class="${ch.delta > 0 ? 'delta-up' : ch.delta < 0 ? 'delta-down' : ''}">${ch.delta > 0 ? '+' : ''}${fmtShares(ch.delta)}${ch.deltaPct !== null ? ` (${ch.deltaPct > 0 ? '+' : ''}${ch.deltaPct.toFixed(1)}%)` : ''}</span><div class="small muted">vs ${esc(ch.prevPeriod)} · ${esc(ch.status)}</div>` : '<span class="muted small">no prior period</span>'}</td>
            <td class="small">${esc(disc)}</td>
            <td class="num small">${fmtShares(p.votingAuthority.sole)} / ${fmtShares(p.votingAuthority.shared)} / ${fmtShares(p.votingAuthority.none)}</td>
            <td class="nowrap">${esc(p.period)}</td><td class="nowrap">${esc(p.filingDate)}</td>
            <td>${p.accessionNumbers.map((a, i) => accLink(a, indexUrlFor(p.managerCik, a)) + ` <span class="small muted">${esc(p.formTypes[i])}</span>`).join('<br>')}${p.amendmentNotes.length ? `<div class="small muted" title="${esc(p.amendmentNotes.join(' '))}">amendment applied ⓘ</div>` : ''}</td></tr>`;
        }).join('')}
      </table></div>
      ${confidential.length ? `<div class="callout warn" style="margin-top:12px"><strong>Confidential treatment.</strong> ${confidential.map((p) => `${esc(p.managerName)}'s ${esc(p.period)} 13F (${esc(p.accessionNumbers.join(', '))}) states that confidential information was omitted and lists no position in this issuer.`).join(' ')} Absence from the table does not mean no position.</div>` : ''}
      ${missing.length ? `<p class="small muted" style="margin-top:10px">Not shown for ${esc(state.period)} (no filing for this period in the data set, or no position): ${missing.map((m) => `${esc(m.managerName)} (latest ${esc(m.period)})`).join('; ')}.</p>` : ''}
      ${rows.some((r) => r.options.length || r.debt.length || r.otherClasses.length) ? `<div class="card" style="margin-top:14px"><h3>Other securities of this issuer reported in the same 13Fs</h3><p class="small muted">Shown separately because options (underlying shares, not shares held), debt (principal amount) and other share classes are not the same unit as the common shares above.</p>
        <div class="table-wrap"><table class="data"><tr><th>Manager</th><th>Security</th><th>CUSIP</th><th class="num">Amount</th><th class="num">Value</th></tr>
        ${rows.flatMap((r) => r.options.map((o) => `<tr><td>${esc(r.managerName)}</td><td>${esc(o.putCall)} options</td><td class="mono">${esc(o.cusip)}</td><td class="num">${fmtInt(o.underlyingShares)} underlying</td><td class="num">${fmtUSD(o.valueUSD)}</td></tr>`).concat(r.debt.map((d) => `<tr><td>${esc(r.managerName)}</td><td>${esc(d.securityClass)} (debt)</td><td class="mono">${esc(d.cusip)}</td><td class="num">${fmtInt(d.principal)} principal</td><td class="num">${fmtUSD(d.valueUSD)}</td></tr>`), r.otherClasses.map((d) => `<tr><td>${esc(r.managerName)}</td><td>${esc(d.securityClass)}</td><td class="mono">${esc(d.cusip)}</td><td class="num">${fmtInt(d.shares)} shares</td><td class="num">${fmtUSD(d.valueUSD)}</td></tr>`))).join('')}</table></div></div>` : ''}
      <p class="small muted" style="margin-top:10px">% of outstanding is calculated only for single-class issuers, as shares ÷ shares outstanding from the issuer's XBRL cover page (date shown on hover). ${esc(v.denominator.usable ? '' : v.denominator.reason)}</p>`;
    body.querySelector('#period-sel').addEventListener('change', (e) => { state.period = e.target.value; ctx.saveState(); rerender(); });
  }

  // ------------------------------------------------------------------ C. beneficial
  function beneficial(body, v, issuer) {
    const ben = v.beneficial;
    if (!ben.persons.length) { body.innerHTML = `<div class="empty">No Schedule 13D or 13G filings about ${esc(issuer.name)} in the loaded records.</div><p class="small muted" style="margin-top:8px">Bundled data covers structured-XML 13D/G filings (from December 2024). Older filings can be parsed with the Filing Parser (legacy HTML/TXT support) and imported.</p>`; return; }
    body.innerHTML = `
      <div class="callout"><strong>Beneficial ownership</strong> under Rule 13d-3 means having or sharing voting power and/or investment (dispositive) power. Percentages are <strong>as reported by the filer</strong> on the cover page, measured on the event date. Joint filers can report the same shares; amounts are never summed here.</div>
      <div class="table-wrap"><table class="data">
        <tr><th>Reporting person</th><th>Type</th><th>Latest filing</th><th>Class</th><th>Event date</th><th>Filed</th><th class="num">Aggregate</th><th class="num">% of class</th><th class="num">Voting sole / shared</th><th class="num">Dispositive sole / shared</th><th>Status</th></tr>
        ${ben.persons.map((p) => { const l = p.latest; return `<tr><td><strong>${esc(p.name)}</strong>${p.cik ? `<div class="mono muted small">CIK ${esc(p.cik)}</div>` : ''}${l.jointFilers > 1 ? `<div class="small muted">joint filing with ${l.jointFilers - 1} other(s)</div>` : ''}${l.filerName && l.filerName !== p.name ? `<div class="small muted">filed by ${esc(l.filerName)}</div>` : ''}</td>
          <td class="small">${esc(l.types.map((t) => `${t} (${M.REPORTING_PERSON_TYPES[t] || t})`).join(', '))}${l.rules.length ? `<div class="muted">${esc(l.rules.join(', '))}</div>` : ''}</td>
          <td>${famBadge(l.schedule, l.formType)}${l.amendmentNumber ? `<div class="small muted">amendment ${l.amendmentNumber}</div>` : ''}</td>
          <td class="small">${esc(l.securityClass)}</td><td class="nowrap">${esc(l.eventDate)}</td><td class="nowrap">${esc(l.filingDate)}</td>
          <td class="num">${fmtInt(l.shares)}</td><td class="num">${fmtPct(l.percentOfClass)} <span class="badge b-reported">reported</span></td>
          <td class="num small">${fmtShares(l.soleVoting)} / ${fmtShares(l.sharedVoting)}</td><td class="num small">${fmtShares(l.soleDispositive)} / ${fmtShares(l.sharedDispositive)}</td>
          <td class="small">${esc(p.status)}<div>${accLink(l.accessionNumber, l.sourceUrl)}</div>
            ${p.history.length > 1 ? `<details class="hist"><summary>${p.history.length} filings</summary>${p.history.slice().reverse().map((h) => `<div class="small">${esc(h.filingDate)} · ${esc(h.formType)} · ${fmtInt(h.shares)} · ${fmtPct(h.percentOfClass)}</div>`).join('')}</details>` : ''}
            ${l.comments ? `<details class="hist"><summary>filer comment</summary><div class="small">${esc(l.comments.slice(0, 800))}</div></details>` : ''}</td></tr>`; }).join('')}
      </table></div>
      ${ben.persons.some((p) => p.latest.purpose) ? `<div class="card" style="margin-top:14px"><h3>Schedule 13D — Item 4, purpose of transaction</h3>${ben.persons.filter((p) => p.latest.purpose && p.latest.schedule === '13D').slice(0, 3).map((p) => `<h4>${esc(p.name)} · ${esc(p.latest.formType)} ${esc(p.latest.accessionNumber)}</h4><p class="small" style="white-space:pre-wrap">${esc(p.latest.purpose.slice(0, 1500))}${p.latest.purpose.length > 1500 ? '…' : ''}</p>`).join('')}</div>` : ''}`;
  }

  // ------------------------------------------------------------------ D. insiders
  function insiders(body, v, issuer, state, ctx, rerender) {
    const ins = v.insiders;
    if (!ins.people.length) { body.innerHTML = '<div class="empty">No Forms 3/4/5 in the loaded records for this issuer.</div>'; return; }
    const f = state.insFilter || (state.insFilter = { person: '', code: '', ad: '' });
    const tx = ins.transactions.filter((t) => (!f.person || t.ownerName === f.person) && (!f.code || t.code === f.code) && (!f.ad || t.acquiredDisposed === f.ad));
    const codes = [...new Set(ins.transactions.map((t) => t.code).filter(Boolean))].sort();
    body.innerHTML = `
      <div class="callout">Directors, officers and 10% owners report under Section 16. Holdings below are the latest "owned following" figure per security and form of ownership in the loaded filings (window ${esc(ins.window.from)} → ${esc(ins.window.to)}), not a complete or current shareholding. Forms 3/4/5 do not report a percentage of class.</div>
      <div class="card"><h3>Insiders and latest reported holdings</h3>
      <div class="table-wrap" style="max-height:420px;overflow:auto"><table class="data"><tr><th>Insider</th><th>Position</th><th>Security</th><th>Direct / indirect</th><th class="num">Shares after last reported transaction</th><th>As of</th><th>Source</th></tr>
      ${ins.people.map((p) => { const hs = p.holdings.length ? p.holdings : [null]; return hs.map((h, i) => `<tr>${i === 0 ? `<td rowspan="${hs.length}"><strong>${esc(p.name)}</strong><div class="mono muted small">CIK ${esc(p.cik)}</div></td><td rowspan="${hs.length}" class="small">${esc(p.roles.join(', '))}</td>` : ''}
        ${h ? `<td class="small">${esc(h.securityClass)}</td><td class="small">${h.nature === 'indirect' ? `Indirect — ${esc(h.natureDetail || 'nature not stated')}` : 'Direct'}${h.jointFiling ? ' <span class="badge b-neutral">joint filing</span>' : ''}</td><td class="num">${fmtInt(h.shares)}</td><td class="nowrap">${esc(h.asOfDate)}</td><td>${accLink(h.accessionNumber, indexUrlFor(issuer.cik, h.accessionNumber))} <span class="small muted">${esc(h.formType)}</span></td>` : '<td colspan="5" class="muted small">No non-derivative holdings reported in the loaded filings</td>'}</tr>`).join(''); }).join('')}
      </table></div></div>
      <div class="card"><div class="card-head"><h3>Insider transactions</h3><div class="spacer"></div>
        <select id="f-person"><option value="">All insiders</option>${[...new Set(ins.transactions.map((t) => t.ownerName))].sort().map((n) => `<option ${n === f.person ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
        <select id="f-code"><option value="">All codes</option>${codes.map((c) => `<option value="${c}" ${c === f.code ? 'selected' : ''}>${c} — ${esc((M.TRANSACTION_CODES[c] || {}).label || '')}</option>`).join('')}</select>
        <select id="f-ad"><option value="">Acquired & disposed</option><option value="A" ${f.ad === 'A' ? 'selected' : ''}>Acquired (A)</option><option value="D" ${f.ad === 'D' ? 'selected' : ''}>Disposed (D)</option></select></div>
      <div class="table-wrap" style="max-height:520px;overflow:auto"><table class="data"><tr><th>Insider</th><th>Position</th><th>Transaction date</th><th>Code</th><th>Security</th><th class="num">Acquired</th><th class="num">Disposed</th><th class="num">Price</th><th class="num">Owned after</th><th>D/I</th><th>Filing</th></tr>
      ${tx.slice(0, 600).map((t) => `<tr><td>${esc(t.ownerName)}</td><td class="small">${esc(t.ownerRoles)}</td><td class="nowrap">${esc(t.transactionDate)}</td>
        <td><span class="badge b-neutral" title="${esc(t.codeDescription || '')}">${esc(t.code)}</span>${t.aff10b5One ? ' <span class="badge b-info" title="Rule 10b5-1 box checked on this filing">10b5-1</span>' : ''}</td>
        <td class="small">${esc(t.securityTitle)}${t.table === 'derivative' ? ' <span class="badge b-neutral">derivative</span>' : ''}</td>
        <td class="num">${t.acquiredDisposed === 'A' ? fmtInt(t.shares) : ''}</td><td class="num">${t.acquiredDisposed === 'D' ? fmtInt(t.shares) : ''}</td>
        <td class="num">${t.pricePerShare ? '$' + Number(t.pricePerShare).toFixed(2) : '—'}</td><td class="num">${fmtInt(t.sharesOwnedFollowing)}</td>
        <td class="small" title="${esc(t.natureOfOwnership)}">${esc(t.directOrIndirect)}${t.natureOfOwnership ? ' · ' + esc(t.natureOfOwnership.slice(0, 30)) : ''}</td>
        <td>${accLink(t.accessionNumber, indexUrlFor(issuer.cik, t.accessionNumber))} <span class="small muted">${esc(t.formType)} ${esc(t.filingDate)}</span>${t.footnoteText ? ` <span title="${esc(t.footnoteText)}" class="small muted">ⓘ</span>` : ''}</td></tr>`).join('')}
      </table></div><p class="small muted">${tx.length} transaction rows${tx.length > 600 ? ' (first 600 shown)' : ''}. Hover ⓘ for footnotes. Price is per share as reported (some awards have no price).</p></div>`;
    const bind = (id, key) => body.querySelector(id).addEventListener('change', (e) => { f[key] = e.target.value; rerender(); });
    bind('#f-person', 'person'); bind('#f-code', 'code'); bind('#f-ad', 'ad');
  }

  // ------------------------------------------------------------------ E. summary
  function summary(body, v, issuer) {
    const inst = v.institutional, ben = v.beneficial, ins = v.insiders, c = v.concentration;
    const lp = inst.periods[0];
    const top = lp ? inst.byPeriod[lp].slice(0, 5) : [];
    const ch = inst.changes.filter((x) => x.period === lp).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 5);
    const buys = ins.transactions.filter((t) => t.code === 'P'), sells = ins.transactions.filter((t) => t.code === 'S');
    body.innerHTML = `
      <div class="callout warn"><strong>Three separate views, never added together.</strong> Institutional 13F positions, 13D/G beneficial ownership and Section 16 insider holdings use different legal tests, dates and share bases, and often describe the same shares. The panels below are kept apart on purpose; overlaps are listed under "Overlapping disclosures".</div>
      <div class="grid g3">
        <div class="card"><div class="cat-head"><span class="cat-dot" style="background:var(--c-manager)"></span><h3 style="margin:0">Major institutional holders</h3></div><p class="small muted">Form 13F · period ${esc(lp || '—')} · investment discretion</p>
          ${top.map((p) => `<div class="small" style="display:flex;justify-content:space-between;gap:8px;border-bottom:1px solid var(--border);padding:4px 0"><span>${esc(p.managerName)}</span><span class="num">${fmtShares(p.shares)}${p.pctOfOutstanding !== null ? ' · ' + fmtPct(p.pctOfOutstanding) : ''}</span></div>`).join('') || '<p class="muted small">None loaded</p>'}</div>
        <div class="card"><div class="cat-head"><span class="cat-dot" style="background:var(--c-beneficial)"></span><h3 style="margin:0">Significant beneficial owners</h3></div><p class="small muted">Schedules 13D/G · latest filing per person · reported %</p>
          ${ben.persons.slice(0, 6).map((p) => `<div class="small" style="display:flex;justify-content:space-between;gap:8px;border-bottom:1px solid var(--border);padding:4px 0"><span>${esc(p.name)} <span class="muted">(${esc(p.latest.eventDate)})</span></span><span class="num">${fmtPct(p.latest.percentOfClass)}</span></div>`).join('') || '<p class="muted small">None loaded</p>'}</div>
        <div class="card"><div class="cat-head"><span class="cat-dot" style="background:var(--c-insider)"></span><h3 style="margin:0">Insider holdings</h3></div><p class="small muted">Forms 3/4/5 · largest latest direct or indirect line</p>
          ${ins.people.filter((p) => p.holdings.length).sort((a, b) => b.holdings[0].shares - a.holdings[0].shares).slice(0, 6).map((p) => `<div class="small" style="display:flex;justify-content:space-between;gap:8px;border-bottom:1px solid var(--border);padding:4px 0"><span>${esc(p.name)} <span class="muted">(${esc(p.holdings[0].nature)}, ${esc(p.holdings[0].asOfDate)})</span></span><span class="num">${fmtShares(p.holdings[0].shares)}</span></div>`).join('') || '<p class="muted small">None loaded</p>'}</div>
      </div>
      <div class="grid g2">
        <div class="card"><h3>Reported ownership changes</h3>
          <h4>13F: largest changes into ${esc(lp || '—')}</h4>${ch.map((x) => `<div class="small">${esc(x.managerName)}: <span class="${x.delta > 0 ? 'delta-up' : x.delta < 0 ? 'delta-down' : ''}">${x.delta > 0 ? '+' : ''}${fmtShares(x.delta)}</span> vs ${esc(x.prevPeriod)} (${esc(x.status)})</div>`).join('') || '<p class="small muted">No consecutive periods to compare.</p>'}
          <h4>Insider open-market activity (loaded window)</h4><p class="small">Purchases (P): ${buys.length} rows, ${fmtInt(buys.reduce((s, t) => s + (t.shares || 0), 0))} shares · Sales (S): ${sells.length} rows, ${fmtInt(sells.reduce((s, t) => s + (t.shares || 0), 0))} shares.</p>
          <h4>13D/G filings</h4><p class="small">${ben.filings} filing(s) about this issuer; ${ben.persons.filter((p) => p.status.startsWith('At or below')).length} reporting person(s) at or below 5% in their latest filing.</p></div>
        <div class="card"><h3>Concentration of reported 13F positions</h3>${c ? `
          <div class="grid g2" style="margin-bottom:8px"><div class="kpi"><div class="label">Top 10 managers (${esc(c.period)})</div><div class="value">${fmtShares(c.top10Shares)}</div><div class="sub">${c.top10Pct !== null ? fmtPct(c.top10Pct) + ' of outstanding (calculated)' : 'no denominator'}</div></div>
          <div class="kpi"><div class="label">Excluding flagged overlaps</div><div class="value">${fmtShares(c.top10SharesExFlagged)}</div><div class="sub">${c.flaggedInTop10.length ? 'excludes ' + esc(c.flaggedInTop10.join(', ')) : 'no managers flagged'}</div></div></div>
          <p class="small muted">${esc(c.note)}</p>` : '<p class="muted">No 13F data.</p>'}</div>
      </div>
      <div class="card"><h3>Overlapping disclosures (${v.overlaps.length})</h3>
        ${v.overlaps.length ? v.overlaps.map((o) => `<div class="finding"><div class="fh"><strong>${esc(o.kind)}</strong>${statusBadge(o.status)}<span class="badge b-neutral">confidence: ${esc(o.confidence)}</span><span class="small muted">basis: ${esc(o.basis)}</span></div>${esc(o.text)}<div class="small muted mono">evidence: ${esc(o.evidence.join(' · '))}</div></div>`).join('') : '<p class="muted">No overlaps detected in the loaded records.</p>'}
      </div>
      <div class="card"><h3>Data quality, staleness and conflicts (${v.quality.length})</h3>
        ${v.quality.map((q) => `<div class="finding"><div class="fh"><span class="badge ${q.level === 'warning' ? 'b-warn' : 'b-info'}">${esc(q.level)}</span></div>${esc(q.text)}${q.evidence ? `<div class="small muted mono">${esc([].concat(q.evidence).join(' · '))}</div>` : ''}</div>`).join('') || '<p class="muted">None.</p>'}
        <p class="small muted">The engine never names an "ultimate beneficial owner" that the filings themselves do not establish. Relationships marked <em>inferred</em> come from name matching and need checking.</p>
      </div>`;
  }

  // ------------------------------------------------------------------ F. visualise (simple views first, graphs on request)
  function visualize(body, v, issuer, state, ctx, rerender) {
    const sub = state.viz === 'links' || state.viz === 'graph' ? state.viz : 'map';
    body.innerHTML = `<div class="toolbar">
        <button data-v="map" class="${sub === 'map' ? 'primary' : ''}">Ownership map</button>
        <button data-v="links" class="${sub !== 'map' ? 'primary' : ''}">Who is connected to whom</button>
        <a class="btn" href="#/network/${encodeURIComponent(issuer.ticker || issuer.cik)}">Full network graph →</a></div><div id="viz"></div>`;
    body.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => { state.viz = b.dataset.v; ctx.saveState(); rerender(); }));
    const el = body.querySelector('#viz');
    if (sub === 'map') ownershipMap(el, v, issuer);
    else if (sub === 'links') relationshipList(el, v, issuer, state, ctx, rerender);
    else entityView(el, v, issuer, ctx, state, rerender);
  }

  /** View 1: issuer on top, three plain lists with bars — one per type of filing. */
  function ownershipMap(el, v, issuer) {
    const lp = v.institutional.periods[0];
    const inst = (lp ? v.institutional.byPeriod[lp] : []).slice(0, 8).map((p) => ({
      name: p.managerName, size: p.shares,
      fig: `${fmtShares(p.shares)} shares${p.pctOfOutstanding !== null ? ' · ' + fmtPct(p.pctOfOutstanding) : ''}`,
      meta: `13F · quarter ending ${p.period}`, link: indexUrlFor(p.managerCik, p.accessionNumbers[p.accessionNumbers.length - 1]),
      tip: p.pctBasis,
    }));
    const ben = v.beneficial.persons.slice(0, 8).map((p) => ({
      name: p.name, size: p.latest.percentOfClass || 0,
      fig: `${fmtPct(p.latest.percentOfClass)} · ${fmtShares(p.latest.shares)} shares`,
      meta: `${p.latest.formType} · as of ${p.latest.eventDate}`, link: p.latest.sourceUrl,
      tip: p.latest.jointFilers > 1 ? `Joint filing with ${p.latest.jointFilers - 1} other person(s); amounts can overlap.` : '',
    }));
    const ins = v.insiders.people.filter((p) => p.holdings.length).sort((a, b) => b.holdings[0].shares - a.holdings[0].shares).slice(0, 8).map((p) => ({
      name: p.name, size: p.holdings[0].shares,
      fig: `${fmtShares(p.holdings[0].shares)} shares · ${p.holdings[0].nature}`,
      meta: `${p.roles.join(', ') || 'Insider'} · ${p.holdings[0].formType} ${p.holdings[0].asOfDate}`, link: indexUrlFor(issuer.cik, p.holdings[0].accessionNumber),
      tip: p.holdings[0].natureDetail || '',
    }));
    const col = (title, sub, color, rows, empty) => {
      const max = Math.max(...rows.map((r) => r.size), 1);
      return `<div class="omap-col"><div class="omap-head" style="border-color:${color}"><strong>${title}</strong><div class="small muted">${sub}</div></div>
        ${rows.length ? rows.map((r) => `<div class="omap-row" title="${esc(r.tip)}"><div class="omap-name">${esc(r.name)}</div>
          <div class="omap-bar"><span style="width:${Math.max(2, (r.size / max) * 100)}%;background:${color}"></span></div>
          <div class="omap-fig">${esc(r.fig)}</div><div class="omap-meta">${esc(r.meta)}${r.link ? ` · <a href="${esc(r.link)}" target="_blank" rel="noopener noreferrer">filing</a>` : ''}</div></div>`).join('') : `<p class="small muted">${empty}</p>`}</div>`;
    };
    el.innerHTML = `
      <div class="omap">
        <div class="omap-issuer"><div class="small muted">ISSUER</div><strong>${esc(issuer.displayName || issuer.name)}</strong><div class="small mono">${esc(issuer.ticker || '')} · CIK ${esc(issuer.cik || '—')}</div></div>
        <div class="omap-arrows"><span>↓</span><span>↓</span><span>↓</span></div>
        <div class="omap-cols">
          ${col('Institutional holders', 'Form 13F · manages the shares for clients', 'var(--c-manager)', inst, 'No 13F data.')}
          ${col('Big owners (over 5%)', 'Schedule 13D / 13G · reported % of class', 'var(--c-beneficial)', ben, 'No 13D/13G filings in the data.')}
          ${col('Insiders', 'Forms 3/4/5 · directors, officers, 10% owners', 'var(--c-insider)', ins, 'No insider holdings in the data.')}
        </div>
      </div>
      <div class="callout" style="margin-top:14px">Read each column on its own. The three lists come from different filings, dates and legal tests, and often describe the same shares, so <strong>do not add them up</strong>. Bars compare entries within a column only. Hover a row for notes; "filing" opens the original on SEC EDGAR.</div>`;
  }

  /** View 2 (simple): relationships written as plain sentences, grouped by kind. */
  function relationshipList(el, v, issuer, state, ctx, rerender) {
    const latest = new Map();
    v.relationships.filter((r) => r.type !== 'REPORTED_13F_HOLDING').forEach((r) => {
      const k = r.type + '|' + (r.from.cik || r.from.name) + '|' + (r.to.cik || r.to.name) + '|' + (r.natureDetail || '');
      const p = latest.get(k);
      if (!p || (r.evidence.filingDate || '') > (p.evidence.filingDate || '')) latest.set(k, r);
    });
    const rels = [...latest.values()];
    const src = (r) => `<span class="small muted">${esc(r.evidence.formType)} · ${esc(r.asOfDate || r.evidence.filingDate)}${r.evidence.accessionNumber ? ' · <span class="mono">' + esc(r.evidence.accessionNumber) + '</span>' : ''}</span>`;
    const name = (s) => `<strong>${esc(s)}</strong>`;
    const groups = [
      ['Insider roles', 'From Forms 3/4/5: the box the person ticked.', rels.filter((r) => r.type === 'INSIDER_ROLE'),
        (r) => `${name(r.from.name)} is ${esc((r.roles || []).join(', ') || 'an insider')} of ${esc(issuer.displayName || issuer.name)}`],
      ['Shares held through another entity', 'From Form 4 "indirect" lines (trusts, LLCs, family members).', rels.filter((r) => r.type === 'INDIRECT_OWNERSHIP'),
        (r) => `${name(r.from.name)} holds ${fmtShares(r.shares)} shares indirectly — ${esc(r.natureDetail || 'nature not stated')}`],
      ['Big owners (13D / 13G)', 'Each reporting person\'s own figure; joint filers can overlap.', rels.filter((r) => r.type === 'BENEFICIAL_OWNERSHIP'),
        (r) => `${name(r.from.name)} reports ${fmtPct(r.percentOfClass)} (${fmtShares(r.shares)} shares) of the ${esc(r.securityClass || 'class')}`],
      ['Filed together', 'Persons named on the same Schedule 13D/13G.', rels.filter((r) => r.type === 'JOINT_FILER'),
        (r) => `${name(r.from.name)} and ${name(r.to.name)} filed jointly`],
    ];
    // Other included managers: one sentence per filing manager instead of one per link
    const oim = new Map();
    rels.filter((r) => r.type === 'OTHER_INCLUDED_MANAGER').forEach((r) => { const k = r.from.name; (oim.get(k) || oim.set(k, []).get(k)).push(r); });
    const oimRows = [...oim.entries()].map(([mgr, list]) => ({ mgr, list }));
    el.innerHTML = `
      <p class="small muted">Plain-language list of how the people and organisations in this company's filings are connected. Every line comes from a filing (form, date and accession shown).</p>
      <div class="grid g2">${groups.map(([title, note, list, fmt]) => `<div class="card"><div class="card-head"><h3>${title}</h3><span class="badge b-neutral">${list.length}</span></div><p class="small muted">${note}</p>
        ${list.length ? `<ul class="rel-list">${list.slice(0, 12).map((r) => `<li>${fmt(r)}<br>${src(r)}</li>`).join('')}</ul>${list.length > 12 ? `<p class="small muted">…and ${list.length - 12} more.</p>` : ''}` : '<p class="small muted">None in the loaded filings.</p>'}</div>`).join('')}
        <div class="card"><div class="card-head"><h3>13F filed on behalf of other managers</h3><span class="badge b-neutral">${oimRows.length}</span></div><p class="small muted">A manager's 13F can include holdings of affiliated managers ("other included managers"). This is a reporting link, not ownership.</p>
        ${oimRows.length ? `<ul class="rel-list">${oimRows.map(({ mgr, list }) => `<li>${name(mgr)}'s 13F includes ${list.length} other manager(s): ${esc(list.slice(0, 5).map((r) => r.to.name).join(', '))}${list.length > 5 ? '…' : ''}</li>`).join('')}</ul>` : '<p class="small muted">None.</p>'}</div>
      </div>
      <div class="toolbar"><button id="as-graph">Show the same links as a graph</button></div>`;
    el.querySelector('#as-graph').addEventListener('click', () => { state.viz = 'graph'; ctx.saveState(); rerender(); });
  }

  function entityView(el, v, issuer, ctx, state, rerender) {
    const rels = v.relationships.filter((r) => ['OTHER_INCLUDED_MANAGER', 'JOINT_FILER', 'INSIDER_ROLE', 'INDIRECT_OWNERSHIP', 'BENEFICIAL_OWNERSHIP', 'CONTROLS', 'MANAGES'].includes(r.type));
    // Latest only for insider roles / indirect ownership, to keep the view readable
    const seen = new Set();
    const pick = rels.slice().sort((a, b) => (a.evidence.filingDate < b.evidence.filingDate ? 1 : -1)).filter((r) => {
      const k = r.type + '|' + (r.from.cik || r.from.name) + '|' + (r.to.cik || r.to.name) + '|' + (r.natureDetail || '');
      if (seen.has(k)) return false; seen.add(k); return true;
    });
    // add indirect-holding intermediaries as explicit entities ("By Trust" → entity node) when a name is stated
    const extra = [];
    pick.filter((r) => r.type === 'INDIRECT_OWNERSHIP' && r.natureDetail).forEach((r) => {
      const ent = { name: r.natureDetail.replace(/^by\s+/i, ''), cik: '', kind: 'entity' };
      extra.push(Object.assign({}, r, { type: 'CONTROLS', to: ent, status: 'inferred', confidence: 'low', evidence: Object.assign({}, r.evidence, { note: 'Nature of indirect ownership as stated on Form 4; the holding vehicle is shown as a separate entity. The control link is inferred from the wording.' }) }));
      extra.push(Object.assign({}, r, { from: ent }));
    });
    const all = pick.filter((r) => r.type !== 'INDIRECT_OWNERSHIP' || !r.natureDetail).concat(extra);
    const graph = SOI.relationships.toGraph(all, issuer, { edgeLabel: (r) => (M.RELATIONSHIP_TYPES[r.type] || {}).label.split(' (')[0] });
    el.innerHTML = `<div class="toolbar"><button id="back-list">← Back to the plain list</button></div><p class="small muted">The same links as a graph. Click a dot or a line for its source filing. Links marked inferred come from wording (e.g. "By Trust"), not from a structured field.</p>
      <div class="graph-side"><div class="graph-box tall" id="ent"></div><div class="card detail-panel" id="ent-detail"><p class="muted">Click a node or an edge.</p></div></div>
      <div style="margin-top:10px">${D.legendHtml(null, ['OTHER_INCLUDED_MANAGER', 'JOINT_FILER', 'INSIDER_ROLE', 'INDIRECT_OWNERSHIP', 'BENEFICIAL_OWNERSHIP', 'CONTROLS'])}</div>`;
    el.querySelector('#back-list').addEventListener('click', () => { state.viz = 'links'; ctx.saveState(); rerender(); });
    if (!graph.edges.length) { el.querySelector('#ent').innerHTML = '<div class="empty" style="margin:20px">No entity relationships in the loaded filings.</div>'; return; }
    const cy = cytoscape({ container: el.querySelector('#ent'), elements: graph.nodes.concat(graph.edges), style: D.cyStyle(), layout: { name: 'cose', animate: false, padding: 30, nodeRepulsion: 12000, idealEdgeLength: 90 }, wheelSensitivity: 0.25 });
    ctx.track(cy);
    const det = el.querySelector('#ent-detail');
    cy.on('tap', 'edge', (e) => { det.innerHTML = relDetail(e.target.data('rel')); });
    cy.on('tap', 'node', (e) => {
      const n = e.target;
      det.innerHTML = `<h3>${esc(n.data('label'))}</h3><p class="small muted">${esc((M.ENTITY_KINDS[n.data('kind')] || {}).label || '')}${n.data('cik') ? ' · CIK ' + esc(n.data('cik')) : ''}</p>` + n.connectedEdges().map((x) => relDetail(x.data('rel'), true)).join('');
    });
  }

  function relDetail(r, compact) {
    if (!r) return '';
    const t = M.RELATIONSHIP_TYPES[r.type] || { label: r.type };
    return `<div class="edge"><strong>${esc(t.label)}</strong> ${statusBadge(r.status)} <span class="small muted">${esc(r.confidence)}</span>
      <div class="small">${esc(r.from.name)} → ${esc(r.to.name)}</div>
      ${r.shares !== undefined && r.shares !== null ? `<div class="small">Shares: ${fmtInt(r.shares)}${r.percentOfClass !== null && r.percentOfClass !== undefined ? ' · ' + fmtPct(r.percentOfClass) + ' (reported)' : ''}</div>` : ''}
      <div class="small muted">As of ${esc(r.asOfDate)} (${esc(r.dateBasis)}) · ${esc(r.evidence.formType)} <span class="mono">${esc(r.evidence.accessionNumber)}</span> filed ${esc(r.evidence.filingDate)}</div>
      ${compact ? '' : `<div class="small" style="margin-top:4px">${esc(r.evidence.note)}</div><div class="mono small muted">${esc(r.evidence.path)}</div>`}</div>`;
  }

  // ------------------------------------------------------------------ G. history (charts)
  function history(body, v, issuer, state, ctx) {
    const inst = v.institutional, periods = inst.periods.slice().reverse();
    body.innerHTML = `
      <div class="callout">Charts use <strong>reporting periods</strong> for 13F (quarter-end dates), <strong>transaction dates</strong> for insider activity, and <strong>event dates</strong> for 13D/G. Filing dates are later and are shown in the tables. 13F positions are historical and may not represent current holdings.</div>
      <div class="grid g2">
        <div class="card"><h3>Institutional holdings over time</h3><p class="small muted">Shares per manager (top 8 in the latest period), by 13F reporting period</p><div class="chart-box"><canvas id="ch-inst"></canvas></div></div>
        <div class="card"><h3>Top 10 reported institutional holders</h3><p class="small muted">Period ${esc(inst.periods[0] || '—')} · shares under investment discretion</p><div class="chart-box"><canvas id="ch-top"></canvas></div></div>
        <div class="card"><h3>Insider transactions over time</h3><p class="small muted">Shares acquired (A) and disposed (D) per month, non-derivative securities, by transaction date</p><div class="chart-box"><canvas id="ch-ins"></canvas></div></div>
        <div class="card"><h3>Ownership concentration</h3><p class="small muted">Cumulative share of the top reported 13F positions (${v.denominator.usable ? '% of shares outstanding, calculated' : 'shares; no single-class denominator'})</p><div class="chart-box"><canvas id="ch-conc"></canvas></div></div>
        <div class="card" style="grid-column:1/-1"><h3>Beneficial ownership changes (13D/G)</h3><p class="small muted">Reported % of class at each filing's event date</p><div class="chart-box"><canvas id="ch-ben"></canvas></div></div>
      </div>`;
    const css = SOI.ui.cssVar;
    Chart.defaults.color = css('--text-2');
    Chart.defaults.borderColor = css('--border');
    Chart.defaults.font.family = css('--sans') || 'sans-serif';
    const palette = ['#2563eb', '#dc6b19', '#16a34a', '#7c3aed', '#0891b2', '#ca8a04', '#db2777', '#475569', '#65a30d', '#b91c1c'];
    const nf = (n) => fmtShares(n);
    const mk = (id, cfg) => { const c = new Chart(body.querySelector(id), cfg); ctx.trackChart(c); return c; };
    const lp = inst.periods[0];
    const topM = lp ? inst.byPeriod[lp].slice(0, 8) : [];
    mk('#ch-inst', { type: 'line', data: { labels: periods, datasets: topM.map((m, i) => ({ label: m.managerName, borderColor: palette[i], backgroundColor: palette[i], tension: 0.2, spanGaps: false, data: periods.map((p) => { const x = (inst.byPeriod[p] || []).find((r) => r.managerCik === m.managerCik); return x ? x.shares : null; }) })) }, options: { maintainAspectRatio: false, scales: { y: { ticks: { callback: nf } } }, plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmtInt(c.parsed.y)}` } }, legend: { labels: { boxWidth: 10 } } } } });
    const top10 = lp ? inst.byPeriod[lp].slice(0, 10) : [];
    mk('#ch-top', { type: 'bar', data: { labels: top10.map((m) => m.managerName.length > 28 ? m.managerName.slice(0, 26) + '…' : m.managerName), datasets: [{ label: 'Shares', data: top10.map((m) => m.shares), backgroundColor: '#2563eb' }] }, options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${fmtInt(c.parsed.x)} shares${top10[c.dataIndex].pctOfOutstanding !== null ? ' · ' + fmtPct(top10[c.dataIndex].pctOfOutstanding) + ' calc' : ''}` } } }, scales: { x: { ticks: { callback: nf } } } } });
    const months = {};
    v.insiders.transactions.filter((t) => t.table === 'nonDerivative' && t.transactionDate).forEach((t) => {
      const m = t.transactionDate.slice(0, 7); months[m] = months[m] || { A: 0, D: 0 };
      if (t.acquiredDisposed === 'A' || t.acquiredDisposed === 'D') months[m][t.acquiredDisposed] += t.shares || 0;
    });
    const ml = Object.keys(months).sort();
    mk('#ch-ins', { type: 'bar', data: { labels: ml, datasets: [{ label: 'Acquired (A)', data: ml.map((m) => months[m].A), backgroundColor: '#16a34a' }, { label: 'Disposed (D)', data: ml.map((m) => -months[m].D), backgroundColor: '#b91c1c' }] }, options: { maintainAspectRatio: false, scales: { x: { stacked: true }, y: { stacked: true, ticks: { callback: (n) => nf(Math.abs(n)) } } }, plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmtInt(Math.abs(c.parsed.y))}` } } } } });
    const conc = v.concentration ? v.concentration.cumulative : [];
    mk('#ch-conc', { type: 'line', data: { labels: conc.map((x, i) => `Top ${i + 1}`), datasets: [{ label: v.denominator.usable ? 'Cumulative % of outstanding (calculated)' : 'Cumulative shares', data: conc.map((x) => (v.denominator.usable ? x.cumPct : x.cumShares)), borderColor: '#0e7490', backgroundColor: 'rgba(14,116,144,.15)', fill: true, tension: 0.15 }] }, options: { maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { callback: (n) => (v.denominator.usable ? n + '%' : nf(n)) } } }, plugins: { tooltip: { callbacks: { afterLabel: (c) => conc[c.dataIndex].manager } } } } });
    const persons = v.beneficial.persons.slice(0, 10);
    mk('#ch-ben', { type: 'line', data: { datasets: persons.map((p, i) => ({ label: p.name, borderColor: palette[i], backgroundColor: palette[i], data: p.history.filter((h) => h.eventDate && h.percentOfClass !== null).map((h) => ({ x: h.eventDate, y: h.percentOfClass })), showLine: true, stepped: true })) }, options: { maintainAspectRatio: false, parsing: false, scales: { x: { type: 'category', labels: [...new Set(persons.flatMap((p) => p.history.map((h) => h.eventDate)))].filter(Boolean).sort() }, y: { beginAtZero: true, ticks: { callback: (n) => n + '%' } } }, plugins: { tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.parsed.y}% (event ${c.raw.x})` } } } } });
  }

  // ------------------------------------------------------------------ H. filing explorer
  function filings(body, v, issuer, state, ctx, rerender, records) {
    const R = SOI.relationships;
    const recs = records.filter((r) => (r.filing.formFamily === '13F' ? R.rowsForIssuer(r, issuer).length || (r.extension.confidentialTreatment || {}).isConfidentialOmitted : R.issuerMatches(r, issuer)));
    const f = state.fx || (state.fx = { fam: '', q: '' });
    const shown = recs.filter((r) => (!f.fam || r.filing.formFamily === f.fam) && (!f.q || (r.filing.filerName + ' ' + r.filing.accessionNumber).toLowerCase().includes(f.q.toLowerCase())))
      .sort((a, b) => (a.filing.filingDate < b.filing.filingDate ? 1 : -1));
    body.innerHTML = `<div class="toolbar"><select id="fx-fam"><option value="">All form types</option>${['13F', '13D', '13G', 'FORM3', 'FORM4', 'FORM5'].map((x) => `<option value="${x}" ${f.fam === x ? 'selected' : ''}>${M.FORM_FAMILIES[x].label}</option>`).join('')}</select>
      <input type="search" id="fx-q" placeholder="Filter by filer or accession" value="${esc(f.q)}"><span class="small muted">${shown.length} of ${recs.length} filings</span><div class="spacer"></div>
      <button id="fx-json">Export JSON</button><button id="fx-xlsx">Export Excel</button></div>
      <div class="table-wrap" style="max-height:640px;overflow:auto"><table class="data"><tr><th>Form</th><th>Filer</th><th>Filed</th><th>Period / event</th><th>Accession</th><th>Origin</th><th>Validation</th><th></th></tr>
      ${shown.map((r, i) => `<tr><td>${famBadge(r.filing.formFamily, r.filing.formType)}</td><td>${esc(r.filing.filerName)}</td><td class="nowrap">${esc(r.filing.filingDate)}</td><td class="nowrap">${esc(r.filing.reportPeriod || r.filing.eventDate)}</td>
        <td>${r.filing.accessionNumber ? accLink(r.filing.accessionNumber, filingIndexUrl(r)) : '—'}</td><td class="small">${r.filing.dataOrigin === 'sec-edgar' ? '<span class="badge b-reported">SEC EDGAR</span>' : '<span class="badge b-info">imported</span>'}</td>
        <td>${statusBadge(r.validation.status)}</td><td><button data-i="${i}">View JSON</button></td></tr>`).join('')}</table></div>`;
    body.querySelector('#fx-fam').addEventListener('change', (e) => { f.fam = e.target.value; rerender(); });
    body.querySelector('#fx-q').addEventListener('change', (e) => { f.q = e.target.value; rerender(); });
    body.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => { const r = shown[Number(b.dataset.i)]; modal(`${r.filing.formType} · ${r.filing.filerName}`, `<p class="small">Source: ${secLink(r.filing.sourceUrl, r.filing.sourceUrl || r.filing.sourceFile)}</p>${jsonView(r, 1)}`); }));
    body.querySelector('#fx-json').addEventListener('click', () => SOI.storage.exporters.json(shown, { issuer: issuer.name }));
    body.querySelector('#fx-xlsx').addEventListener('click', () => SOI.storage.exporters.xlsx(shown));
  }

  SOI.companyViews = { render, relDetail };
})(typeof globalThis !== 'undefined' ? globalThis : this);
