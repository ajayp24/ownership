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
    const ben = v.beneficial.current;
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
        <div class="steps">${['The company', 'Who is who', 'Institutional holders (13F)', 'Big owners (13D/13G)', 'Insiders (Forms 3/4/5)', 'Putting it together', 'Check it yourself'].map((t, i) => `<a class="step" href="#walk-${i + 1}" data-jump="walk-${i + 1}"><b>Step ${i + 1}</b>${t}</a>`).join('')}</div></div>`;

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

    // ---- step 2: who is who
    html += `<div id="walk-2"></div>` + step(2, `Who is who — read this first`, '#0e7490', rolesStep(v, iss, name, top, big, insider));

    // ---- step 3: 13F
    if (top) {
      const pctLine = top.pctOfOutstanding !== null
        ? `${fmtInt(top.shares)} ÷ ${fmtInt(so.value)} = <strong>${fmtPct(top.pctOfOutstanding)}</strong> of shares outstanding. We calculated this; the 13F itself has no percentage. The two numbers are also from different dates (holdings on ${esc(top.period)}, shares outstanding on ${esc(so.asOf)}), so treat it as approximate.`
        : 'No percentage is calculated, because there is no single-class shares-outstanding figure for this company.';
      const disc = Object.entries(top.discretion).map(([k, n]) => `${fmtShares(n)} shares "${k}" (${esc((M.INVESTMENT_DISCRETION[k] || k).split(' — ')[1] || k)})`).join('; ');
      html += `<div id="walk-3"></div>` + step(3, 'Institutional holders — Form 13F', 'var(--c-manager)', `
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
      html += `<div id="walk-4"></div>` + step(4, 'Big owners — Schedule 13D and 13G', 'var(--c-beneficial)', `
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
      html += `<div id="walk-4"></div>` + step(4, 'Big owners — Schedule 13D and 13G', 'var(--c-beneficial)', `<p>No structured Schedule 13D/13G filings about ${esc(name)} are in the data set. That means no one filed a new or amended >5% report since December 2024 in the data retrieved; older filings may exist on EDGAR.</p>`);
    }

    // ---- step 4: insiders
    if (insider) {
      const h = insider.holdings[0];
      html += `<div id="walk-5"></div>` + step(5, 'Insiders — Forms 3, 4 and 5', 'var(--c-insider)', `
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
    html += `<div id="walk-6"></div>` + step(6, 'Putting it together — why you must not add these numbers', '#7c3aed', `
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
    html += `<div id="walk-7"></div>` + step(7, 'Check it yourself', '#475569', `
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

  /**
   * "Who is who": every role, with a real name from this company's filings,
   * why that name has the role, and what it is NOT (and why not).
   */
  function rolesStep(v, iss, name, top, big, insider) {
    const E = SOI.entities;
    const same = (a, b) => !!(a && b && E.sameEntity(a, b).same);
    const ben = v.beneficial.current;
    const mgrs = v.institutional.latestByManager.filter(Boolean);
    const people = v.insiders.people;
    const isMgr = (e) => mgrs.find((m) => same(e, { name: m.managerName, cik: m.managerCik }));
    const isBen = (e) => ben.find((p) => same(e, { name: p.name, cik: p.cik }));
    const isIns = (e) => people.find((p) => same(e, { name: p.name, cik: p.cik }));
    // Interesting real examples, each with a fallback
    const filedByOther = ben.find((p) => p.latest.filerName && !same({ name: p.name }, { name: p.latest.filerName }) && p.latest.jointFilers > 1);
    const clientVotes = mgrs.filter((m) => (m.votingAuthority.none || 0) > 0).sort((a, b) => b.votingAuthority.none - a.votingAuthority.none)[0];
    const officer = people.find((p) => p.roles.some((r) => !/^(Director|10% owner)$/i.test(r) && !/member of/i.test(r)) && p.holdings.length);
    const tinyDirector = people.filter((p) => p.roles.includes('Director') && !p.roles.some((r) => r !== 'Director')).sort((a, b) => ((a.holdings[0] || {}).shares || 0) - ((b.holdings[0] || {}).shares || 0))[0];
    const firmInsider = people.find((p) => p.roles.includes('10% owner') && /\b(LP|L\.P\.|LLC|INC|CORP|TRUST|FUND|CAPITAL|MANAGEMENT)\b/i.test(p.name));
    const multi = mgrs.find((m) => isIns({ name: m.managerName, cik: m.managerCik }) && ben.some((p) => p.latest.filerCik === m.managerCik));
    // Former owners: replaced by a later filing first, then exit filings / zero shares (not just a % that rounds to 0)
    const gone = v.beneficial.persons.filter((p) => p.superseded).concat(v.beneficial.persons.filter((p) => !p.superseded && (p.latest.exitFlag || p.latest.shares === 0)));
    const holdingOf = (p) => (p && p.holdings[0] ? `${fmtInt(p.holdings[0].shares)} shares (${p.holdings[0].nature}, as of ${p.holdings[0].asOfDate})` : 'no shares reported in the loaded filings');

    const card = (color, role, plain, who, yes, no, evidence) => `<div class="role-card" style="border-top-color:${color}">
      <div class="role-name">${role}</div><div class="role-plain">${plain}</div>
      <div class="role-who"><span>Here</span>${who}</div>
      <div class="role-yes"><span>✓ Why it is</span>${yes}</div>
      <div class="role-no"><span>✗ What it is not — and why</span>${no}</div>
      ${evidence ? `<div class="role-ev">Source: ${evidence}</div>` : ''}</div>`;

    const cards = [];
    cards.push(card('var(--c-issuer)', 'Company = Issuer', 'The company whose shares are being reported.',
      `<strong>${esc(name)}</strong> · CIK <span class="mono">${esc(iss.cik)}</span> · CUSIP <span class="mono">${esc((iss.cusips || []).join(', '))}</span>`,
      `${esc(name)} <em>issued</em> the shares (its common stock, CUSIP ${esc((iss.cusips || [])[0] || '')}). Every filing below is <em>about</em> those shares, so ${esc(name)} is the issuer in all of them.`,
      `It is <strong>not the filer</strong> of these ownership reports — other people file them about it. It is <strong>not an owner</strong> of its own outstanding shares. "Company" and "issuer" mean the same thing here; "issuer" is simply the SEC's word.`,
      ''));

    if (top) cards.push(card('var(--c-manager)', 'Investment manager (13F filer)', 'A firm that decides what to buy and sell for other people\'s money.',
      `<strong>${esc(top.managerName)}</strong> · CIK <span class="mono">${esc(top.managerCik)}</span>`,
      `It filed a Form 13F listing ${fmtInt(top.shares)} ${esc(name)} shares on ${esc(top.period)} under its <em>investment discretion</em> (${esc(Object.keys(top.discretion).join(', '))}). Having that decision power is exactly what makes a firm a 13F filer.`,
      `It is <strong>not automatically the owner</strong>. The money usually belongs to its funds and clients; the 13F only says the firm <em>manages</em> the shares. ${clientVotes ? `For example, ${esc(clientVotes.managerName)} reports voting authority "none" on ${fmtInt(clientVotes.votingAuthority.none)} shares — someone else (its clients/funds) votes them.` : ''} It is also not "the issuer's investor relations" — it is an outside firm.`,
      `${esc(top.formTypes.join(', '))} ${top.accessionNumbers.map((a) => link(idx(top.managerCik, a), a)).join(', ')}`));

    if (big) {
      const l = big.latest;
      cards.push(card('var(--c-beneficial)', 'Beneficial owner (13D / 13G)', 'Someone with the power to vote the shares or to sell them, above 5%.',
        `<strong>${esc(big.name)}</strong>${big.cik ? ` · CIK <span class="mono">${esc(big.cik)}</span>` : ''} · ${fmtPct(l.percentOfClass)} of the class`,
        `On its ${esc(l.formType)} (event date ${esc(l.eventDate)}) it reports <strong>voting power</strong> over ${fmtInt((l.soleVoting || 0) + (l.sharedVoting || 0))} shares (sole ${fmtInt(l.soleVoting)}, shared ${fmtInt(l.sharedVoting)}) and <strong>power to sell</strong> ${fmtInt((l.soleDispositive || 0) + (l.sharedDispositive || 0))} shares. Rule 13d-3 says that power — not just paying for the shares — is what makes a beneficial owner.`,
        `It is <strong>not necessarily the "legal" owner</strong>: almost all listed shares are registered in the name of a nominee (Cede &amp; Co.), not the investor. It is <strong>not the only owner of those shares</strong> if power is shared — ${l.sharedVoting || l.sharedDispositive ? `here ${fmtInt((l.sharedVoting || 0))} voting / ${fmtInt(l.sharedDispositive || 0)} selling shares are <em>shared</em> with others` : 'shared power would mean others report the same shares'}. And it is <strong>not the same thing as a 13F position</strong>: a 13F counts shares a manager decides about at quarter end, while a 13D/13G counts voting or selling power on the event date. An investment adviser can file both, for the same client shares.`,
        `${esc(l.formType)} ${link(l.sourceUrl, l.accessionNumber)}`));
      cards.push(card('#0e7490', 'Reporting person', 'Each person or entity that gets its own cover page in a 13D/13G (or the insider on Forms 3/4/5).',
        `<strong>${esc(big.name)}</strong>${l.coFilers.length ? ` and ${l.coFilers.length} co-filer(s): ${esc(l.coFilers.slice(0, 4).join(', '))}${l.coFilers.length > 4 ? '…' : ''}` : ''}`,
        `Each one appears on its own cover page with its own numbers, because each has (or shares) power over the shares${l.coFilers.length ? ' — e.g. a fund, its general partner and the person who controls them' : ''}.`,
        `Reporting persons are <strong>not separate blocks of shares</strong>. In a joint filing the same shares are usually reported by every co-filer, so you must <strong>never add their numbers</strong>. A reporting person is also <strong>not always the filer</strong> (see next card).`,
        `${esc(l.formType)} ${link(l.sourceUrl, l.accessionNumber)}`));
    }

    const f = filedByOther || big;
    cards.push(card('#475569', 'Filer', 'Whoever actually submitted the document to the SEC (identified by its CIK).',
      `${top ? `13F: <strong>${esc(top.managerName)}</strong>` : ''}${f ? `${top ? '<br>' : ''}13D/13G: <strong>${esc(f.latest.filerName || f.name)}</strong>` : ''}${(officer || insider) ? `<br>Form 4: <strong>${esc((officer || insider).name)}</strong>` : ''}`,
      `The filer's name and CIK are on the EDGAR submission. For a 13F it is the manager; for a 13D/13G it is one of the reporting persons; for a Form 4 it is the insider.`,
      filedByOther ? `The filer is <strong>not always the person whose shares are reported</strong>. Here <strong>${esc(filedByOther.name)}</strong>'s holding was reported in a joint ${esc(filedByOther.latest.formType)} submitted by <strong>${esc(filedByOther.latest.filerName)}</strong> — one family member or entity files for the group. The filer is also <strong>not necessarily an owner</strong> (a 13F filer usually is not).`
        : `The filer is <strong>not necessarily an owner</strong>: a 13F filer reports client holdings, and in joint 13D/13G filings one person often files for the whole group.`,
      filedByOther ? `${esc(filedByOther.latest.formType)} ${link(filedByOther.latest.sourceUrl, filedByOther.latest.accessionNumber)}` : ''));

    const ins2 = officer || insider;
    if (ins2) cards.push(card('var(--c-insider)', 'Insider (director, officer, 10% owner)', 'People inside or in control of the company who must report their own trades within 2 business days.',
      `<strong>${esc(ins2.name)}</strong> · ${esc(ins2.roles.join(', '))} · holds ${holdingOf(ins2)}${tinyDirector && tinyDirector !== ins2 ? `<br><strong>${esc(tinyDirector.name)}</strong> · Director · ${holdingOf(tinyDirector)}` : ''}${firmInsider ? `<br><strong>${esc(firmInsider.name)}</strong> · 10% owner (a firm, not a person)` : ''}`,
      `Insider status comes from the <strong>job or the size of the stake</strong>: board members, senior officers, and anyone above 10%. They tick that box on Forms 3/4/5.`,
      `An insider is <strong>not necessarily a big shareholder</strong>${tinyDirector ? ` — ${esc(tinyDirector.name)} is a director with ${holdingOf(tinyDirector)}` : ''}. A 10% owner is an insider <strong>without working for the company</strong>${firmInsider ? ` (e.g. ${esc(firmInsider.name)})` : ''}. And Forms 3/4/5 give <strong>no percentage</strong>; their holdings are counted on a "financial interest" basis, so they will not match 13D/13G numbers exactly.`,
      ''));

    if (multi) {
      const bp = ben.find((p) => p.latest.filerCik === multi.managerCik);
      const ip = isIns({ name: multi.managerName, cik: multi.managerCik });
      cards.push(card('#7c3aed', 'One firm, three roles', 'The same entity can appear in several filings at once.',
        `<strong>${esc(multi.managerName)}</strong>`,
        `It is an <strong>investment manager</strong> (13F: ${fmtInt(multi.shares)} shares on ${esc(multi.period)}), a <strong>beneficial owner / reporting person</strong> (${esc(bp.latest.formType)}: ${fmtPct(bp.latest.percentOfClass)} on ${esc(bp.latest.eventDate)}) and an <strong>insider</strong> as a 10% owner (Form 4: ${holdingOf(ip)}).`,
        `These are <strong>not three different holdings</strong>. They are the same position described three times, on three dates, under three different rules — so the numbers differ a little and must <strong>never be added together</strong>.`,
        ''));
    }

    if (gone.length) {
      const g0 = gone[0];
      cards.push(card('#94a3b8', 'Former owner (no longer above 5%)', 'Appears in the filings, but is not a current big owner.',
        `${gone.slice(0, 3).map((p) => `<strong>${esc(p.name)}</strong>`).join(', ')}`,
        `${g0.superseded ? `${esc(g0.name)} reported ${fmtPct(g0.latest.percentOfClass)} on ${esc(g0.latest.eventDate)}, but the same filer's later ${esc(g0.superseded.formType)} (filed ${esc(g0.superseded.filingDate)}) no longer names it and reports ${esc(g0.superseded.names.join(' / '))} instead — the stake was renamed, moved or sold.` : `${esc(g0.name)}'s latest ${esc(g0.latest.formType)} reports ${fmtPct(g0.latest.percentOfClass)} — an "exit" filing saying it is now at or below 5%, or that reporting moved to another entity.`}`,
        `It is <strong>not a current owner above 5%</strong>, even though its name appears in the company's filing history. Always read the <em>latest</em> filing in a chain, not the first one you find.`,
        g0.superseded ? `${esc(g0.superseded.formType)} <span class="mono">${esc(g0.superseded.accessionNumber)}</span>` : `${esc(g0.latest.formType)} <span class="mono">${esc(g0.latest.accessionNumber)}</span>`));
    }

    // One table: who has which role
    const rows = [];
    const files = (e) => !!(isMgr(e) || isIns(e) || v.beneficial.persons.some((p) => same(e, { name: p.latest.filerName, cik: p.latest.filerCik })));
    const row = (label, e, fixed) => rows.push([label].concat(fixed || [
      false,
      files(e),
      !!isBen(e),
      !!isBen(e),
      !!isMgr(e),
      !!isIns(e),
    ]));
    rows.push([esc(name), true, false, false, false, false, false]);
    if (top) row(esc(top.managerName), { name: top.managerName, cik: top.managerCik });
    if (big) row(esc(big.name), { name: big.name, cik: big.cik });
    if (ins2) row(esc(ins2.name), { name: ins2.name, cik: ins2.cik });
    if (multi && multi !== top) row(esc(multi.managerName), { name: multi.managerName, cik: multi.managerCik });
    const tick = (b) => (b ? '<span class="yes">✓</span>' : '<span class="no">—</span>');
    const table = `<div class="table-wrap" style="margin-top:12px"><table class="data role-table"><tr><th>Name</th><th>Issuer</th><th>Files reports</th><th>Reporting person (13D/G)</th><th>Beneficial owner &gt;5%</th><th>Investment manager (13F)</th><th>Insider</th></tr>
      ${rows.map((r) => `<tr><td><strong>${r[0]}</strong></td>${r.slice(1).map((b) => `<td>${tick(b)}</td>`).join('')}</tr>`).join('')}</table></div>
      <p class="small muted">"Files reports" = submits at least one of the filings about ${esc(name)} in this data set. A ✓ comes from the filings themselves (matched by CIK, or by identical name when a filing has no CIK).</p>`;

    return `<p>Before looking at numbers, it helps to know <strong>who plays which role</strong>. The words below are often mixed up, so each card gives a real name from ${esc(name)}'s filings, <strong>why</strong> it has that role, and what it is <strong>not</strong> — and why not.</p>
      <div class="role-grid">${cards.join('')}</div>
      <h3 style="margin-top:18px">The same people, in one table</h3>${table}`;
  }


  SOI.explainView = { render };
})(typeof globalThis !== 'undefined' ? globalThis : this);
