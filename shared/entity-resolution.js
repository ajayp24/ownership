/*
 * entity-resolution.js — decides when two names in different filings refer to
 * the same person or organisation.
 *
 * Rules (conservative on purpose):
 *   1. Same CIK  → same entity (reported fact).
 *   2. Different CIKs → never merged, even if names look alike.
 *   3. No CIK on one side → merged only when the normalized name token sets are
 *      identical (e.g. "WALTON S ROBSON" and "S. Robson Walton").
 *   4. Name similarity short of that is only an *affiliation hint*: shown as
 *      an inferred, low-confidence possibility, never merged.
 */
(function (g) {
  'use strict';
  const SOI = (g.SOI = g.SOI || {});

  const SUFFIXES = new Set(['INC', 'INCORPORATED', 'CORP', 'CORPORATION', 'CO', 'COMPANY', 'LLC', 'L', 'P', 'LP', 'LLP', 'LTD', 'LIMITED', 'PLC', 'THE', 'NA', 'N', 'A', 'SA', 'AG', 'NV', 'SE', 'JR', 'SR', 'II', 'III', 'IV', 'MR', 'MS', 'DR', 'ET', 'AL']);
  const GENERIC = new Set(['CAPITAL', 'MANAGEMENT', 'INVESTMENT', 'INVESTMENTS', 'ADVISORS', 'ADVISERS', 'ASSET', 'ASSETS', 'FUND', 'FUNDS', 'TRUST', 'BANK', 'GROUP', 'HOLDINGS', 'HOLDING', 'FINANCIAL', 'PARTNERS', 'GLOBAL', 'INTERNATIONAL', 'NATIONAL', 'AMERICA', 'AMERICAN', 'FAMILY', 'FOUNDATION', 'SECURITIES', 'STATE', 'FIRST', 'NEW', 'ENTERPRISES']);

  function tokens(name) {
    return String(name || '')
      .toUpperCase()
      .replace(/\/[A-Z]{2,3}\/?/g, ' ') // "/MD/", "/DE/" state tags in EDGAR names
      .replace(/&/g, ' AND ')
      .replace(/[^A-Z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter((t) => t && !SUFFIXES.has(t) && t !== 'AND');
  }

  function normalizeName(name) {
    return tokens(name).join(' ');
  }

  function tokenKey(name) {
    return tokens(name).slice().sort().join(' ');
  }

  function entityKey(e) {
    const cik = SOI.models.padCik(e && e.cik);
    return cik ? 'cik:' + cik : 'name:' + tokenKey(e && e.name);
  }

  function jaccard(a, b) {
    const A = new Set(tokens(a)), B = new Set(tokens(b));
    if (!A.size || !B.size) return 0;
    let inter = 0;
    A.forEach((t) => { if (B.has(t)) inter++; });
    return inter / (A.size + B.size - inter);
  }

  /** Strict identity per the rules above. Returns { same, basis }. */
  function sameEntity(a, b) {
    const ca = SOI.models.padCik(a.cik), cb = SOI.models.padCik(b.cik);
    if (ca && cb) return { same: ca === cb, basis: ca === cb ? 'CIK match' : 'different CIKs' };
    const ka = tokenKey(a.name), kb = tokenKey(b.name);
    if (ka && ka === kb) return { same: true, basis: 'identical normalized name (no CIK on one side)' };
    return { same: false, basis: 'no match' };
  }

  /** A possible affiliation: same distinctive leading word, e.g. "Vanguard". */
  function affiliationHint(a, b) {
    if (sameEntity(a, b).same) return null;
    const ta = tokens(a.name).filter((t) => !GENERIC.has(t) && t.length > 3);
    const tb = tokens(b.name).filter((t) => !GENERIC.has(t) && t.length > 3);
    if (!ta.length || !tb.length) return null;
    if (ta[0] === tb[0]) return { token: ta[0], basis: `Both names start with the distinctive word "${ta[0]}"` };
    return null;
  }

  /**
   * Builds a registry that hands out a stable id per resolved entity.
   * Entities with a CIK are keyed by CIK; name-only entities attach to an
   * existing CIK entity when the normalized names are identical.
   */
  class EntityRegistry {
    constructor() { this.byKey = new Map(); this.nameIndex = new Map(); this.list = []; }
    add(e, kind) {
      const cik = SOI.models.padCik(e.cik);
      const nk = tokenKey(e.name);
      let ent = null;
      if (cik) ent = this.byKey.get('cik:' + cik);
      if (!ent && nk) {
        const cand = this.nameIndex.get(nk);
        if (cand && (!cik || !cand.cik)) ent = cand;
      }
      if (!ent) {
        ent = { id: 'e' + (this.list.length + 1), cik: cik || '', name: e.name || '', names: new Set(), kinds: new Set(), matchBasis: [] };
        this.list.push(ent);
      } else if (cik && !ent.cik) {
        ent.cik = cik;
        ent.matchBasis.push(`Name-only entry "${ent.name}" merged with CIK ${cik} by identical normalized name`);
      }
      if (cik) this.byKey.set('cik:' + cik, ent);
      if (nk && !this.nameIndex.has(nk)) this.nameIndex.set(nk, ent);
      if (e.name) ent.names.add(e.name);
      if (kind) ent.kinds.add(kind);
      if (!ent.name && e.name) ent.name = e.name;
      return ent;
    }
    get(e) {
      const cik = SOI.models.padCik(e.cik);
      if (cik && this.byKey.has('cik:' + cik)) return this.byKey.get('cik:' + cik);
      const nk = tokenKey(e.name);
      return this.nameIndex.get(nk) || null;
    }
  }

  SOI.entities = { tokens, normalizeName, tokenKey, entityKey, jaccard, sameEntity, affiliationHint, EntityRegistry };
  if (typeof module !== 'undefined' && module.exports) module.exports = SOI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
