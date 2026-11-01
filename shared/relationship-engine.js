/*
 * relationship-engine.js — turns normalized filing records into relationship
 * edges for one issuer, and into graph elements for Cytoscape.
 *
 * Parsers store explicit relationships (13D/G beneficial ownership, Section 16
 * roles and holdings, 13F other-included-manager links). 13F holdings are
 * stored as rows, so this module derives one REPORTED_13F_HOLDING edge per
 * manager × reporting period × CUSIP, keeping every source row as evidence.
 */
(function (g) {
  'use strict';
  const SOI = (g.SOI = g.SOI || {});

  function issuerMatches(rec, issuer) {
    if (issuer.cik && rec.issuer.cik && SOI.models.padCik(rec.issuer.cik) === SOI.models.padCik(issuer.cik)) return true;
    const cus = new Set((issuer.cusips || []).map((c) => c.toUpperCase()));
    return (rec.issuer.cusips || []).some((c) => cus.has(c.toUpperCase()) || cus.has(c.toUpperCase().slice(0, 6)) || [...cus].some((k) => k.slice(0, 6) === c.toUpperCase().slice(0, 6)));
  }

  /** 13F rows that refer to the issuer: exact CUSIP, or same 6-character issuer prefix. */
  function rowsForIssuer(rec, issuer) {
    const full = new Set((issuer.cusips || []).map((c) => c.toUpperCase()));
    const prefixes = new Set([...full].map((c) => c.slice(0, 6)));
    return rec.holdings.filter((h) => full.has(h.cusip) || prefixes.has(h.cusip.slice(0, 6)));
  }

  /** Derived 13F edges (one per manager-filing × CUSIP × option flag). */
  function thirteenFEdges(rec, issuer) {
    const M = SOI.models;
    const rows = rowsForIssuer(rec, issuer);
    const groups = new Map();
    rows.forEach((h) => {
      const key = `${h.cusip}|${h.putCall || ''}|${h.sharesType}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(h);
    });
    const from = { name: rec.filing.filerName, cik: rec.filing.filerCik, kind: 'manager' };
    const to = { name: issuer.name, cik: issuer.cik, kind: 'issuer' };
    const out = [];
    for (const [key, hs] of groups) {
      const [cusip, putCall, sharesType] = key.split('|');
      const sum = (f) => hs.reduce((s, h) => s + (f(h) || 0), 0);
      const discretion = {};
      hs.forEach((h) => { discretion[h.investmentDiscretion || 'UNSPECIFIED'] = (discretion[h.investmentDiscretion || 'UNSPECIFIED'] || 0) + (h.shares || 0); });
      out.push(M.relationship(rec, 'REPORTED_13F_HOLDING', from, to, {
        cusip, putCall, sharesType, securityClass: hs[0].titleOfClass, issuerNameAsReported: hs[0].issuerName,
        shares: sum((h) => h.shares), valueUSD: sum((h) => h.valueUSD), rows: hs.length,
        discretion, votingAuthority: { sole: sum((h) => h.votingAuthority.sole), shared: sum((h) => h.votingAuthority.shared), none: sum((h) => h.votingAuthority.none) },
        otherManagers: [...new Set(hs.flatMap((h) => h.otherManagers))],
        asOfDate: rec.filing.reportPeriod, dateBasis: 'reportPeriod', status: 'reported', confidence: 'high',
        percentOfClass: null, percentBasis: 'not-reported',
      }, {
        path: hs.map((h) => h.sourcePath).join('; '),
        note: `${hs.length} information-table row(s) summed. A 13F shows securities over which the manager exercises investment discretion; it does not establish that the manager is the legal or beneficial owner.` + (putCall ? ` These rows are ${putCall} options: the share figure is the underlying amount, not shares held.` : ''),
      }));
    }
    return out;
  }

  /** All relationship edges about one issuer, from every record supplied. */
  function relationshipsForIssuer(records, issuer) {
    const out = [];
    for (const rec of records) {
      if (rec.filing.formFamily === '13F') {
        const edges = thirteenFEdges(rec, issuer);
        out.push(...edges);
        if (edges.length) out.push(...rec.ownershipRelationships.filter((r) => r.type === 'OTHER_INCLUDED_MANAGER'));
      } else if (issuerMatches(rec, issuer)) {
        out.push(...rec.ownershipRelationships);
      }
    }
    out.forEach((r, i) => { r.id = r.id || `${r.type}:${r.evidence.accessionNumber || 'na'}:${i}`; });
    return out;
  }

  /**
   * Graph elements for Cytoscape. `opts.filter(rel)` can drop edges; entities
   * are resolved with the EntityRegistry so the same CIK becomes one node.
   */
  function toGraph(rels, issuer, opts = {}) {
    const reg = new SOI.entities.EntityRegistry();
    const nodes = new Map();
    const edges = [];
    const issuerEnt = reg.add({ name: issuer.name, cik: issuer.cik }, 'issuer');
    const kindRank = { issuer: 5, insider: 4, beneficialOwner: 3, manager: 2, entity: 1 };
    const addNode = (e, kind) => {
      const ent = e.kind === 'issuer' && (!e.cik || e.cik === issuer.cik) ? issuerEnt : reg.add(e, kind);
      const prev = nodes.get(ent.id);
      if (!prev) nodes.set(ent.id, { data: { id: ent.id, label: ent.name, kind, cik: ent.cik, names: [] } });
      else if ((kindRank[kind] || 0) > (kindRank[prev.data.kind] || 0) && prev.data.kind !== 'issuer') prev.data.kind = kind;
      const n = nodes.get(ent.id);
      if (e.name && !n.data.names.includes(e.name)) n.data.names.push(e.name);
      return ent.id;
    };
    for (const r of rels) {
      if (opts.filter && !opts.filter(r)) continue;
      const s = addNode(r.from, r.from.kind || 'entity');
      const t = addNode(r.to, r.to.kind || 'entity');
      edges.push({ data: { id: 'x' + edges.length, source: s, target: t, type: r.type, label: opts.edgeLabel ? opts.edgeLabel(r) : '', rel: r } });
    }
    return { nodes: [...nodes.values()], edges, registry: reg };
  }

  SOI.relationships = { issuerMatches, rowsForIssuer, thirteenFEdges, relationshipsForIssuer, toGraph };
  if (typeof module !== 'undefined' && module.exports) module.exports = SOI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
