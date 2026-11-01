/*
 * explain-view.js — "Company walkthrough": one company explained end to end in
 * plain language, step by step, using its real filings. Every sentence is
 * generated from the data shown, so numbers always match the source filings.
 */
(function (g) {
  'use strict';
  const SOI = (g.SOI = g.SOI || {});
  const { esc, fmtInt, fmtUSD, fmtPct, fmtShares } = SOI.ui;
  const M = SOI.models;

  const idx = (cik, acc) => (cik && acc ? `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc.replace(/-/g, '')}/${acc}-index.htm` : '');
  const link = (url, text) => (url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" class="mono">${esc(text)}</a>` : `<span class="mono">${esc(text)}</span>`);
  const days = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
  const step = (n, title, color, html) => `<section class="card walk-step"><div class="walk-num" style="background:${color}">${n}</div><div class="walk-body"><h2>${title}</h2>${html}</div></section>`;
  const term = (t, d) => `<div class="walk-term"><strong>${t}</strong> — ${d}</div>`;

  function render(view, ctx, issuers, ticker) {
    const iss = issuers.find((c) => c.ticker === ticker) || issuers[0];
    if (!iss) { view.innerHTML = '<div class="empty">No company data loaded.</div>'; return; }
    const v = SOI.ownership.buildIssuerView(ctx.records(false), iss, { asOf: ctx.today });
    const name = iss.displayName || iss.name;
    const so = iss.sharesOutstanding;
    const inst = v.institutional, lp = inst.periods[0];
    const holders = lp ? inst.byPeriod[lp] : [];
    const top = holders[0];
    const ch = top ? inst.changes.find((c) => c.managerCik === top.managerCik && c.period === lp) : null;
    const ben = v.beneficial.persons;
    const big = ben.find((p) => (p.latest.percentOfClass || 0) > 5) || ben[0];
    const ins = v.insiders;
    const insider = ins.people.filter((p) => p.holdings.length).sort((a, b) => b.holdings[0].shares - a.holdings[0].shares)[0];
    const tx = insider ? ins.transactions.find((t) => t.ownerCik === insider.cik && t.table === 'nonDerivative' && t.code) : null;

    // ---- intro
    let html = `
      <div class="toolbar"><label class="inline">Explain company <select id="walk-sel">${issuers.map((c) => `<option value="${esc(c.ticker)}" ${c === iss ? 'selected' : ''}>${esc(c.ticker)} · ${esc(c.displayName)}${c.size === 'small' ? ' (small)' : ''}</option>`).join('')}</select></label>
        <a class="btn" href="#/company/${encodeURIComponent(iss.ticker)}">Open full ${esc(iss.ticker)} dashboard →</a></div>
      <div class="hero" style="padding:18px 22px"><h1>Who owns ${esc(name)}? A step-by-step walkthrough</h1>
        <p>This page takes one company and walks through every kind of SEC ownership filing about it, using the real numbers from those filings. Each step says what the filing is, reads one real example line by line, and explains what the figures do and do not mean.</p>
        ${iss.size === 'small' ? '<p><strong>This is a small company.</strong> Compare it with a large one such as Apple: fewer big asset managers report it on 13F, each 13F position is a larger slice of the company, and founders, families or activist investors often appear as 5%+ owners on Schedule 13D.</p>' : ''}
        <div class="steps">${['The company', 'Institutional holders (13F)', 'Big owners (13D/13G)', 'Insiders (Forms 3/4/5)', 'Putting it together', 'Check it yourself'].map((t, i) => `<a class="step" href="#walk-${i + 1}" data-jump="walk-${i + 1}"><b>Step ${i + 1}</b>${t}</a>`).join('')}</div></div>`;

    // ---- step 1: the company
    html += `<div id="walk-1"></div>` + step(1, `Meet the issuer: ${esc(name)}`, 'var(--c-issuer)', `
      <p>In SEC language the company whose shares are being reported is the <strong>issuer</strong>. ${esc(name)} does not file the ownership reports discussed below — other people and firms file them <em>about</em> its shares.</p>
      <div class="grid g2"><dl class="facts">
        <dt>EDGAR name</dt><dd>${esc(iss.name)}</dd>
        <dt>CIK</dt><dd class="mono">${esc(iss.cik)}</dd>
        <dt>Ticker(s)</dt><dd>${esc((iss.tickers || [iss.ticker]).join(', '))}</dd>
        <dt>Exchange</dt><dd>${esc((iss.exchanges || []).join(', '))}</dd>
        <dt>Industry</dt><dd>${esc(iss.sicDescription || '—')}</dd>
        <dt>CUSIP(s)</dt><dd class="mono">${esc((iss.cusips || []).join(', '))}</dd>
      </dl><div>
        ${term('CIK', 'the SEC\'s permanent 10-digit ID for a company or person. It never changes, unlike a ticker.')}
        ${term('CUSIP', 'a 9-character ID for one specific security (one share class). 13F filings identify the issuer by CUSIP.')}
        ${iss.classNote ? term('Share classes', esc(iss.classNote) + ' Each class is counted separately; shares of different classes are never added together.') : ''}
      </div></div>
      ${so ? `<div class="callout"><strong>Shares outstanding:</strong> ${esc(name)} reported ${fmtInt(so.value)} shares outstanding as of ${esc(so.asOf)} on the cover page of its ${esc(so.form)} (filed ${esc(so.filed)}). ${so.usableAsDenominator ? 'This is the number we divide by to turn a holder\'s shares into a percentage.' : esc(so.note) + ' So this walkthrough does not calculate 13F percentages for this company.'}</div>` : `<div class="callout warn">No single shares-outstanding figure is available for ${esc(name)} (it has more than one class), so 13F holdings are shown in shares only, without a calculated percentage.</div>`}`);

    // ---- step 2: 13F
    if (top) {
      const pctLine = top.pctOfOutstanding !== null
        ? `${fmtInt(top.shares)} ÷ ${fmtInt(so.value)} = <strong>${fmtPct(top.pctOfOutstanding)}</strong> of shares outstanding. We calculated this; the 13F itself has no percentage. The two numbers are also from different dates (holdings on ${esc(top.period)}, shares outstanding on ${esc(so.asOf)}), so treat it as approximate.`
        : 'No percentage is calculated, because there is no single-class shares-outstanding figure for this company.';
      const disc = Object.entries(top.discretion).map(([k, n]) => `${fmtShares(n)} shares "${k}" (${esc((M.INVESTMENT_DISCRETION[k] || k).split(' — ')[1] || k)})`).join('; ');
      html += `<div id="walk-2"></div>` + step(2, 'Institutional holders — Form 13F', 'var(--c-manager)', `
        <p>Every quarter, investment managers that control at least $100 million of US-listed stocks file a <strong>Form 13F</strong> listing what they held on the last day of the quarter. The filer is the <strong>manager</strong>; ${esc(name)} appears as one row (identified by its CUSIP) among the hundreds or thousands of issuers in that manager's table.</p>
        <p>The data set contains ${holders.length} managers that reported ${esc(name)} for the quarter ending <strong>${esc(lp)}</strong>. The largest is <strong>${esc(top.managerName)}</strong>. Here is what its filing says, line by line:</p>
        <div class="table-wrap"><table class="data walk-table">
          <tr><td>Filer (manager)</td><td>${esc(top.managerName)} — CIK <span class="mono">${esc(top.managerCik)}</span></td><td>The firm that filed the report, not the owner of the shares.</td></tr>
          <tr><td>Form &amp; accession</td><td>${esc(top.formTypes.join(', '))} · ${top.accessionNumbers.map((a) => link(idx(top.managerCik, a), a)).join(', ')}</td><td>The accession number is the unique ID of the filing on EDGAR. Click it to see the original.</td></tr>
          <tr><td>Quarter (report period)</td><td>${esc(top.period)}</td><td>The date the holdings were measured.</td></tr>
          <tr><td>Filing date</td><td>${esc(top.filingDate)}</td><td>When it was published, ${days(top.period, top.filingDate)} days later. The position may have changed since.</td></tr>
          <tr><td>Shares</td><td><strong>${fmtInt(top.shares)}</strong></td><td>${top.byCusip.length > 1 || top.edges.some((e) => e.rows > 1) ? `The filing splits this across ${top.edges.reduce((s, e) => s + e.rows, 0)} rows (different subsidiaries / "other managers"); we added them together.` : 'From one row of the information table.'}</td></tr>
          <tr><td>Value</td><td>${fmtUSD(top.valueUSD)}</td><td>Market value on the quarter end, in US dollars, as the manager reported it.</td></tr>
          <tr><td>Investment discretion</td><td>${esc(disc)}</td><td>Who makes the buy/sell decisions. This is <em>why</em> the manager reports the shares.</td></tr>
          <tr><td>Voting authority</td><td>sole ${fmtShares(top.votingAuthority.sole)} · shared ${fmtShares(top.votingAuthority.shared)} · none ${fmtShares(top.votingAuthority.none)}</td><td>How many of these shares the manager can vote. "None" usually means the client keeps the vote.</td></tr>
          <tr><td>% of outstanding</td><td>${top.pctOfOutstanding !== null ? fmtPct(top.pctOfOutstanding) + ' (calculated)' : 'not calculated'}</td><td>${pctLine}</td></tr>
        </table></div>
        ${ch ? `<p><strong>Change from the previous quarter:</strong> on ${esc(ch.prevPeriod)} ${esc(top.managerName)} reported ${fmtInt(ch.prevShares)} shares, so it ${ch.delta > 0 ? 'reported ' + fmtInt(ch.delta) + ' more' : ch.delta < 0 ? 'reported ' + fmtInt(-ch.delta) + ' fewer' : 'reported the same number of'} shares (${ch.deltaPct !== null ? (ch.deltaPct > 0 ? '+' : '') + ch.deltaPct.toFixed(1) + '%' : 'n/a'}). For an index manager this often reflects client money flowing in or out rather than a decision about ${esc(name)}.</p>` : ''}
        <p><strong>Other large 13F holders this quarter:</strong> ${holders.slice(1, 6).map((h) => `${esc(h.managerName)} (${fmtShares(h.shares)}${h.pctOfOutstanding !== null ? ', ' + fmtPct(h.pctOfOutstanding) : ''})`).join('; ')}.</p>
        <div class="callout warn"><strong>The key point:</strong> a 13F shows shares a manager <em>manages</em>, mostly on behalf of fund investors and clients. ${esc(top.managerName)} is not the owner of ${fmtShares(top.shares)} ${esc(name)} shares in the everyday sense. A 13F also leaves out short positions, is published weeks after the quarter, and the managers listed here are only the ${inst.latestByManager.filter(Boolean).length} large firms in this data set — not every holder.</div>`);
    }

    // ---- step 3: 13D/G
    if (big) {
      const l = big.latest;
      const rule = (l.rules || [])[0] || '';
      const ruleText = { 'Rule 13d-1(b)': 'a qualified institutional investor (for example an investment adviser or bank) that bought in the ordinary course of business, with no intention to influence control', 'Rule 13d-1(c)': 'a passive investor that owns less than 20% and has no intention to influence control', 'Rule 13d-1(d)': 'an "exempt investor" — someone who has held more than 5% since before the shares were registered (often a founder)' }[rule];
      html += `<div id="walk-3"></div>` + step(3, 'Big owners — Schedule 13D and 13G', 'var(--c-beneficial)', `
        <p>Anyone who becomes the <strong>beneficial owner</strong> of more than 5% of a class must file a <strong>Schedule 13D</strong>, or the shorter <strong>Schedule 13G</strong> if they qualify as a passive or institutional investor. "Beneficial owner" means having the power to <em>vote</em> the shares or to <em>sell</em> them (Rule 13d-3) — it is about power, not just economic interest.</p>
        <p>The data set has ${v.beneficial.filings} such filing(s) about ${esc(name)}, naming ${ben.length} reporting person(s). Let's read <strong>${esc(big.name)}</strong>'s latest one:</p>
        <div class="table-wrap"><table class="data walk-table">
          <tr><td>Form &amp; accession</td><td>${esc(l.formType)}${l.amendmentNumber ? ' (amendment no. ' + l.amendmentNumber + ')' : ''} · ${link(l.sourceUrl, l.accessionNumber)}</td><td>${/13D/.test(l.formType) ? '13D = the long form, used by holders who may seek to influence the company; Item 4 states their purpose.' : '13G = the short form for holders without a control purpose.'}</td></tr>
          ${rule ? `<tr><td>Rule relied on</td><td>${esc(rule)}</td><td>The filer says it is ${esc(ruleText || rule)}.</td></tr>` : ''}
          <tr><td>Type of reporting person</td><td>${esc(l.types.map((t) => t + ' = ' + (M.REPORTING_PERSON_TYPES[t] || t)).join(', '))}</td><td>Code from the cover page.</td></tr>
          <tr><td>Class</td><td>${esc(l.securityClass)}</td><td>The percentage below is of this class only.</td></tr>
          <tr><td>Event date</td><td>${esc(l.eventDate)}</td><td>The date the numbers are measured on (filed ${esc(l.filingDate)}).</td></tr>
          <tr><td>Sole voting power</td><td>${fmtInt(l.soleVoting)}</td><td>Shares it alone can vote.</td></tr>
          <tr><td>Shared voting power</td><td>${fmtInt(l.sharedVoting)}</td><td>Shares it votes together with someone else.</td></tr>
          <tr><td>Sole dispositive power</td><td>${fmtInt(l.soleDispositive)}</td><td>Shares it alone can decide to sell.</td></tr>
          <tr><td>Shared dispositive power</td><td>${fmtInt(l.sharedDispositive)}</td><td>Shares it can sell only together with others.</td></tr>
          <tr><td>Aggregate amount</td><td><strong>${fmtInt(l.shares)}</strong></td><td>Total shares over which it has any voting or selling power.</td></tr>
          <tr><td>Percent of class</td><td><strong>${fmtPct(l.percentOfClass)}</strong></td><td>Calculated and reported by the filer itself, so we use it as-is.</td></tr>
        </table></div>
        ${l.soleVoting !== null && l.soleDispositive !== null && l.soleVoting !== l.soleDispositive ? `<p>Notice that voting power (${fmtShares((l.soleVoting || 0) + (l.sharedVoting || 0))}) and selling power (${fmtShares((l.soleDispositive || 0) + (l.sharedDispositive || 0))}) are different numbers. That is normal: for example, an adviser may decide when to sell client shares while clients keep the right to vote some of them.</p>` : ''}
        ${l.jointFilers > 1 ? `<p>This was a <strong>joint filing</strong> with ${l.jointFilers - 1} other reporting person(s) (${esc(l.coFilers.slice(0, 4).join(', '))}${l.coFilers.length > 4 ? '…' : ''}). Each one reports the shares it has power over, so the same shares often appear on several cover pages — never add them up.</p>` : ''}
        ${big.history.length > 1 ? `<p><strong>History:</strong> ${big.history.map((h) => `${esc(h.filingDate)}: ${fmtPct(h.percentOfClass)}`).join(' → ')}.</p>` : ''}
        ${ben.length > 1 ? `<p><strong>Other reporting persons:</strong> ${ben.filter((p) => p !== big).slice(0, 6).map((p) => `${esc(p.name)} (${fmtPct(p.latest.percentOfClass)}, ${esc(p.latest.formType)} ${esc(p.latest.eventDate)})`).join('; ')}.${ben.some((p) => p.latest.exitFlag) ? ' A 0% or "5% or less" filing is an <em>exit</em> filing: the person is saying it has dropped below the 5% reporting level, or that reporting has moved to another entity in the same group' + (ben.some((p) => p.latest.exitFlag && /vanguard group/i.test(p.name)) ? ' (The Vanguard Group\'s 2026 filing explains an internal realignment: its subsidiaries now report separately)' : '') + '.' : ''}</p>` : ''}`);
    } else {
      html += `<div id="walk-3"></div>` + step(3, 'Big owners — Schedule 13D and 13G', 'var(--c-beneficial)', `<p>No structured Schedule 13D/13G filings about ${esc(name)} are in the data set. That means no one filed a new or amended >5% report since December 2024 in the data retrieved; older filings may exist on EDGAR.</p>`);
    }

    // ---- step 4: insiders
    if (insider) {
      const h = insider.holdings[0];
      html += `<div id="walk-4"></div>` + step(4, 'Insiders — Forms 3, 4 and 5', 'var(--c-insider)', `
        <p>Directors, senior officers and anyone owning more than 10% are <strong>insiders</strong> under Section 16. They file <strong>Form 3</strong> when they become insiders, <strong>Form 4</strong> within two business days of most trades, and <strong>Form 5</strong> once a year for anything not yet reported. The filer is the insider; the issuer is ${esc(name)}.</p>
        <p>${ins.people.length} insiders filed in the data set (${esc(ins.window.from)} to ${esc(ins.window.to)}). The largest holding line belongs to <strong>${esc(insider.name)}</strong> (${esc(insider.roles.join(', ') || 'insider')}):</p>
        <div class="table-wrap"><table class="data walk-table">
          <tr><td>Insider</td><td>${esc(insider.name)} — CIK <span class="mono">${esc(insider.cik)}</span></td><td>Names appear "Last First Middle", as on EDGAR.</td></tr>
          <tr><td>Role</td><td>${esc(insider.roles.join(', '))}</td><td>The relationship box ticked on the form.</td></tr>
          <tr><td>Security</td><td>${esc(h.securityClass)}</td><td></td></tr>
          <tr><td>Shares owned after last reported transaction</td><td><strong>${fmtInt(h.shares)}</strong></td><td>From ${esc(h.formType)} ${link(idx(iss.cik, h.accessionNumber), h.accessionNumber)}, as of ${esc(h.asOfDate)}.</td></tr>
          <tr><td>Direct or indirect</td><td>${h.nature === 'indirect' ? 'Indirect — ' + esc(h.natureDetail || '') : 'Direct'}</td><td>Direct = in the insider's own name. Indirect = through a trust, family member or company; the form says which.</td></tr>
        </table></div>
        ${insider.holdings.length > 1 ? `<p>${esc(insider.name)} also reports: ${insider.holdings.slice(1, 5).map((x) => `${fmtShares(x.shares)} ${x.nature}${x.natureDetail ? ' (' + esc(x.natureDetail) + ')' : ''}`).join('; ')}. Each line is a separate way of holding shares.</p>` : ''}
        ${tx ? `<p><strong>A recent transaction, read in plain words:</strong> on ${esc(tx.transactionDate)}, ${esc(insider.name)} reported code <strong>${esc(tx.code)}</strong> (${esc(tx.codeDescription || '')}): ${tx.acquiredDisposed === 'A' ? 'acquired' : 'disposed of'} ${fmtInt(tx.shares)} shares${tx.pricePerShare ? ' at $' + Number(tx.pricePerShare).toFixed(2) + ' per share' : ' with no price (typical for awards and gifts)'}, leaving ${fmtInt(tx.sharesOwnedFollowing)} shares held ${tx.directOrIndirect === 'I' ? 'indirectly' : 'directly'}. ${tx.aff10b5One ? 'The filing ticks the Rule 10b5-1 box, meaning trades were made under a pre-arranged trading plan.' : ''} Filed on ${esc(tx.filingDate)}.</p>` : ''}
        <div class="callout">Insider figures have <strong>no percentage</strong> on the form, and the list only includes people who filed in the period covered — it is not an official list of the board and management.</div>`);
    }

    // ---- step 5: putting it together
    const ov = v.overlaps.slice(0, 5);
    const sample13 = v.overlaps.find((o) => o.kind === '13F ↔ 13D/G');
    html += `<div id="walk-5"></div>` + step(5, 'Putting it together — why you must not add these numbers', '#7c3aed', `
      <p>We now have three lists for ${esc(name)}: institutional managers (13F), big owners (13D/13G) and insiders (Forms 3/4/5). It is tempting to add them up to get "who owns the company". That would be wrong, because:</p>
      <ul>
        <li><strong>Different tests:</strong> 13F = shares a manager decides about; 13D/G = power to vote or sell; Forms 3/4/5 = the insider's financial interest.</li>
        <li><strong>Different dates:</strong> quarter end (13F), event date (13D/G), transaction date (Form 4).</li>
        <li><strong>The same shares appear more than once.</strong></li>
      </ul>
      ${sample13 ? `<div class="callout warn"><strong>Real example of double counting:</strong> ${esc(sample13.text)}</div>` : ''}
      ${ov.length ? `<p>All overlaps found for ${esc(name)}:</p><ul>${ov.map((o) => `<li><strong>${esc(o.kind)}</strong> (${esc(o.status)}, ${esc(o.confidence)} confidence): ${esc(o.entities.join(' / '))}</li>`).join('')}</ul>` : ''}
      ${v.concentration && v.concentration.top10Pct !== null ? `<p>As one rough indicator, the ten largest 13F positions in this data set add up to ${fmtShares(v.concentration.top10Shares)} shares, about ${fmtPct(v.concentration.top10Pct)} of shares outstanding. That tells you how much of ${esc(name)} sits with big asset managers — not who owns it.</p>` : ''}
      <p><strong>What we can say:</strong> ${top ? `${esc(top.managerName)} managed the most ${esc(name)} shares among the 13F filers here (${fmtShares(top.shares)} on ${esc(lp)})` : 'no 13F data'}${big ? `; ${esc(big.name)} reported ${fmtPct(big.latest.percentOfClass)} on its ${esc(big.latest.formType)}` : ''}${insider ? `; and ${esc(insider.name)} reported ${fmtShares(insider.holdings[0].shares)} shares as an insider` : ''}. <strong>What we cannot say</strong> is who the "ultimate owner" is, because no filing states it.</p>`);

    // ---- step 6: check yourself
    html += `<div id="walk-6"></div>` + step(6, 'Check it yourself', '#475569', `
      <p>Every number above links to the original filing on SEC EDGAR. To go further:</p>
      <ul>
        <li>All filings about ${esc(name)}: <a href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${esc(iss.cik)}" target="_blank" rel="noopener">EDGAR company page (CIK ${esc(iss.cik)})</a></li>
        <li>Every holder, transaction and filing: <a href="#/company/${encodeURIComponent(iss.ticker)}">the ${esc(iss.ticker)} dashboard</a>, especially the "Filing explorer" tab.</li>
        <li>Download a filing's XML from EDGAR and drop it into the <a href="../sec-filing-parser/sec-filing-parser.html">Filing Parser</a> to see every field.</li>
      </ul>
      ${v.quality.filter((q) => q.level === 'warning').length ? `<h4>Data notes for ${esc(name)}</h4><ul class="small">${v.quality.filter((q) => q.level === 'warning').slice(0, 5).map((q) => `<li>${esc(q.text)}</li>`).join('')}</ul>` : ''}
      <p class="small muted">Data retrieved from SEC EDGAR on ${esc((iss.retrievedAt || '').slice(0, 10))}. This walkthrough is educational, not investment advice.</p>`);

    view.innerHTML = html;
    view.querySelector('#walk-sel').addEventListener('change', (e) => { location.hash = '#/explain/' + encodeURIComponent(e.target.value); });
    view.querySelectorAll('[data-jump]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); const t = document.getElementById(a.dataset.jump); if (t) t.scrollIntoView({ behavior: 'smooth' }); }));
  }

  SOI.explainView = { render };
})(typeof globalThis !== 'undefined' ? globalThis : this);
