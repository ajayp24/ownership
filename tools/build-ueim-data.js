#!/usr/bin/env node
/*
 * build-ueim-data.js — data for the UEIM Entity Master demonstration (needs internet).
 *
 * Downloads and parses, with this project's own parsers:
 *   1. BlackRock's Schedule 13G/A on Apple filed 12 Feb 2024 (event 31 Dec 2023),
 *      accession 0001086364-24-006980, as the full EDGAR submission (SEC header +
 *      document), including Exhibit A (subsidiaries that acquired the security).
 *   2. BlackRock, Inc.'s latest 13F-HR in the bundled data — the WHOLE information
 *      table (every issuer), aggregated per CUSIP, for the Filer view.
 *
 * Writes ueim/data/ueim-data.js. Run after tools/fetch-sec-data.js:
 *   SEC_USER_AGENT="Your Name you@example.com" node tools/build-ueim-data.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const SOI = require('../shared/load-node.js');

const ROOT = path.join(__dirname, '..');
const CACHE = path.join(__dirname, '.cache');
const UA = process.env.SEC_USER_AGENT;
if (!UA || !/@/.test(UA)) { console.error('Set SEC_USER_AGENT to "Name contact@email".'); process.exit(1); }
fs.mkdirSync(CACHE, { recursive: true });

let last = 0;
async function get(url) {
  const file = path.join(CACHE, url.replace(/^https?:\/\//, '').replace(/[^\w.-]+/g, '_'));
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  for (let attempt = 1; attempt <= 4; attempt++) {
    const wait = Math.max(0, last + 200 - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.ok) { const t = await res.text(); fs.writeFileSync(file, t); return t; }
    if (res.status === 404) throw new Error(`${url}: 404`);
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
  throw new Error(`${url}: failed`);
}

const G13_ACC = '0001086364-24-006980';
const G13_URL = `https://www.sec.gov/Archives/edgar/data/320193/${G13_ACC.replace(/-/g, '')}/${G13_ACC}.txt`;

(async () => {
  const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, 'ownership-dashboard', 'data', 'sec-data.json'), 'utf8'));

  // ---- 1. BlackRock 13G/A on Apple (full submission: header gives filer CIK and filing date)
  const g13Text = await get(G13_URL);
  const g13 = await SOI.parsers.parse({ name: `${G13_ACC}.txt`, text: g13Text }, { family: '13G', sourceUrl: G13_URL, dataOrigin: 'sec-edgar' });
  g13.issuer.ticker = 'AAPL';
  const header = SOI.parserBase.parseSecHeader(g13Text);
  const doc = (/<TEXT>([\s\S]*?)<\/TEXT>/.exec(g13Text) || [])[1] || '';
  const exA = (/Exhibit A\s+Subsidiary\s+([\s\S]*?)\n\s*\*Entity beneficially owns/i.exec(doc) || [])[1] || '';
  const subsidiaries = exA.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => ({ name: l.replace(/\*$/, '').trim(), fivePercentOrMore: /\*$/.test(l) }));
  const item3 = (/\[X\]\s*A parent holding company or control person/i.test(doc)) ? 'Parent holding company or control person — Rule 13d-1(b)(1)(ii)(G)' : '';
  const item6 = ((/Item 6\.[\s\S]*?required\.\s*([\s\S]*?)Item 7\./i.exec(doc) || [])[1] || '').replace(/\s+/g, ' ').trim();
  const signed = ((/Dated:\s*([A-Za-z]+ \d{1,2}, \d{4})/.exec(doc) || [])[1] || '');
  const p = g13.extension.reportingPersons[0];
  console.log('13G/A', g13.filing.accessionNumber, g13.filing.filingDate, 'filer', header.filer.cik, header.filer.name, '| person', p.name, p.aggregateAmountOwned, p.soleVotingPower, p.sharedVotingPower, p.soleDispositivePower, p.sharedDispositivePower, p.percentOfClass, p.typeOfReportingPerson, '| subsidiaries', subsidiaries.length);

  // ---- 2. BlackRock, Inc. latest 13F, whole information table
  const br = bundle.records.filter((r) => r.filing.formFamily === '13F' && r.filing.filerCik === '0002012383').sort((a, b) => (a.filing.reportPeriod < b.filing.reportPeriod ? 1 : -1))[0];
  if (!br) throw new Error('BlackRock 13F not in bundle — run tools/fetch-sec-data.js first');
  const acc = br.filing.accessionNumber;
  const base = `https://www.sec.gov/Archives/edgar/data/2012383/${acc.replace(/-/g, '')}/`;
  const idx = JSON.parse(await get(base + 'index.json'));
  const info = idx.directory.item.map((i) => i.name).find((n) => /\.xml$/i.test(n) && n !== 'primary_doc.xml');
  const full = new SOI.Parser13F().parseParts(
    { cover: { name: 'primary_doc.xml', text: await get(base + 'primary_doc.xml') }, infoTable: { name: info, text: await get(base + info) } },
    { name: 'primary_doc.xml' },
    { accessionNumber: acc, filingDate: br.filing.filingDate, sourceUrl: base, dataOrigin: 'sec-edgar' }
  );
  const known = {};
  bundle.companies.forEach((c) => c.cusips.forEach((cu) => { known[cu] = { cik: c.cik, ticker: c.ticker, name: c.name }; }));
  const agg = new Map();
  for (const h of full.holdings) {
    const k = `${h.cusip}|${h.putCall}|${h.sharesType}`;
    const e = agg.get(k) || { issuerName: h.issuerName, titleOfClass: h.titleOfClass, cusip: h.cusip, putCall: h.putCall, sharesType: h.sharesType, shares: 0, valueUSD: 0, rows: 0, discretion: {}, voting: { sole: 0, shared: 0, none: 0 }, otherManagers: new Set() };
    e.shares += h.shares || 0; e.valueUSD += h.valueUSD || 0; e.rows++;
    e.discretion[h.investmentDiscretion] = (e.discretion[h.investmentDiscretion] || 0) + (h.shares || 0);
    e.voting.sole += h.votingAuthority.sole || 0; e.voting.shared += h.votingAuthority.shared || 0; e.voting.none += h.votingAuthority.none || 0;
    h.otherManagers.forEach((m) => e.otherManagers.add(m));
    agg.set(k, e);
  }
  // compact arrays to keep the file small: [name, class, cusip, putCall, type, shares, value, rows, sole, shared, none, discSOLE, discDFND, discOTR, otherMgrs]
  const issuers = [...agg.values()].sort((a, b) => b.valueUSD - a.valueUSD).map((e) => [
    e.issuerName, e.titleOfClass, e.cusip, e.putCall, e.sharesType, e.shares, e.valueUSD, e.rows,
    e.voting.sole, e.voting.shared, e.voting.none, e.discretion.SOLE || 0, e.discretion.DFND || 0, e.discretion.OTR || 0,
    [...e.otherManagers].sort((a, b) => a - b).join(','),
  ]);
  console.log('13F', acc, full.filing.reportPeriod, 'rows', full.holdings.length, '→ positions', issuers.length, 'summary', full.extension.summary, 'warnings', full.validation.warnings.slice(0, 3));

  // ---- 3. EDGAR company records (name history) for the entities in the demonstration
  const profiles = {};
  for (const cik of ['0002012383', '0001364742', '0000320193', '0001086364']) {
    const sub = JSON.parse(await get(`https://data.sec.gov/submissions/CIK${cik}.json`));
    profiles[cik] = { cik, name: sub.name, formerNames: sub.formerNames || [], tickers: sub.tickers || [], exchanges: sub.exchanges || [], sicDescription: sub.sicDescription || '', stateOfIncorporation: sub.stateOfIncorporation || '', entityType: sub.entityType || '', category: sub.category || '', source: `https://data.sec.gov/submissions/CIK${cik}.json` };
    console.log('profile', cik, sub.name, JSON.stringify(sub.formerNames || []), sub.tickers, sub.entityType, sub.stateOfIncorporation);
  }
  // The legacy text 13G/A has no CIK on the cover page; the SEC header's FILED BY section names the
  // same person ("BlackRock Inc." / "BlackRock, Inc."), so that CIK is attached as documented evidence.
  if (SOI.entities.sameEntity({ name: p.name }, { name: header.filer.name }).same) {
    p.cik = header.filer.cik;
    p.cikSource = 'SEC header FILED BY section of accession ' + G13_ACC;
    g13.reportingPersons[0].cik = header.filer.cik;
    g13.ownershipRelationships.forEach((r) => { if (r.from.name === p.name) r.from.cik = header.filer.cik; });
  }

  const out = {
    schema: 'ueim.demo/1.0', generatedAt: new Date().toISOString(), profiles,
    blackrock13G: {
      record: g13, secHeader: header, exhibitA: subsidiaries, item3, item6, signedDate: signed,
      verifiedFigures: { aggregate: p.aggregateAmountOwned, soleVoting: p.soleVotingPower, sharedVoting: p.sharedVotingPower, soleDispositive: p.soleDispositivePower, sharedDispositive: p.sharedDispositivePower, percentOfClass: p.percentOfClass },
    },
    blackrock13F: {
      filerCik: full.filing.filerCik, filerName: full.filing.filerName, formType: full.filing.formType, accessionNumber: acc,
      reportPeriod: full.filing.reportPeriod, filingDate: br.filing.filingDate, sourceUrl: base, infoTableFile: info,
      summary: full.extension.summary, valueUnit: full.extension.valueUnit, otherIncludedManagers: full.extension.otherIncludedManagers.map((m) => ({ seq: m.sequenceNumber, name: m.name, fileNumber: m.form13FFileNumber })),
      rowsInTable: full.holdings.length, validation: full.validation, known,
      columns: ['issuerName', 'titleOfClass', 'cusip', 'putCall', 'sharesType', 'shares', 'valueUSD', 'rows', 'votingSole', 'votingShared', 'votingNone', 'discSOLE', 'discDFND', 'discOTR', 'otherManagers'],
      positions: issuers,
    },
  };
  fs.mkdirSync(path.join(ROOT, 'ueim', 'data'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'ueim', 'data', 'ueim-data.js'), '/* Generated by tools/build-ueim-data.js from SEC EDGAR. Do not edit by hand. */\nwindow.UEIM_DATA = ' + JSON.stringify(out) + ';\n');
  fs.mkdirSync(path.join(ROOT, 'sample-data', 'schedule-13g-legacy'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'sample-data', 'schedule-13g-legacy', `${G13_ACC}-blackrock-apple.txt`), g13Text);
  console.log('wrote ueim/data/ueim-data.js', (JSON.stringify(out).length / 1048576).toFixed(2), 'MB');
})().catch((e) => { console.error(e); process.exit(1); });
