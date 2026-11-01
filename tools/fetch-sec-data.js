#!/usr/bin/env node
/*
 * fetch-sec-data.js — optional SEC retrieval module (needs internet).
 *
 * Downloads public filings for the 10 demonstration companies from SEC EDGAR,
 * runs them through the SAME parsers the browser app uses, and writes:
 *   ownership-dashboard/data/sec-data.js    (loaded by the dashboard via <script>)
 *   ownership-dashboard/data/sec-data.json  (same content, for other tools)
 *   sample-data/…                           (original documents for tests)
 *
 * Usage:
 *   SEC_USER_AGENT="Your Name your.email@example.com" node tools/fetch-sec-data.js
 *
 * SEC fair-access policy: identify yourself in the User-Agent and stay under
 * 10 requests/second. This tool waits ≥150 ms between requests and caches
 * every response in tools/.cache so re-runs do not hit EDGAR again.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const SOI = require('../shared/load-node.js');

const ROOT = path.join(__dirname, '..');
const CACHE = path.join(__dirname, '.cache');
const UA = process.env.SEC_USER_AGENT;
if (!UA || !/@/.test(UA)) {
  console.error('Set SEC_USER_AGENT to "Name contact@email" (required by SEC fair-access policy).');
  process.exit(1);
}

const COMPANIES = [
  { ticker: 'AAPL', cik: '0000320193', name: 'Apple Inc.', cusips: ['037833100'], multiClass: false },
  { ticker: 'MSFT', cik: '0000789019', name: 'Microsoft Corporation', cusips: ['594918104'], multiClass: false },
  { ticker: 'NVDA', cik: '0001045810', name: 'NVIDIA Corporation', cusips: ['67066G104'], multiClass: false },
  { ticker: 'AMZN', cik: '0001018724', name: 'Amazon.com, Inc.', cusips: ['023135106'], multiClass: false },
  { ticker: 'GOOGL', cik: '0001652044', name: 'Alphabet Inc.', cusips: ['02079K305', '02079K107'], multiClass: true, classNote: 'Class A (GOOGL, 02079K305), Class B (unlisted, 10 votes per share) and Class C (GOOG, 02079K107, no votes).' },
  { ticker: 'META', cik: '0001326801', name: 'Meta Platforms, Inc.', cusips: ['30303M102'], multiClass: true, classNote: 'Class A (META, 30303M102) and Class B (unlisted, 10 votes per share).' },
  { ticker: 'BRK.B', cik: '0001067983', name: 'Berkshire Hathaway Inc.', cusips: ['084670702', '084670108'], multiClass: true, classNote: 'Class A (BRK.A, 084670108) and Class B (BRK.B, 084670702); one Class A share converts into 1,500 Class B shares.' },
  { ticker: 'JPM', cik: '0000019617', name: 'JPMorgan Chase & Co.', cusips: ['46625H100'], multiClass: false },
  { ticker: 'TSLA', cik: '0001318605', name: 'Tesla, Inc.', cusips: ['88160R101'], multiClass: false },
  { ticker: 'WMT', cik: '0000104169', name: 'Walmart Inc.', cusips: ['931142103'], multiClass: false },
  // Small companies: CUSIPs are taken from their own Schedule 13D/G filings (see deriveCusips)
  { ticker: 'LWAY', cik: '0000814586', name: 'Lifeway Foods, Inc.', cusips: [], multiClass: false, size: 'small' },
  { ticker: 'NATH', cik: '0000069733', name: "Nathan's Famous, Inc.", cusips: [], multiClass: false, size: 'small' },
  { ticker: 'CLFD', cik: '0000796505', name: 'Clearfield, Inc.', cusips: [], multiClass: false, size: 'small' },
  { ticker: 'BBW', cik: '0001113809', name: 'Build-A-Bear Workshop, Inc.', cusips: [], multiClass: false, size: 'small' },
];

// Large institutional managers whose 13F filings are checked for the 10 CUSIPs.
// Dimensional and Renaissance are included because they appear often in small-company 13F data.
const MANAGERS = ['0000354204', '0001037389', '0000102909', '0002100119', '0002012383', '0000093751', '0000315066', '0001214717', '0000895421', '0000080255', '0001374170', '0000070858', '0000886982', '0001067983', '0000019617'];
const QUARTERS_PER_MANAGER = 4;
const MAX_FORM4_PER_COMPANY = 30;
const MAX_FORM3_PER_COMPANY = 8;
const MAX_FORM5_PER_COMPANY = 6;
const MAX_DISCOVERED_MANAGERS = 8;

const log = { requests: 0, cached: 0, errors: [] };
let last = 0;
fs.mkdirSync(CACHE, { recursive: true });

async function get(url, asJson) {
  const file = path.join(CACHE, url.replace(/^https?:\/\//, '').replace(/[^\w.-]+/g, '_'));
  if (fs.existsSync(file)) {
    log.cached++;
    const t = fs.readFileSync(file, 'utf8');
    return asJson ? JSON.parse(t) : t;
  }
  for (let attempt = 1; attempt <= 4; attempt++) {
    const wait = Math.max(0, last + 150 - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    log.requests++;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip, deflate' } });
      if (res.status === 404) throw Object.assign(new Error('404 Not Found'), { fatal: true });
      if (res.status === 429 || res.status === 403) { await new Promise((r) => setTimeout(r, 2000 * attempt)); continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const t = await res.text();
      fs.writeFileSync(file, t);
      return asJson ? JSON.parse(t) : t;
    } catch (e) {
      if (e.fatal || attempt === 4) throw new Error(`${url}: ${e.message}`);
    }
  }
  throw new Error(`${url}: rate limited`);
}

const archiveUrl = (cik, acc, file) => `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc.replace(/-/g, '')}/${file}`;

function recentFilings(sub) {
  const r = sub.filings.recent;
  return r.form.map((form, i) => ({
    form, accessionNumber: r.accessionNumber[i], filingDate: r.filingDate[i], reportDate: r.reportDate[i],
    primaryDocument: r.primaryDocument[i],
  }));
}

/** EDGAR lists XSL-rendered paths (xslF345X05/doc.xml); the raw XML sits one level up. */
const rawDoc = (p) => p.replace(/^xsl[^/]+\//, '');

function slim(rec) {
  rec.filing.dataOrigin = 'sec-edgar';
  if (rec.unmapped.length > 40) rec.unmapped = rec.unmapped.slice(0, 40).concat([{ path: '…', value: `${rec.unmapped.length - 40} more unmapped fields omitted from bundled data` }]);
  return rec;
}

const samples = {};
function keepSample(kind, name, text) {
  if (samples[kind]) return;
  samples[kind] = name;
  const dir = path.join(ROOT, 'sample-data', kind);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), text);
}

async function main() {
  const records = [];
  const companies = [];
  const discovered = new Map();

  for (const c of COMPANIES) {
    console.log(`\n== ${c.ticker} (${c.cik})`);
    const sub = await get(`https://data.sec.gov/submissions/CIK${c.cik}.json`, true);
    const profile = {
      ticker: c.ticker, cik: c.cik, name: sub.name, displayName: c.name, tickers: sub.tickers, exchanges: [...new Set(sub.exchanges)],
      sic: sub.sic, sicDescription: sub.sicDescription, stateOfIncorporation: sub.stateOfIncorporation, fiscalYearEnd: sub.fiscalYearEnd,
      cusips: c.cusips, multiClass: c.multiClass, classNote: c.classNote || '', size: c.size || 'large',
      submissionsUrl: `https://data.sec.gov/submissions/CIK${c.cik}.json`, retrievedAt: new Date().toISOString(),
      sharesOutstanding: null, filingCounts: {},
    };
    try {
      const concept = await get(`https://data.sec.gov/api/xbrl/companyconcept/CIK${c.cik}/dei/EntityCommonStockSharesOutstanding.json`, true);
      const vals = (concept.units.shares || []).slice().sort((a, b) => (a.end + a.filed < b.end + b.filed ? 1 : -1));
      if (vals[0]) {
        profile.sharesOutstanding = {
          value: vals[0].val, asOf: vals[0].end, form: vals[0].form, filed: vals[0].filed, accessionNumber: vals[0].accn,
          concept: 'dei:EntityCommonStockSharesOutstanding',
          source: `https://data.sec.gov/api/xbrl/companyconcept/CIK${c.cik}/dei/EntityCommonStockSharesOutstanding.json`,
          usableAsDenominator: !c.multiClass,
          note: c.multiClass ? 'Company has more than one class of common stock; this undimensioned figure is not used as a per-class denominator.' : 'Cover-page shares outstanding reported by the issuer.',
        };
      }
    } catch (e) { log.errors.push(`${c.ticker} shares outstanding: ${e.message}`); }

    const filings = recentFilings(sub);
    const counts = {};
    filings.forEach((f) => { counts[f.form] = (counts[f.form] || 0) + 1; });
    profile.filingCounts = counts;
    profile.recentFilingsWindow = { from: filings[filings.length - 1].filingDate, to: filings[0].filingDate, count: filings.length };

    // ---- Schedules 13D / 13G (structured XML era) ----
    for (const f of filings.filter((x) => /^SCHEDULE 13[DG]/.test(x.form))) {
      const url = archiveUrl(c.cik, f.accessionNumber, rawDoc(f.primaryDocument));
      try {
        const text = await get(url);
        const fam = /13D/.test(f.form) ? '13D' : '13G';
        const rec = await SOI.parsers.parse({ name: rawDoc(f.primaryDocument), text }, { family: fam, accessionNumber: f.accessionNumber, filingDate: f.filingDate, sourceUrl: url, parsedAt: profile.retrievedAt, dataOrigin: 'sec-edgar' });
        if (rec.issuer.cik !== c.cik) continue; // filed BY this company about another issuer
        rec.issuer.ticker = c.ticker;
        records.push(slim(rec));
        keepSample(fam === '13D' ? 'schedule-13d' : 'schedule-13g', `${f.accessionNumber}.xml`, text);
        for (const p of rec.extension.reportingPersons) {
          if (p.typeOfReportingPerson.some((t) => ['IA', 'HC', 'BK', 'IC', 'IV'].includes(t)) && rec.filing.filerCik) discovered.set(rec.filing.filerCik, p.name);
        }
        process.stdout.write(fam);
      } catch (e) { log.errors.push(`${c.ticker} ${f.form} ${f.accessionNumber}: ${e.message}`); }
    }
    // Small companies: take the CUSIP the 13D/G filers themselves reported (most common value)
    if (!c.cusips.length) {
      const votes = {};
      records.filter((r) => r.issuer.cik === c.cik && /13[DG]/.test(r.filing.formFamily)).forEach((r) => r.issuer.cusips.forEach((x) => { votes[x] = (votes[x] || 0) + 1; }));
      const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
      if (best) { c.cusips = [best[0]]; profile.cusips = c.cusips; profile.cusipSource = `Most common CUSIP in this issuer's Schedule 13D/G filings (${best[1]} filing(s))`; }
      else log.errors.push(`${c.ticker}: no CUSIP found in 13D/G filings; 13F rows cannot be matched`);
    }
    // One legacy (pre-XML) 13G as a parser test sample
    const legacy = filings.find((x) => /^SC 13G/.test(x.form) && /\.htm/.test(x.primaryDocument));
    if (legacy && !samples['schedule-13g-legacy']) {
      try { keepSample('schedule-13g-legacy', `${legacy.accessionNumber}-${legacy.primaryDocument}`, await get(archiveUrl(c.cik, legacy.accessionNumber, legacy.primaryDocument))); } catch (e) { log.errors.push(e.message); }
    }

    // ---- Forms 3 / 4 / 5 ----
    const limits = { '3': MAX_FORM3_PER_COMPANY, '4': MAX_FORM4_PER_COMPANY, '5': MAX_FORM5_PER_COMPANY };
    const taken = { '3': 0, '4': 0, '5': 0 };
    for (const f of filings.filter((x) => /^[345](\/A)?$/.test(x.form))) {
      const base = f.form[0];
      if (taken[base] >= limits[base]) continue;
      const url = archiveUrl(c.cik, f.accessionNumber, rawDoc(f.primaryDocument));
      try {
        const text = await get(url);
        const rec = await SOI.parsers.parse({ name: rawDoc(f.primaryDocument), text }, { family: 'FORM' + base, accessionNumber: f.accessionNumber, filingDate: f.filingDate, sourceUrl: url, parsedAt: profile.retrievedAt, dataOrigin: 'sec-edgar' });
        if (rec.issuer.cik !== c.cik) continue; // e.g. Berkshire filing as a 10% owner of another company
        taken[base]++;
        records.push(slim(rec));
        keepSample('form' + base, `${f.accessionNumber}.xml`, text);
        process.stdout.write(base);
      } catch (e) { log.errors.push(`${c.ticker} Form ${f.form} ${f.accessionNumber}: ${e.message}`); }
    }
    if (!samples['full-submission']) {
      const f4 = filings.find((x) => x.form === '4');
      if (f4) { try { keepSample('full-submission', `${f4.accessionNumber}.txt`, await get(archiveUrl(c.cik, f4.accessionNumber, `${f4.accessionNumber}.txt`))); } catch (e) { log.errors.push(e.message); } }
    }
    companies.push(profile);
  }

  // ---- 13F information tables ----
  const allCusips = COMPANIES.flatMap((c) => c.cusips);
  const managerCiks = [...MANAGERS];
  for (const [cik] of discovered) if (!managerCiks.includes(cik) && managerCiks.length < MANAGERS.length + MAX_DISCOVERED_MANAGERS) managerCiks.push(cik);
  const managers = [];
  for (const mcik of managerCiks) {
    let sub;
    try { sub = await get(`https://data.sec.gov/submissions/CIK${mcik}.json`, true); } catch (e) { log.errors.push(`manager ${mcik}: ${e.message}`); continue; }
    const thirteenF = recentFilings(sub).filter((f) => /^13F-HR/.test(f.form));
    const periods = [...new Set(thirteenF.map((f) => f.reportDate))].sort().reverse().slice(0, QUARTERS_PER_MANAGER);
    if (!periods.length) continue;
    console.log(`\n== 13F ${sub.name} (${mcik}) periods ${periods.join(', ')}`);
    managers.push({ cik: mcik, name: sub.name, periods, discoveredFrom13G: !MANAGERS.includes(mcik) });
    for (const f of thirteenF.filter((x) => periods.includes(x.reportDate))) {
      try {
        const idx = await get(archiveUrl(mcik, f.accessionNumber, 'index.json'), true);
        const files = idx.directory.item.map((i) => i.name);
        const cover = files.find((n) => n === 'primary_doc.xml');
        const info = files.find((n) => /\.xml$/i.test(n) && n !== 'primary_doc.xml');
        const coverText = cover ? await get(archiveUrl(mcik, f.accessionNumber, cover)) : null;
        const infoText = info ? await get(archiveUrl(mcik, f.accessionNumber, info)) : null;
        const p13 = new SOI.Parser13F();
        const rec = p13.parseParts(
          { cover: coverText && { name: cover, text: coverText }, infoTable: infoText && { name: info, text: infoText } },
          { name: cover || info },
          { accessionNumber: f.accessionNumber, filingDate: f.filingDate, sourceUrl: archiveUrl(mcik, f.accessionNumber, ''), cusipFilter: allCusips, parsedAt: new Date().toISOString(), dataOrigin: 'sec-edgar' }
        );
        records.push(slim(rec));
        if (mcik === '0001067983' && !samples['form-13f']) {
          keepSample('form-13f', `${f.accessionNumber}-primary_doc.xml`, coverText);
          samples['form-13f'] = null;
          keepSample('form-13f', `${f.accessionNumber}-${info}`, infoText);
        }
        process.stdout.write(`[${f.form} ${f.reportDate}: ${rec.holdings.length} rows]`);
      } catch (e) { log.errors.push(`13F ${mcik} ${f.accessionNumber}: ${e.message}`); }
    }
  }

  // CUSIP verification: list the issuer names that 13F filers used for each CUSIP
  const cusipNames = {};
  for (const r of records.filter((x) => x.filing.formFamily === '13F')) for (const h of r.holdings) {
    (cusipNames[h.cusip] = cusipNames[h.cusip] || new Set()).add(`${h.issuerName} | ${h.titleOfClass}`);
  }
  const cusipCheck = Object.fromEntries(Object.entries(cusipNames).map(([k, v]) => [k, [...v].slice(0, 6)]));
  console.log('\nCUSIP check:', JSON.stringify(cusipCheck, null, 1));

  const out = {
    schema: 'soi.bundle/1.0',
    generatedAt: new Date().toISOString(),
    source: 'SEC EDGAR (www.sec.gov/Archives, data.sec.gov submissions and XBRL APIs)',
    notes: [
      'Records were produced by this project’s own parsers from the original EDGAR documents listed in each record’s sourceUrl.',
      '13F records keep only information-table rows for the CUSIPs of the demonstration companies; see extension.holdingsFilter.',
      'Schedules 13D/G are included from the structured-XML era (filings from 18 December 2024).',
      `Forms 3/4/5: up to ${MAX_FORM3_PER_COMPANY}/${MAX_FORM4_PER_COMPANY}/${MAX_FORM5_PER_COMPANY} most recent filings per issuer within the issuer's recent-filings list.`,
    ],
    companies, managers, cusipCheck, records,
    fetchLog: { requests: log.requests, cachedResponses: log.cached, errors: log.errors },
  };
  const dataDir = path.join(ROOT, 'ownership-dashboard', 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'sec-data.json'), JSON.stringify(out));
  fs.writeFileSync(path.join(dataDir, 'sec-data.js'), '/* Generated by tools/fetch-sec-data.js — verified SEC EDGAR data. Do not edit by hand. */\nwindow.SOI_SEC_DATA = ' + JSON.stringify(out) + ';\n');
  console.log(`\nWrote ${records.length} records (${companies.length} companies, ${managers.length} managers). Requests: ${log.requests}, cached: ${log.cached}, errors: ${log.errors.length}`);
  if (log.errors.length) console.log(log.errors.slice(0, 20).join('\n'));
}

main().catch((e) => { console.error(e); process.exit(1); });
