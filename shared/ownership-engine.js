/*
 * ownership-engine.js — combines 13F, 13D/G and Section 16 records into one
 * consolidated, clearly-labelled ownership view for an issuer.
 *
 * Principles enforced here (see README "Ownership Intelligence Engine"):
 *  - The three categories (13F institutional, 13D/G beneficial, Section 16
 *    insider) are kept separate and are never added together.
 *  - 13F figures are "reported holdings over which the manager has investment
 *    discretion", not ownership.
 *  - Percentages: 13D/G percentages are the filer's own reported figure;
 *    13F percentages are calculated only when a single-class denominator with
 *    a stated date is available, and are labelled "calculated".
 *  - Reporting periods are never mixed silently; each figure keeps its date.
 *  - Overlaps and stale data are surfaced as findings with evidence.
 *  - Inferred findings are labelled inferred, with a confidence level.
 */
(function (g) {
  'use strict';
  const SOI = (g.SOI = g.SOI || {});
  const DAY = 86400000;

  const daysBetween = (a, b) => (a && b ? Math.round((new Date(b) - new Date(a)) / DAY) : null);
  const byDesc = (f) => (a, b) => (f(a) < f(b) ? 1 : f(a) > f(b) ? -1 : 0);

  // ---------------------------------------------------------------- 13F

  /**
   * Resolves amendments for one manager × period:
   *   RESTATEMENT amendment → replaces the original;
   *   NEW HOLDINGS amendment → adds rows to the original.
   */
  function resolve13FFilings(filings) {
    const originals = filings.filter((r) => !r.filing.isAmendment).sort(byDesc((r) => r.filing.filingDate));
    const amends = filings.filter((r) => r.filing.isAmendment).sort((a, b) => (a.filing.filingDate < b.filing.filingDate ? -1 : 1));
    let base = originals[0] ? [originals[0]] : [];
    const notes = [];
    if (originals.length > 1) notes.push(`${originals.length} original 13F-HR filings for the same period; the latest (${originals[0].filing.accessionNumber}) was used.`);
    for (const a of amends) {
      const type = (a.filing.amendmentType || '').toUpperCase();
      if (type.includes('RESTATEMENT')) { base = [a]; notes.push(`Restatement ${a.filing.accessionNumber} (${a.filing.filingDate}) replaces earlier figures.`); }
      else if (type.includes('NEW HOLDINGS')) {
        // Guard: some "new holdings" amendments repeat the full table. If most of
        // its rows duplicate rows already in the base, treat it as a replacement.
        const rowKey = (h) => `${h.cusip}|${h.shares}|${h.investmentDiscretion}|${h.otherManagers.join(',')}|${h.putCall}`;
        const baseKeys = new Set(base.flatMap((r) => r.holdings.map(rowKey)));
        const dup = a.holdings.filter((h) => baseKeys.has(rowKey(h))).length;
        // Full-document sizes are only known for filtered (retrieval-tool) records
        const sizeA = (a.extension.holdingsFilter || {}).rowsInDocument || 0;
        const sizeB = base.length ? (base[0].extension.holdingsFilter || {}).rowsInDocument || 0 : 0;
        if (a.holdings.length && (dup / a.holdings.length > 0.5 || (sizeA && sizeB && sizeA / sizeB > 0.5))) {
          base = [a];
          notes.push(`Amendment ${a.filing.accessionNumber} is labelled "new holdings" but repeats ${dup} of its ${a.holdings.length} relevant rows (${sizeA} rows in the document vs ${sizeB} in the original); it was treated as a replacement to avoid double counting.`);
        } else {
          base = base.concat(a);
          notes.push(`Amendment ${a.filing.accessionNumber} (${a.filing.filingDate}) adds new holdings.`);
        }
      }
      else { base = base.length ? base : [a]; notes.push(`Amendment ${a.filing.accessionNumber} has no amendment type; ${base[0] === a ? 'used as the only available filing' : 'not applied'}.`); }
    }
    return { used: base, notes };
  }

  function buildInstitutional(records, issuer, denominator, cusip) {
    const R = SOI.relationships;
    const by = new Map(); // managerCik|period -> records
    records.filter((r) => r.filing.formFamily === '13F').forEach((r) => {
      const key = `${r.filing.filerCik || r.filing.filerName}|${r.filing.reportPeriod}`;
      if (!by.has(key)) by.set(key, []);
      by.get(key).push(r);
    });
    const positions = [];
    for (const [key, recs] of by) {
      const { used, notes } = resolve13FFilings(recs);
      const edges = used.flatMap((r) => R.thirteenFEdges(r, issuer));
      const common = edges.filter((e) => !e.putCall && e.sharesType !== 'PRN' && (!cusip || e.cusip === cusip));
      const otherClasses = edges.filter((e) => !e.putCall && e.sharesType !== 'PRN' && cusip && e.cusip !== cusip);
      const options = edges.filter((e) => e.putCall);
      const debt = edges.filter((e) => !e.putCall && e.sharesType === 'PRN');
      const head = used[used.length - 1] || recs[0];
      const shares = common.reduce((s, e) => s + (e.shares || 0), 0);
      const pos = {
        managerName: head.filing.filerName, managerCik: head.filing.filerCik, period: head.filing.reportPeriod,
        filingDate: used.map((r) => r.filing.filingDate).sort().pop(),
        accessionNumbers: used.map((r) => r.filing.accessionNumber), formTypes: used.map((r) => r.filing.formType),
        sourceUrls: used.map((r) => r.filing.sourceUrl),
        shares, valueUSD: common.reduce((s, e) => s + (e.valueUSD || 0), 0),
        byCusip: common.map((e) => ({ cusip: e.cusip, securityClass: e.securityClass, shares: e.shares, valueUSD: e.valueUSD, rows: e.rows })),
        options: options.map((e) => ({ cusip: e.cusip, putCall: e.putCall, underlyingShares: e.shares, valueUSD: e.valueUSD })),
        otherClasses: otherClasses.map((e) => ({ cusip: e.cusip, securityClass: e.securityClass, shares: e.shares, valueUSD: e.valueUSD })),
        debt: debt.map((e) => ({ cusip: e.cusip, securityClass: e.securityClass, principal: e.shares, valueUSD: e.valueUSD })),
        discretion: mergeObj(common.map((e) => e.discretion)),
        votingAuthority: mergeObj(common.map((e) => e.votingAuthority)),
        otherManagersCount: (head.extension.otherIncludedManagers || []).length,
        amendmentNotes: notes,
        edges: common,
        pctOfOutstanding: null, pctBasis: '',
      };
      pos.confidentialOmitted = used.some((r) => (r.extension.confidentialTreatment || {}).isConfidentialOmitted);
      pos.confidentialNote = pos.confidentialOmitted ? (used.map((r) => r.extension.additionalInformation).find(Boolean) || 'The filer states that confidential information was omitted from this public filing.') : '';
      if (!pos.shares && !options.length && !debt.length && !otherClasses.length) {
        pos.reportedNoPosition = true; // filing exists but lists no rows for this issuer
      }
      if (denominator && denominator.usable && common.length && common.every((e) => e.cusip === denominator.cusip)) {
        pos.pctOfOutstanding = (shares / denominator.value) * 100;
        const gap = daysBetween(denominator.asOf, pos.period);
        pos.pctBasis = `Calculated: ${shares.toLocaleString('en-US')} ÷ ${denominator.value.toLocaleString('en-US')} shares outstanding as of ${denominator.asOf} (${denominator.form} cover page)` + (gap !== null && Math.abs(gap) > 45 ? `; denominator date is ${Math.abs(gap)} days ${gap > 0 ? 'before' : 'after'} the 13F period` : '');
      } else if (common.length) {
        pos.pctBasis = denominator && denominator.reason ? denominator.reason : 'No suitable shares-outstanding denominator; percentage not calculated.';
      }
      positions.push(pos);
    }
    const periods = [...new Set(positions.map((p) => p.period))].sort().reverse();
    const byPeriod = {};
    periods.forEach((p) => { byPeriod[p] = positions.filter((x) => x.period === p && !x.reportedNoPosition).sort(byDesc((x) => x.shares)); });

    // quarter-over-quarter changes per manager (only between the manager's own consecutive filings)
    const changes = [];
    const managers = [...new Set(positions.map((p) => p.managerCik || p.managerName))];
    for (const m of managers) {
      const ps = positions.filter((p) => (p.managerCik || p.managerName) === m).sort(byDesc((p) => p.period));
      if (ps.length < 2) continue;
      const [cur, prev] = ps;
      const delta = cur.shares - prev.shares;
      changes.push({
        managerName: cur.managerName, managerCik: cur.managerCik, period: cur.period, prevPeriod: prev.period,
        shares: cur.shares, prevShares: prev.shares, delta, deltaPct: prev.shares ? (delta / prev.shares) * 100 : null,
        status: (cur.confidentialOmitted && !cur.shares) || (prev.confidentialOmitted && !prev.shares) ? 'not comparable (confidential treatment)' : !prev.shares && cur.shares ? 'new' : prev.shares && !cur.shares ? 'exited' : delta > 0 ? 'increased' : delta < 0 ? 'decreased' : 'unchanged',
        evidence: { current: cur.accessionNumbers, previous: prev.accessionNumbers },
      });
    }
    const latestByManager = managers.map((m) => positions.filter((p) => (p.managerCik || p.managerName) === m).sort(byDesc((p) => p.period))[0]);
    return { positions, periods, byPeriod, changes, latestByManager };
  }

  function mergeObj(list) {
    const o = {};
    list.forEach((x) => Object.entries(x || {}).forEach(([k, v]) => { o[k] = (o[k] || 0) + (v || 0); }));
    return o;
  }

  // ---------------------------------------------------------------- 13D / 13G

  function buildBeneficial(records, issuer) {
    const R = SOI.relationships, E = SOI.entities;
    const recs = records.filter((r) => (r.filing.formFamily === '13D' || r.filing.formFamily === '13G') && R.issuerMatches(r, issuer));
    const persons = new Map();
    for (const r of recs) {
      const ext = r.extension;
      ext.reportingPersons.forEach((p, i) => {
        const key = p.cik ? 'cik:' + p.cik : 'name:' + E.tokenKey(p.name);
        if (!persons.has(key)) persons.set(key, { key, name: p.name, cik: p.cik, history: [] });
        persons.get(key).history.push({
          formType: r.filing.formType, schedule: ext.schedule, filingDate: r.filing.filingDate, eventDate: ext.eventDate,
          accessionNumber: r.filing.accessionNumber, amendmentNumber: ext.amendmentNumber, sourceUrl: r.filing.sourceUrl,
          filerCik: r.filing.filerCik, filerName: r.filing.filerName,
          shares: p.aggregateAmountOwned, percentOfClass: p.percentOfClass, securityClass: ext.securitiesClassTitle,
          soleVoting: p.soleVotingPower, sharedVoting: p.sharedVotingPower, soleDispositive: p.soleDispositivePower, sharedDispositive: p.sharedDispositivePower,
          types: p.typeOfReportingPerson, rules: ext.rulesDesignated || [], jointFilers: ext.reportingPersons.length,
          coFilers: ext.reportingPersons.filter((_, j) => j !== i).map((q) => q.name),
          exitFlag: !!ext.ownershipFiveOrLess, heuristic: !!p.heuristic, comments: p.comments || '',
          purpose: ext.purposeOfTransaction || '', recordId: r.recordId,
        });
      });
    }
    const list = [...persons.values()].map((p) => {
      p.history.sort((a, b) => (a.filingDate + String(a.amendmentNumber || 0).padStart(4, '0') < b.filingDate + String(b.amendmentNumber || 0).padStart(4, '0') ? -1 : 1));
      p.latest = p.history[p.history.length - 1];
      p.status = p.latest.exitFlag || (p.latest.percentOfClass !== null && p.latest.percentOfClass <= 5) ? 'At or below 5% (latest filing)' : 'Above 5% (latest filing)';
      return p;
    });
    list.sort(byDesc((p) => p.latest.percentOfClass || 0));
    return { persons: list, filings: recs.length };
  }

  // ---------------------------------------------------------------- Section 16

  function buildInsiders(records, issuer) {
    const R = SOI.relationships;
    const recs = records.filter((r) => /^FORM[345]$/.test(r.filing.formFamily) && R.issuerMatches(r, issuer));
    const people = new Map();
    const transactions = [];
    for (const r of recs) {
      const ext = r.extension;
      const owners = ext.reportingOwners || [];
      owners.forEach((o) => {
        const key = o.cik || o.name;
        if (!people.has(key)) people.set(key, { key, name: o.name, cik: o.cik, roles: new Set(), lastFiling: '', filings: [], holdings: new Map() });
        const p = people.get(key);
        o.roles.forEach((x) => p.roles.add(x));
        p.filings.push({ formType: r.filing.formType, filingDate: r.filing.filingDate, accessionNumber: r.filing.accessionNumber });
        if (r.filing.filingDate > p.lastFiling) { p.lastFiling = r.filing.filingDate; p.latestRoles = o.roles; }
      });
      const lead = owners[0] || {};
      const pushTx = (row) => transactions.push(Object.assign({}, row, {
        ownerName: owners.map((o) => o.name).join(' & '), ownerCik: lead.cik, ownerRoles: (lead.roles || []).join(', '),
        formType: r.filing.formType, filingDate: r.filing.filingDate, accessionNumber: r.filing.accessionNumber, sourceUrl: r.filing.sourceUrl,
        jointFiling: owners.length > 1, aff10b5One: ext.aff10b5One, footnoteText: (row.footnoteIds || []).map((id) => `${id}: ${ext.footnotes[id] || ''}`).join(' | '),
      }));
      ext.nonDerivativeTransactions.forEach(pushTx);
      ext.derivativeTransactions.forEach(pushTx);
      // holdings snapshot per owner (lead owner for joint filings)
      const p = people.get(lead.cik || lead.name);
      if (!p) continue;
      r.ownershipRelationships.filter((x) => x.type === 'DIRECT_OWNERSHIP' || x.type === 'INDIRECT_OWNERSHIP').forEach((x) => {
        const k = `${x.securityClass}|${x.nature}|${x.natureDetail || ''}`;
        const prev = p.holdings.get(k);
        if (!prev || x.asOfDate > prev.asOfDate || (x.asOfDate === prev.asOfDate && r.filing.filingDate > prev.filingDate)) {
          p.holdings.set(k, { securityClass: x.securityClass, nature: x.nature, natureDetail: x.natureDetail, shares: x.shares, asOfDate: x.asOfDate, filingDate: r.filing.filingDate, accessionNumber: r.filing.accessionNumber, formType: r.filing.formType, jointFiling: x.jointFiling });
        }
      });
    }
    const list = [...people.values()].map((p) => ({
      name: p.name, cik: p.cik, roles: [...(p.latestRoles || p.roles)], allRoles: [...p.roles], lastFiling: p.lastFiling, filingCount: p.filings.length,
      holdings: [...p.holdings.values()].sort(byDesc((h) => h.shares || 0)),
    })).sort(byDesc((p) => p.lastFiling));
    transactions.sort(byDesc((t) => (t.transactionDate || t.filingDate) + t.accessionNumber));
    return { people: list, transactions, filings: recs.length, window: recs.length ? { from: recs.map((r) => r.filing.filingDate).sort()[0], to: recs.map((r) => r.filing.filingDate).sort().pop() } : null };
  }

  // ---------------------------------------------------------------- overlaps & data-quality findings

  function findOverlaps(inst, ben, ins, records, issuer) {
    const E = SOI.entities;
    const out = [];
    const managers = inst.latestByManager.filter(Boolean);
    // (a) the same organisation reports in 13F and 13D/G
    for (const p of ben.persons) {
      for (const m of managers) {
        const byFiler = p.latest.filerCik && m.managerCik && p.latest.filerCik === m.managerCik;
        const s = E.sameEntity({ name: p.name, cik: p.cik }, { name: m.managerName, cik: m.managerCik });
        if (byFiler || s.same) {
          out.push({
            kind: '13F ↔ 13D/G', severity: 'info', status: 'reported', confidence: byFiler || s.basis === 'CIK match' ? 'high' : 'medium',
            entities: [p.name, m.managerName],
            text: `${m.managerName} reports this issuer on Form 13F (period ${m.period}) and ${p.name} reports it on ${p.latest.formType} (event ${p.latest.eventDate}). These are two disclosures of overlapping positions under different rules and dates — they must not be added together.`,
            evidence: [m.accessionNumbers.join(', '), p.latest.accessionNumber], basis: byFiler ? 'Same EDGAR filer CIK' : s.basis,
          });
        }
      }
    }
    // (b) an insider also appears as a 13D/G reporting person, or holds indirectly through one
    for (const person of ins.people) {
      for (const p of ben.persons) {
        const s = E.sameEntity({ name: person.name, cik: person.cik }, { name: p.name, cik: p.cik });
        if (s.same) {
          out.push({ kind: 'Insider ↔ 13D/G', severity: 'info', status: s.basis === 'CIK match' ? 'reported' : 'inferred', confidence: s.basis === 'CIK match' ? 'high' : 'medium', entities: [person.name, p.name],
            text: `${person.name} files Section 16 reports and is also a reporting person on ${p.latest.formType}. The Section 16 holdings (pecuniary interest, by security and direct/indirect form) and the 13D/G aggregate (voting/investment power) measure overlapping shares differently.`,
            evidence: [p.latest.accessionNumber], basis: s.basis });
        }
        const hit = person.holdings.find((h) => h.nature === 'indirect' && h.natureDetail && E.tokenKey(p.name) && E.tokens(h.natureDetail).join(' ').includes(E.tokens(p.name).join(' ')));
        if (hit) {
          out.push({ kind: 'Indirect holding ↔ 13D/G entity', severity: 'info', status: 'inferred', confidence: 'medium', entities: [person.name, p.name],
            text: `${person.name} reports an indirect holding "${hit.natureDetail}" (${hit.formType} ${hit.accessionNumber}); ${p.name} separately reports on ${p.latest.formType}. The same shares are likely counted in both disclosures.`,
            evidence: [hit.accessionNumber, p.latest.accessionNumber], basis: 'Entity name appears in the nature-of-ownership text' });
        }
      }
    }
    // (c) possibly affiliated 13F managers (e.g. parent and subsidiary advisers, or a realignment)
    for (let i = 0; i < managers.length; i++) for (let j = i + 1; j < managers.length; j++) {
      const a = managers[i], b = managers[j];
      const h = E.affiliationHint({ name: a.managerName, cik: a.managerCik }, { name: b.managerName, cik: b.managerCik });
      if (h) out.push({ kind: 'Possibly affiliated 13F managers', severity: 'warning', status: 'inferred', confidence: 'low', entities: [a.managerName, b.managerName],
        text: `${a.managerName} (latest period ${a.period}) and ${b.managerName} (latest period ${b.period}) may be related entities. Related managers can split or share reporting of the same positions; do not add their holdings without checking each filing's "Other Included Managers" list.`,
        evidence: [a.accessionNumbers.join(', '), b.accessionNumbers.join(', ')], basis: h.basis });
    }
    // (d) a filer's other-included-manager also files its own 13F in this data set
    const latest13F = new Map(managers.map((m) => [m.managerCik, m]));
    for (const rec of records.filter((r) => r.filing.formFamily === '13F' && latest13F.get(r.filing.filerCik) && latest13F.get(r.filing.filerCik).accessionNumbers.includes(r.filing.accessionNumber))) {
      for (const om of rec.extension.otherIncludedManagers || []) {
        const twin = managers.find((m) => m.managerCik !== rec.filing.filerCik && (E.sameEntity({ name: om.name, cik: om.cik }, { name: m.managerName, cik: m.managerCik }).same));
        if (twin) out.push({ kind: 'Other included manager also files', severity: 'warning', status: 'reported', confidence: 'high', entities: [rec.filing.filerName, twin.managerName],
          text: `${rec.filing.filerName} lists ${om.name} as an Other Included Manager, and ${twin.managerName} also files its own 13F. Holdings may be reported in both filings.`,
          evidence: [rec.filing.accessionNumber, twin.accessionNumbers.join(', ')], basis: 'Name/CIK on the 13F summary page' });
      }
    }
    // (e) joint 13D/G filings
    for (const p of ben.persons.filter((x) => x.latest.jointFilers > 1)) {
      out.push({ kind: 'Joint 13D/G filing', severity: 'info', status: 'reported', confidence: 'high', entities: [p.name].concat(p.latest.coFilers.slice(0, 4)),
        text: `${p.name} is one of ${p.latest.jointFilers} reporting persons on ${p.latest.formType} ${p.latest.accessionNumber}. Each person's cover-page amount can include the same shares (shared power), so the amounts are not additive.`,
        evidence: [p.latest.accessionNumber], basis: 'Multiple reporting persons in one Schedule' });
    }
    return dedupeFindings(out);
  }

  function dedupeFindings(list) {
    const seen = new Set();
    return list.filter((f) => { const k = f.kind + '|' + f.entities.slice().sort().join('|'); if (seen.has(k)) return false; seen.add(k); return true; });
  }

  function dataQuality(inst, ben, ins, asOf) {
    const w = [];
    const latest = inst.periods[0];
    if (inst.periods.length > 1) w.push({ level: 'info', text: `13F data covers ${inst.periods.length} reporting periods (${inst.periods.slice().reverse().join(', ')}). Tables show one period at a time; figures from different periods are never combined.` });
    for (const p of inst.positions.filter((x) => x.confidentialOmitted && !x.shares)) {
      w.push({ level: 'warning', text: `${p.managerName}: the ${p.period} 13F states that confidential information was omitted, and it lists no position in this issuer. Absence here does not mean the manager held none.`, evidence: p.accessionNumbers });
    }
    for (const p of inst.positions.filter((x) => x.amendmentNotes.length)) {
      w.push({ level: 'info', text: `${p.managerName} (${p.period}): ${p.amendmentNotes.join(' ')}`, evidence: p.accessionNumbers });
    }
    for (const m of inst.latestByManager.filter(Boolean)) {
      if (latest && m.period < latest) w.push({ level: 'warning', text: `${m.managerName}: most recent 13F in this data set is for ${m.period}, older than the latest period ${latest}.`, evidence: m.accessionNumbers });
    }
    for (const p of ben.persons) {
      const age = daysBetween(p.latest.filingDate, asOf);
      if (age !== null && age > 400) w.push({ level: 'warning', text: `${p.name}: latest Schedule ${p.latest.schedule} in this data set was filed ${p.latest.filingDate} (${age} days ago). Ownership may have changed without triggering an amendment.`, evidence: [p.latest.accessionNumber] });
      const prev = p.history[p.history.length - 2];
      if (prev && prev.eventDate === p.latest.eventDate && prev.shares !== p.latest.shares) w.push({ level: 'warning', text: `${p.name}: two filings with the same event date (${p.latest.eventDate}) report different amounts (${(prev.shares || 0).toLocaleString('en-US')} vs ${(p.latest.shares || 0).toLocaleString('en-US')}). The later filing is shown.`, evidence: [prev.accessionNumber, p.latest.accessionNumber] });
      if (p.latest.heuristic) w.push({ level: 'warning', text: `${p.name}: values come from a legacy text/HTML filing read heuristically. Verify against the original.`, evidence: [p.latest.accessionNumber] });
    }
    if (ins.window) w.push({ level: 'info', text: `Insider data covers Forms 3/4/5 filed ${ins.window.from} to ${ins.window.to}. Insiders who did not file in this window are not shown, and the list is not an official roster of current directors and officers.` });
    return w;
  }

  // ---------------------------------------------------------------- public API

  /**
   * buildIssuerView(records, issuer, options)
   *   issuer: { name, cik, ticker, cusips[], sharesOutstanding?, multiClass? }
   *   options.asOf: date used to judge staleness (defaults to today)
   */
  /**
   * The same filing can arrive twice (e.g. its XML and its full-submission .txt,
   * or an import of a bundled filing). Keep one record per accession number and
   * form family: the one with the most metadata, preferring SEC-retrieved data.
   */
  function dedupeRecords(records) {
    const best = new Map();
    const score = (r) => (r.filing.dataOrigin === 'sec-edgar' ? 8 : 0) + (r.holdings.length ? 4 : 0) + (r.filing.filingDate ? 2 : 0) + (r.issuer.cik ? 1 : 0);
    const out = [];
    let dropped = 0;
    for (const r of records) {
      const acc = r.filing.accessionNumber;
      if (!acc) { out.push(r); continue; }
      const k = acc + '|' + r.filing.formFamily;
      const prev = best.get(k);
      if (!prev) best.set(k, r);
      else { dropped++; if (score(r) > score(prev)) best.set(k, r); }
    }
    return { records: out.concat([...best.values()]), dropped };
  }

  function buildIssuerView(allRecords, issuer, options = {}) {
    const asOf = options.asOf || new Date().toISOString().slice(0, 10);
    const { records, dropped } = dedupeRecords(allRecords);
    const so = issuer.sharesOutstanding;
    let denominator = null;
    if (so && so.value && !issuer.multiClass && issuer.cusips && issuer.cusips.length === 1 && (!options.cusip || options.cusip === issuer.cusips[0])) {
      denominator = { usable: true, value: so.value, asOf: so.asOf, form: so.form, accessionNumber: so.accessionNumber, cusip: issuer.cusips[0] };
    } else {
      denominator = { usable: false, reason: issuer.multiClass ? 'Not calculated: the company has more than one class of common stock and no per-class denominator is loaded.' : 'Not calculated: no shares-outstanding denominator is loaded.' };
    }
    const cusip = (options.cusip || (issuer.cusips || [])[0] || '').toUpperCase();
    const inst = buildInstitutional(records, issuer, denominator, cusip);
    inst.cusip = cusip;
    const ben = buildBeneficial(records, issuer);
    const ins = buildInsiders(records, issuer);
    const overlaps = findOverlaps(inst, ben, ins, records, issuer);
    const quality = dataQuality(inst, ben, ins, asOf);
    if (dropped) quality.unshift({ level: 'info', text: `${dropped} duplicate record(s) of the same filing (same accession number) were ignored; the copy with the most complete metadata was used.` });
    const relationships = SOI.relationships.relationshipsForIssuer(records, issuer);

    // Concentration among reported 13F holders for the latest period (explicitly not deduplicated ownership)
    let concentration = null;
    const lp = inst.periods[0];
    if (lp) {
      const rows = inst.byPeriod[lp];
      const top = rows.slice(0, 10);
      const flagged = new Set(overlaps.filter((o) => o.kind === 'Possibly affiliated 13F managers' || o.kind === 'Other included manager also files').flatMap((o) => o.entities));
      const sum = (list) => list.reduce((s, r) => s + r.shares, 0);
      concentration = {
        period: lp, managers: rows.length,
        top10Shares: sum(top), top10Pct: denominator.usable ? (sum(top) / denominator.value) * 100 : null,
        top10SharesExFlagged: sum(top.filter((r) => !flagged.has(r.managerName))),
        flaggedInTop10: top.filter((r) => flagged.has(r.managerName)).map((r) => r.managerName),
        cumulative: top.map((r, i) => ({ manager: r.managerName, shares: r.shares, cumShares: sum(top.slice(0, i + 1)), cumPct: denominator.usable ? (sum(top.slice(0, i + 1)) / denominator.value) * 100 : null })),
        note: 'Sum of the largest reported 13F positions for one period, from the managers in this data set only. 13F positions can overlap between affiliated managers and include shares managed for clients, so this is a concentration indicator, not a count of distinct owned shares.',
      };
    }
    return { issuer, asOf, denominator, institutional: inst, beneficial: ben, insiders: ins, overlaps, quality, relationships, concentration };
  }

  /** Issuers referenced by non-13F records (13F covers thousands of issuers, so those are looked up by CUSIP). */
  function listIssuers(records) {
    const map = new Map();
    for (const r of records) {
      if (r.filing.formFamily === '13F' || !r.issuer.cik && !r.issuer.name) continue;
      // Records without a CIK (legacy text filings) join an issuer with the same CUSIP
      let e = r.issuer.cik ? map.get(r.issuer.cik) : [...map.values()].find((x) => (r.issuer.cusips || []).some((c) => x.cusips.has(c)));
      if (!e) {
        e = { name: r.issuer.name, cik: r.issuer.cik, ticker: r.issuer.ticker, cusips: new Set(), records: 0 };
        map.set(r.issuer.cik || r.issuer.name, e);
      }
      (r.issuer.cusips || []).forEach((c) => e.cusips.add(c));
      if (!e.ticker && r.issuer.ticker) e.ticker = r.issuer.ticker;
      e.records++;
    }
    return [...map.values()].map((e) => Object.assign(e, { cusips: [...e.cusips] }));
  }

  SOI.ownership = { buildIssuerView, listIssuers, resolve13FFilings, dedupeRecords };
  if (typeof module !== 'undefined' && module.exports) module.exports = SOI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
