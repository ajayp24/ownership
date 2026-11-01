/*
 * Unit tests for every parser, the detector, entity resolution and the
 * ownership engine. Run with:  node --test tests/
 *
 * Real SEC documents in sample-data/ are the fixtures. Expected values are
 * cross-checked against the raw document text (regex counts, summary-page
 * totals) instead of being typed in by hand.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const SOI = require('../shared/load-node.js');

const SAMPLES = path.join(__dirname, '..', 'sample-data');
const sample = (dir, match) => {
  const d = path.join(SAMPLES, dir);
  const f = fs.readdirSync(d).find((n) => !match || n.includes(match));
  return { name: f, text: fs.readFileSync(path.join(d, f), 'utf8') };
};
const count = (text, tag) => (text.match(new RegExp(`<(\\w+:)?${tag}[\\s>]`, 'g')) || []).length;

// ---------------------------------------------------------------- detection

test('detector identifies every sample family', () => {
  const cases = [
    ['form-13f', 'primary_doc', '13F', 'cover'], ['form-13f', '-5', '13F', 'infoTable'],
    ['schedule-13d', null, '13D'], ['schedule-13g', null, '13G'], ['schedule-13g-legacy', null, '13G'],
    ['form3', null, 'FORM3'], ['form4', null, 'FORM4'], ['form5', null, 'FORM5'], ['full-submission', null, 'FORM4'],
  ];
  for (const [dir, m, fam, role] of cases) {
    const d = SOI.parsers.detect(sample(dir, m));
    assert.equal(d.family, fam, `${dir}: ${d.reasons.join('; ')}`);
    if (role) assert.equal(d.role, role);
  }
});

test('ambiguous documents are rejected with code AMBIGUOUS so the UI can ask', async () => {
  await assert.rejects(
    SOI.parsers.parse({ name: 'x.txt', text: 'Hello. This mentions Schedule 13D and Schedule 13G equally.' }),
    (e) => e.code === 'AMBIGUOUS' && Array.isArray(e.detection.candidates)
  );
  await assert.rejects(SOI.parsers.parse({ name: 'x.txt', text: 'nothing to see' }), (e) => e.code === 'AMBIGUOUS');
});

// ---------------------------------------------------------------- 13F

test('Parser13F: cover + information table (Berkshire 13F-HR) reconciles with the summary page', async () => {
  const cover = sample('form-13f', 'primary_doc');
  const table = fs.readdirSync(path.join(SAMPLES, 'form-13f')).find((n) => !n.includes('primary_doc'));
  const info = sample('form-13f', table);
  const rec = await new SOI.Parser13F().parse(cover, { companion: info });
  assert.equal(rec.filing.formFamily, '13F');
  assert.match(rec.filing.formType, /^13F-HR/);
  assert.equal(rec.filing.filerCik, '0001067983');
  assert.equal(rec.filing.reportPeriod, '2026-06-30');
  assert.equal(rec.filing.accessionNumber, '0001193125-26-352200', 'accession taken from the file name');
  assert.equal(rec.holdings.length, count(info.text, 'infoTable'));
  assert.equal(rec.holdings.length, rec.extension.summary.tableEntryTotal);
  const sum = rec.holdings.reduce((s, h) => s + h.valueRaw, 0);
  assert.equal(sum, rec.extension.summary.tableValueTotal);
  assert.equal(rec.extension.otherIncludedManagers.length, rec.extension.summary.otherIncludedManagersCount);
  assert.equal(rec.ownershipRelationships.filter((r) => r.type === 'OTHER_INCLUDED_MANAGER').length, rec.extension.otherIncludedManagers.length);
  assert.equal(rec.extension.valueUnit, 'USD');
  assert.deepEqual(rec.validation.errors, []);
  for (const h of rec.holdings) {
    assert.match(h.cusip, /^[0-9A-Z]{9}$/);
    assert.ok(h.sourcePath.includes('infoTable'), 'each row keeps its XML path');
  }
});

test('Parser13F: values before 3 Jan 2023 are converted from thousands', async () => {
  const xml = `<informationTable xmlns="http://www.sec.gov/edgar/document/thirteenf/informationtable"><infoTable><nameOfIssuer>EXAMPLE CO</nameOfIssuer><titleOfClass>COM</titleOfClass><cusip>000000AA1</cusip><value>1500</value><shrsOrPrnAmt><sshPrnamt>100</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt><investmentDiscretion>SOLE</investmentDiscretion><votingAuthority><Sole>100</Sole><Shared>0</Shared><None>0</None></votingAuthority></infoTable></informationTable>`;
  const old = await new SOI.Parser13F().parse({ name: 'it.xml', text: xml }, { filingDate: '2022-11-14' });
  assert.equal(old.extension.valueUnit, 'USD_THOUSANDS');
  assert.equal(old.holdings[0].valueUSD, 1500000);
  const recent = await new SOI.Parser13F().parse({ name: 'it.xml', text: xml }, { filingDate: '2023-02-14' });
  assert.equal(recent.holdings[0].valueUSD, 1500);
  assert.ok(recent.validation.warnings.some((w) => /Cover page/.test(w)), 'missing cover page is reported');
});

test('Parser13F: CSV information table, unmapped columns preserved', async () => {
  const csv = 'nameOfIssuer,titleOfClass,cusip,value,sshPrnamt,sshPrnamtType,investmentDiscretion,Sole,Shared,None,analystNote\n"EXAMPLE, INC",COM,000000AA1,2500,50,SH,SOLE,50,0,0,keep me\n';
  const rec = await new SOI.Parser13F().parse({ name: 'holdings.csv', text: csv }, { filingDate: '2026-02-01' });
  assert.equal(rec.holdings.length, 1);
  assert.equal(rec.holdings[0].issuerName, 'EXAMPLE, INC');
  assert.equal(rec.holdings[0].shares, 50);
  assert.ok(rec.unmapped.some((u) => u.value === 'keep me'));
});

test('Parser13F: malformed XML is reported as an error, not thrown', async () => {
  const rec = await new SOI.Parser13F().parse({ name: 'bad.xml', text: '<informationTable><infoTable><cusip>1</cusip></informationTable>' });
  assert.equal(rec.validation.status, 'errors');
  assert.ok(rec.validation.errors[0].includes('Mismatched'));
});

// ---------------------------------------------------------------- 13D / 13G

test('Parser13D: structured XML Schedule 13D/A', async () => {
  const s = sample('schedule-13d');
  const rec = await new SOI.Parser13D().parse(s);
  assert.equal(rec.filing.formFamily, '13D');
  assert.match(rec.filing.formType, /SCHEDULE 13D/);
  assert.match(rec.issuer.cik, /^\d{10}$/);
  const persons = count(s.text, 'reportingPersonInfo');
  assert.equal(rec.extension.reportingPersons.length, persons);
  assert.equal(rec.ownershipRelationships.filter((r) => r.type === 'BENEFICIAL_OWNERSHIP').length, persons);
  if (persons > 1) assert.equal(rec.ownershipRelationships.filter((r) => r.type === 'JOINT_FILER').length, persons - 1);
  for (const p of rec.extension.reportingPersons) {
    assert.equal(typeof p.percentOfClass, 'number');
    assert.equal(typeof p.aggregateAmountOwned, 'number');
  }
  assert.ok(rec.ownershipRelationships.every((r) => r.evidence.path), 'every edge carries an evidence path');
});

test('Parser13G: structured XML Schedule 13G keeps rule basis, CUSIP and filer type', async () => {
  const s = sample('schedule-13g');
  const rec = await new SOI.Parser13G().parse(s);
  assert.equal(rec.filing.formFamily, '13G');
  assert.equal(rec.issuer.cusips.length > 0, true);
  assert.ok(rec.extension.rulesDesignated.length > 0);
  const p = rec.extension.reportingPersons[0];
  const raw = (re) => Number((re.exec(s.text) || [])[1]);
  assert.equal(p.soleVotingPower, raw(/<soleVotingPower>([\d.]+)</));
  assert.equal(p.percentOfClass, raw(/<classPercent>([\d.]+)</));
});

test('Parser13G: unknown XML elements land in record.unmapped', async () => {
  const s = sample('schedule-13g');
  const text = s.text.replace('</coverPageHeader>', '<futureField>42</futureField></coverPageHeader>');
  const rec = await new SOI.Parser13G().parse({ name: s.name, text });
  assert.ok(rec.unmapped.some((u) => /futureField/.test(u.path) && u.value === '42'));
});

test('Parser13G: legacy HTML 13G is parsed heuristically and flagged', async () => {
  const s = sample('schedule-13g-legacy');
  const rec = await SOI.parsers.parse(s);
  assert.equal(rec.filing.formFamily, '13G');
  assert.equal(rec.extension.heuristic, true);
  assert.deepEqual(rec.issuer.cusips, ['037833100']);
  const first = rec.extension.reportingPersons[0];
  assert.equal(first.name, 'Warren E. Buffett');
  assert.equal(first.aggregateAmountOwned, 905560000);
  assert.equal(first.percentOfClass, 5.8);
  assert.ok(rec.validation.warnings[0].includes('heuristics'));
  assert.ok(rec.ownershipRelationships.every((r) => r.type !== 'BENEFICIAL_OWNERSHIP' || r.confidence === 'low'));
});

// ---------------------------------------------------------------- Forms 3 / 4 / 5

for (const [dir, Cls, doc] of [['form3', 'ParserForm3', '3'], ['form4', 'ParserForm4', '4'], ['form5', 'ParserForm5', '5']]) {
  test(`${Cls}: ownershipDocument rows match the raw XML`, async () => {
    const s = sample(dir);
    const rec = await new SOI[Cls]().parse(s);
    const ext = rec.extension;
    assert.equal(ext.documentType.replace('/A', ''), doc);
    assert.equal(ext.nonDerivativeTransactions.length, count(s.text, 'nonDerivativeTransaction'));
    assert.equal(ext.nonDerivativeHoldings.length, count(s.text, 'nonDerivativeHolding'));
    assert.equal(ext.derivativeTransactions.length, count(s.text, 'derivativeTransaction'));
    assert.equal(ext.derivativeHoldings.length, count(s.text, 'derivativeHolding'));
    assert.equal(ext.reportingOwners.length, count(s.text, 'reportingOwner'));
    assert.match(rec.issuer.cik, /^\d{10}$/);
    for (const t of ext.nonDerivativeTransactions.concat(ext.derivativeTransactions)) {
      assert.ok(SOI.models.TRANSACTION_CODES[t.code], `known code ${t.code}`);
      assert.match(t.acquiredDisposed, /^[AD]$/);
    }
    assert.ok(rec.ownershipRelationships.some((r) => r.type === 'INSIDER_ROLE'));
    assert.deepEqual(rec.validation.errors, []);
  });
}

test('Section 16 parser: full EDGAR submission .txt supplies accession and filing date', async () => {
  const s = sample('full-submission');
  const rec = await SOI.parsers.parse(s);
  assert.equal(rec.filing.formFamily, 'FORM4');
  assert.match(rec.filing.accessionNumber, /^\d{10}-\d{2}-\d{6}$/);
  assert.match(rec.filing.filingDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(rec.validation.missing.includes('filing.filingDate'), false);
});

test('Section 16 parser: wrong root element is an error', async () => {
  const rec = await new SOI.ParserForm4().parse({ name: 'x.xml', text: '<edgarSubmission><x>1</x></edgarSubmission>' });
  assert.equal(rec.validation.status, 'errors');
});

// ---------------------------------------------------------------- entity resolution

test('entity resolution: CIK first, identical normalized names only, never across different CIKs', () => {
  const E = SOI.entities;
  assert.equal(E.sameEntity({ name: 'WALTON S ROBSON' }, { name: 'S. Robson Walton' }).same, true);
  assert.equal(E.sameEntity({ name: 'The Vanguard Group' }, { name: 'VANGUARD GROUP INC' }).same, true);
  assert.equal(E.sameEntity({ name: 'Vanguard Group', cik: '102909' }, { name: 'Vanguard Group', cik: '2100119' }).same, false);
  assert.ok(E.affiliationHint({ name: 'VANGUARD GROUP INC', cik: '102909' }, { name: 'VANGUARD CAPITAL MANAGEMENT LLC', cik: '2100119' }));
  assert.equal(E.affiliationHint({ name: 'CAPITAL GROUP' }, { name: 'CAPITAL MANAGEMENT' }), null, 'generic words do not create hints');
});

// ---------------------------------------------------------------- ownership engine

function fake13F(opts) {
  const rec = SOI.models.emptyRecord();
  Object.assign(rec.filing, { formType: opts.amend ? '13F-HR/A' : '13F-HR', formFamily: '13F', isAmendment: !!opts.amend, amendmentType: opts.amend || '', accessionNumber: opts.acc, filingDate: opts.filed, reportPeriod: opts.period, filerCik: '0000000001', filerName: 'TEST MANAGER' });
  rec.extension = { type: '13F', otherIncludedManagers: [], confidentialTreatment: {}, holdingsFilter: null };
  rec.holdings = opts.rows.map((shares, i) => ({ row: i + 1, issuerName: 'EXAMPLE CO', titleOfClass: 'COM', cusip: '000000AA1', valueUSD: shares * 10, valueRaw: shares * 10, shares, sharesType: 'SH', putCall: '', investmentDiscretion: 'SOLE', otherManagers: [i], votingAuthority: { sole: shares, shared: 0, none: 0 }, sourcePath: 'test' }));
  rec.recordId = opts.acc;
  return rec;
}
const ISSUER = { name: 'Example Co', cik: '0000000099', cusips: ['000000AA1'], multiClass: false, sharesOutstanding: { value: 10000, asOf: '2026-06-30', form: '10-Q' } };

test('engine: restatement replaces, new-holdings adds, duplicated new-holdings is not double counted', () => {
  const base = fake13F({ acc: 'a1', filed: '2026-08-01', period: '2026-06-30', rows: [100] });
  const restated = fake13F({ acc: 'a2', filed: '2026-08-05', period: '2026-06-30', rows: [120], amend: 'RESTATEMENT' });
  let v = SOI.ownership.buildIssuerView([base, restated], ISSUER);
  assert.equal(v.institutional.byPeriod['2026-06-30'][0].shares, 120);

  const added = fake13F({ acc: 'a3', filed: '2026-08-06', period: '2026-06-30', rows: [7], amend: 'NEW HOLDINGS' });
  added.holdings[0].otherManagers = [9];
  v = SOI.ownership.buildIssuerView([base, added], ISSUER);
  assert.equal(v.institutional.byPeriod['2026-06-30'][0].shares, 107);

  const dup = fake13F({ acc: 'a4', filed: '2026-08-06', period: '2026-06-30', rows: [100], amend: 'NEW HOLDINGS' });
  v = SOI.ownership.buildIssuerView([base, dup], ISSUER);
  assert.equal(v.institutional.byPeriod['2026-06-30'][0].shares, 100, 'repeated table treated as replacement');
});

test('engine: % of outstanding only with a single-class denominator, and labelled calculated', () => {
  const r = fake13F({ acc: 'b1', filed: '2026-08-01', period: '2026-06-30', rows: [500] });
  let v = SOI.ownership.buildIssuerView([r], ISSUER);
  const p = v.institutional.byPeriod['2026-06-30'][0];
  assert.equal(p.pctOfOutstanding, 5);
  assert.match(p.pctBasis, /^Calculated/);
  v = SOI.ownership.buildIssuerView([r], Object.assign({}, ISSUER, { multiClass: true }));
  assert.equal(v.institutional.byPeriod['2026-06-30'][0].pctOfOutstanding, null);
  v = SOI.ownership.buildIssuerView([r], Object.assign({}, ISSUER, { sharesOutstanding: null }));
  assert.equal(v.institutional.byPeriod['2026-06-30'][0].pctOfOutstanding, null);
});

test('engine: quarter-over-quarter change and confidential-treatment handling', () => {
  const q1 = fake13F({ acc: 'c1', filed: '2026-05-01', period: '2026-03-31', rows: [100] });
  const q2 = fake13F({ acc: 'c2', filed: '2026-08-01', period: '2026-06-30', rows: [150] });
  let v = SOI.ownership.buildIssuerView([q1, q2], ISSUER);
  const ch = v.institutional.changes[0];
  assert.equal(ch.delta, 50);
  assert.equal(ch.status, 'increased');
  const q2c = fake13F({ acc: 'c3', filed: '2026-08-01', period: '2026-06-30', rows: [] });
  q2c.extension.confidentialTreatment = { isConfidentialOmitted: true };
  v = SOI.ownership.buildIssuerView([q1, q2c], ISSUER);
  assert.match(v.institutional.changes[0].status, /confidential/);
  assert.ok(v.quality.some((q) => /confidential/.test(q.text)));
});

test('engine: categories stay separate and overlaps are reported with evidence', async () => {
  const g13 = await new SOI.Parser13G().parse(sample('schedule-13g'));
  const issuer = { name: g13.issuer.name, cik: g13.issuer.cik, cusips: g13.issuer.cusips, multiClass: false };
  const f = fake13F({ acc: 'd1', filed: '2026-08-01', period: '2026-06-30', rows: [10] });
  f.filing.filerCik = g13.filing.filerCik;
  f.filing.filerName = g13.filing.filerName;
  f.holdings[0].cusip = issuer.cusips[0];
  const v = SOI.ownership.buildIssuerView([g13, f], issuer);
  assert.equal(v.beneficial.persons.length, g13.extension.reportingPersons.length);
  assert.equal(v.institutional.byPeriod['2026-06-30'].length, 1);
  const o = v.overlaps.find((x) => x.kind === '13F ↔ 13D/G');
  assert.ok(o, 'same filer in 13F and 13G is flagged');
  assert.ok(o.evidence.length === 2);
  assert.equal('total' in v, false, 'no combined total is produced');
});
