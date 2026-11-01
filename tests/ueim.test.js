/*
 * Tests for the UEIM masters (shared/ueim-masters.js) using the bundled SEC data and the
 * BlackRock/Apple demonstration data. Expected values come from the filings themselves.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

global.window = globalThis;
const ROOT = path.join(__dirname, '..');
const SOI = require('../shared/load-node.js');
const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, 'ownership-dashboard', 'data', 'sec-data.json'), 'utf8'));
require(path.join(ROOT, 'ueim', 'data', 'ueim-data.js'));
const M = SOI.ueim.build({ records: DATA.records, companies: DATA.companies, ueim: globalThis.UEIM_DATA, asOf: '2026-11-02' });
const rolesOf = (e) => new Set(M.entityRoles.filter((r) => r.entityId === e.entityId).map((r) => r.roleCode));
const relsBetween = (a, b, type) => M.relationships.filter((r) => r.fromEntityId === a.entityId && r.toEntityId === b.entityId && (!type || r.relationshipType === type));

test('one entity per CIK; type and role are separate', () => {
  const ciks = M.entities.filter((e) => e.cik).map((e) => e.cik);
  assert.equal(new Set(ciks).size, ciks.length, 'no duplicate CIKs');
  const blk = M.byCik.get('0002012383');
  assert.equal(blk.entityType, 'PUBLIC_COMPANY');
  const roles = rolesOf(blk);
  assert.ok(roles.has('INSTITUTIONAL_INVESTMENT_MANAGER') && roles.has('FILER'), 'BlackRock is one company with several roles');
  assert.ok(rolesOf(M.byCik.get('0000320193')).has('ISSUER'));
});

test('two BlackRock legal entities stay separate (same name, different CIK)', () => {
  const now = M.byCik.get('0002012383'), old = M.byCik.get('0001364742');
  assert.notEqual(now.entityId, old.entityId);
  assert.ok(now.sameNameOtherCiks.some((o) => o.cik === '0001364742'));
  assert.equal(M.entities.filter((e) => e.resolution === 'UNRESOLVED_NAME').length, 0);
});

test('BlackRock 13G/A on Apple: verified figures become separate relationships', () => {
  const old = M.byCik.get('0001364742'), apple = M.byCik.get('0000320193');
  const get = (t) => relsBetween(old, apple, t)[0];
  assert.equal(get('REPORTS_BENEFICIAL_OWNERSHIP_OF').shares, 1043713019);
  assert.equal(get('REPORTS_BENEFICIAL_OWNERSHIP_OF').ownershipPercentage, 6.7);
  assert.equal(get('HAS_SOLE_VOTING_POWER').shares, 936902208);
  assert.equal(get('HAS_SOLE_DISPOSITIVE_POWER').shares, 1043713019);
  assert.equal(get('HAS_SHARED_VOTING_POWER'), undefined, 'zero shared power is not turned into a relationship');
  assert.equal(get('DIRECTLY_OWNS'), undefined, 'no legal/direct ownership is invented');
  const f = M.filingById.get(get('BENEFICIALLY_OWNS').sourceFilingId);
  assert.equal(f.accessionNumber, '0001086364-24-006980');
  assert.equal(f.filingDate, '2024-02-12');
  assert.equal(get('BENEFICIALLY_OWNS').validFrom, '2023-12-31');
});

test('Exhibit A subsidiaries are documented PARENT_OF / SUBSIDIARY_OF links; no fund records are invented', () => {
  const old = M.byCik.get('0001364742');
  const subs = M.relationships.filter((r) => r.fromEntityId === old.entityId && r.relationshipType === 'PARENT_OF');
  assert.equal(subs.length, globalThis.UEIM_DATA.blackrock13G.exhibitA.length);
  assert.ok(subs.every((r) => r.evidenceStatus === 'DOCUMENTED' && r.sourceFilingId));
  assert.equal(M.entities.filter((e) => ['FUND', 'ETF', 'MUTUAL_FUND', 'HEDGE_FUND'].includes(e.entityType)).length, 0);
});

test('13F is investment discretion, not ownership; full BlackRock table reconciles with its summary page', () => {
  const blk = M.byCik.get('0002012383'), apple = M.byCik.get('0000320193');
  const d = relsBetween(blk, apple, 'EXERCISES_INVESTMENT_DISCRETION_OVER');
  assert.ok(d.length >= 1);
  assert.equal(M.relTypes.find((t) => t.code === 'EXERCISES_INVESTMENT_DISCRETION_OVER').isOwnership, false);
  const meta = M.fullBlackRock.meta;
  const total = M.fullBlackRock.positions.reduce((s, p) => s + p.valueUSD, 0);
  assert.equal(total, meta.summary.tableValueTotal);
  assert.equal(M.fullBlackRock.positions.reduce((s, p) => s + p.rows, 0), meta.summary.tableEntryTotal);
  const aapl = M.fullBlackRock.positions.find((p) => p.cusip === '037833100' && !p.putCall);
  assert.equal(aapl.shares, d.find((r) => r.validFrom === meta.reportPeriod && !r.putCall).shares);
});

test('every relationship has a source filing and a validity start; chains close earlier figures', () => {
  assert.ok(M.relationships.every((r) => r.sourceFilingId && M.filingById.get(r.sourceFilingId)));
  assert.ok(M.relationships.every((r) => r.validFrom));
  const dan = M.entities.find((e) => /Danone North America/.test(e.legalName));
  const lway = M.byCik.get('0000814586');
  const open = relsBetween(dan, lway, 'BENEFICIALLY_OWNS').filter((r) => !r.validTo);
  assert.equal(open.length, 0, 'Danone stake is closed by its final 13D/A');
});
