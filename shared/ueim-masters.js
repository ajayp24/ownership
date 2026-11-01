/*
 * ueim-masters.js — UEIM (Ultimate Entity & Investment Manager Master).
 *
 * Builds canonical master tables from normalized filing records:
 *
 *   entities        one row per real-world entity (CIK-first resolution)
 *   roles           role master (what an entity can DO)
 *   entityRoles     entity × role × context (issuer), with validity dates and sources
 *   relTypes        relationship-type master (corporate / investment / ownership /
 *                   reporting / authority / insider), each saying whether it is ownership
 *   relationships   entity → entity edges, each with its source filing and evidence
 *   filings         one row per filing (accession)
 *   securities      one row per CUSIP
 *   positions       one row per reported position (13F, 13D/G cover page, Section 16)
 *
 * Rules (from the UEIM specification):
 *  - Entity TYPE (what it is) and ROLE (what it does) are separate; one entity, many roles.
 *  - No duplicate entities because an entity appears in several filing types.
 *  - Entities with similar names are never merged unless a CIK or identical name proves it,
 *    and a name that maps to two different CIKs stays unresolved rather than guessed.
 *  - Nothing undisclosed is populated; every relationship carries its source and evidence.
 */
(function (g) {
  'use strict';
  const SOI = (g.SOI = g.SOI || {});

  const ROLES = [
    ['ISSUER', 'Issuer', 'Entity whose securities are the subject of the filing'],
    ['FILER', 'Filer', 'Entity in whose name the filing was submitted to EDGAR'],
    ['REPORTING_PERSON', 'Reporting person', 'Person or entity with its own cover page (13D/G) or reporting owner (Forms 3/4/5)'],
    ['INSTITUTIONAL_INVESTMENT_MANAGER', 'Institutional investment manager', 'Entity exercising investment discretion over 13(f) securities (Form 13F)'],
    ['BENEFICIAL_OWNER', 'Beneficial owner', 'Has or shares voting and/or dispositive power (Rule 13d-3), as reported on Schedule 13D/G'],
    ['DIRECT_OWNER', 'Direct owner', 'Section 16 holding reported as direct (D)'],
    ['INDIRECT_OWNER', 'Indirect owner', 'Section 16 holding reported as indirect (I)'],
    ['VOTING_AUTHORITY_HOLDER', 'Voting authority holder', 'Reports sole or shared voting power/authority'],
    ['DISPOSITIVE_AUTHORITY_HOLDER', 'Dispositive authority holder', 'Reports sole or shared power to dispose'],
    ['DIRECTOR', 'Director', 'Director box checked on Forms 3/4/5'],
    ['EXECUTIVE_OFFICER', 'Executive officer', 'Officer box checked on Forms 3/4/5'],
    ['TEN_PERCENT_OWNER', '10% owner', '10% owner box checked on Forms 3/4/5'],
    ['PARENT', 'Parent', 'Identified as parent holding company in a filing'],
    ['SUBSIDIARY', 'Subsidiary', 'Identified as a subsidiary in a filing (e.g. Schedule 13G Item 7 / Exhibit A)'],
    ['GENERAL_PARTNER', 'General partner', 'Documented as general partner'],
    ['LIMITED_PARTNER', 'Limited partner', 'Documented as limited partner'],
    ['FUND_MANAGER', 'Fund manager', 'Documented as manager of a named fund'],
    ['CUSTODIAN', 'Custodian', 'Documented as custodian'],
    ['OTHER_INCLUDED_MANAGER', 'Other included manager', 'Listed on another manager\'s 13F summary page as an Other Included Manager'],
  ].map(([code, name, description], i) => ({ roleId: 'R' + String(i + 1).padStart(3, '0'), roleCode: code, roleName: name, description }));

  const REL_TYPES = [
    ['CORPORATE', 'PARENT_OF', false, 'Parent of'], ['CORPORATE', 'SUBSIDIARY_OF', false, 'Subsidiary of'], ['CORPORATE', 'CONTROLS', false, 'Controls'],
    ['CORPORATE', 'CONTROLLED_BY', false, 'Controlled by'], ['CORPORATE', 'AFFILIATED_WITH', false, 'Affiliated with'], ['CORPORATE', 'MERGED_INTO', false, 'Merged into'],
    ['INVESTMENT', 'MANAGES', false, 'Manages'], ['INVESTMENT', 'INVESTMENT_MANAGER_OF', false, 'Investment manager of'], ['INVESTMENT', 'GENERAL_PARTNER_OF', false, 'General partner of'],
    ['INVESTMENT', 'LIMITED_PARTNER_OF', false, 'Limited partner of'], ['INVESTMENT', 'ADVISER_TO', false, 'Adviser to'], ['INVESTMENT', 'CUSTODIAN_FOR', false, 'Custodian for'],
    ['INVESTMENT', 'EXERCISES_INVESTMENT_DISCRETION_OVER', false, 'Exercises investment discretion over (13F position)'],
    ['OWNERSHIP', 'DIRECTLY_OWNS', true, 'Directly owns'], ['OWNERSHIP', 'INDIRECTLY_OWNS', true, 'Indirectly owns'], ['OWNERSHIP', 'BENEFICIALLY_OWNS', true, 'Beneficially owns'],
    ['OWNERSHIP', 'HOLDS_SECURITIES_OF', true, 'Holds securities of'], ['OWNERSHIP', 'SHARED_BENEFICIAL_OWNERSHIP', true, 'Shares beneficial ownership with'],
    ['REPORTING', 'FILES_FOR', false, 'Files for'], ['REPORTING', 'REPORTS_ON', false, 'Reports on'], ['REPORTING', 'JOINT_REPORTING_PERSON', false, 'Joint reporting person with'],
    ['REPORTING', 'REPORTS_BENEFICIAL_OWNERSHIP_OF', false, 'Reports beneficial ownership of'], ['REPORTING', 'INCLUDES_OTHER_MANAGER', false, 'Includes in its 13F (other included manager)'],
    ['AUTHORITY', 'HAS_SOLE_VOTING_POWER', false, 'Has sole voting power over'], ['AUTHORITY', 'HAS_SHARED_VOTING_POWER', false, 'Has shared voting power over'],
    ['AUTHORITY', 'HAS_SOLE_DISPOSITIVE_POWER', false, 'Has sole dispositive power over'], ['AUTHORITY', 'HAS_SHARED_DISPOSITIVE_POWER', false, 'Has shared dispositive power over'],
    ['INSIDER', 'DIRECTOR_OF', false, 'Director of'], ['INSIDER', 'OFFICER_OF', false, 'Officer of'], ['INSIDER', 'INSIDER_OF', false, 'Insider (10% owner / other) of'],
  ].map(([category, code, isOwnership, label]) => ({ code, category, label, isOwnership }));

  const ENTITY_TYPES = ['PUBLIC_COMPANY', 'PRIVATE_COMPANY', 'COMPANY', 'ISSUER', 'INVESTMENT_MANAGER', 'INSTITUTIONAL_MANAGER', 'FUND', 'HEDGE_FUND', 'MUTUAL_FUND', 'ETF', 'TRUST', 'INDIVIDUAL', 'PARTNERSHIP', 'BENEFICIAL_OWNER', 'REPORTING_PERSON', 'DIRECTOR', 'OFFICER', 'PARENT_COMPANY', 'SUBSIDIARY', 'GENERAL_PARTNER', 'LIMITED_PARTNER', 'CUSTODIAN', 'OTHER'];

  function build(input) {
    const M = SOI.models, E = SOI.entities;
    const ueim = input.ueim || null;
    const extra = ueim && ueim.blackrock13G ? [ueim.blackrock13G.record] : [];
    const records = SOI.ownership.dedupeRecords(input.records.concat(extra)).records;
    const companies = input.companies || [];
    const profiles = (ueim && ueim.profiles) || {};

    // ------------------------------------------------------------ entity resolution
    const entities = [];
    const byCik = new Map();
    const byName = new Map(); // tokenKey -> Set(entity)
    const seq = { E: 0, F: 0, S: 0, P: 0, REL: 0, ER: 0 };
    const id = (k, n) => k + String(++seq[k]).padStart(n || 4, '0');

    function entity(raw) {
      const cik = M.padCik(raw.cik);
      const key = E.tokenKey(raw.name);
      let ent = cik ? byCik.get(cik) : null;
      if (!ent && key) {
        const cands = [...(byName.get(key) || [])];
        if (cik) ent = cands.find((c) => !c.cik) || null; // a name-only entry gains its CIK
        else if (cands.length === 1) ent = cands[0];
        else if (cands.length > 1) {
          // Same name, several CIKs: do not guess. Keep one unresolved entity for this name.
          ent = cands.find((c) => c.resolution === 'UNRESOLVED_NAME') || null;
          if (!ent) { ent = make(raw, ''); ent.resolution = 'UNRESOLVED_NAME'; ent.resolutionNote = `Name matches ${cands.filter((c) => c.cik).length} entities with different CIKs; not merged.`; }
        }
      }
      if (!ent) ent = make(raw, cik);
      if (cik && !ent.cik) { ent.cik = cik; ent.resolution = 'CIK'; byCik.set(cik, ent); }
      if (raw.name) {
        if (!ent.allNames.includes(raw.name)) ent.allNames.push(raw.name);
        if (!byName.has(key)) byName.set(key, new Set());
        byName.get(key).add(ent);
      }
      if (raw.date) { if (!ent.firstSeen || raw.date < ent.firstSeen) ent.firstSeen = raw.date; if (!ent.lastSeen || raw.date > ent.lastSeen) { ent.lastSeen = raw.date; if (raw.name && !raw.weakName) ent.reportedName = raw.name; } }
      if (raw.hint) ent.typeHints.push(raw.hint);
      if (raw.jurisdiction && !ent.jurisdiction) { ent.jurisdiction = raw.jurisdiction; ent.jurisdictionSource = raw.jurisdictionSource || ''; }
      return ent;
    }
    function make(raw, cik) {
      const ent = {
        entityId: id('E'), legalName: '', reportedName: raw.name || '', allNames: [], normalizedName: E.normalizeName(raw.name).toUpperCase(),
        entityType: 'OTHER', entityTypeBasis: '', jurisdiction: null, jurisdictionSource: '', cik: cik || '', lei: null, ticker: null, cusip: null, taxIdentifier: null,
        entityStatus: '', source: 'SEC', createdDate: '', lastUpdated: '', firstSeen: '', lastSeen: '',
        resolution: cik ? 'CIK' : 'NAME_ONLY', resolutionNote: '', typeHints: [], edgarProfile: null, nameHistory: [],
      };
      entities.push(ent);
      if (cik) byCik.set(cik, ent);
      return ent;
    }

    // ------------------------------------------------------------ filings, securities, roles, relationships, positions
    const filings = [], securities = [], positions = [], relationships = [], entityRoles = [];
    const secByCusip = new Map();
    const filingByAcc = new Map();
    function security(cusip, issuerEnt, cls, nameAsReported) {
      if (!cusip) return null;
      let s = secByCusip.get(cusip);
      if (!s) { s = { securityId: id('S'), cusip, issuerEntityId: issuerEnt ? issuerEnt.entityId : null, issuerNameAsReported: nameAsReported || '', securityClass: cls || '' }; secByCusip.set(cusip, s); securities.push(s); }
      if (issuerEnt && !s.issuerEntityId) s.issuerEntityId = issuerEnt.entityId;
      if (cls && !s.securityClass) s.securityClass = cls;
      return s;
    }
    const roleIdx = new Map();
    function role(ent, code, ctxEnt, date, filingId, note) {
      const k = `${ent.entityId}|${code}|${ctxEnt ? ctxEnt.entityId : ''}`;
      let r = roleIdx.get(k);
      if (!r) { r = { entityRoleId: id('ER'), entityId: ent.entityId, roleCode: code, contextEntityId: ctxEnt ? ctxEnt.entityId : null, validFrom: date || '', validTo: null, sourceFilingIds: [], note: note || '' }; roleIdx.set(k, r); entityRoles.push(r); }
      if (date && (!r.validFrom || date < r.validFrom)) r.validFrom = date;
      if (date && (!r.lastEvidence || date > r.lastEvidence)) r.lastEvidence = date;
      if (filingId && !r.sourceFilingIds.includes(filingId)) r.sourceFilingIds.push(filingId);
      return r;
    }
    function rel(from, type, to, props, filing, evidence) {
      const r = Object.assign({
        relationshipId: id('REL'), fromEntityId: from.entityId, toEntityId: to.entityId, relationshipType: type, relationshipDirection: 'FROM_TO',
        securityId: null, ownershipPercentage: null, shares: null, votingPower: null, dispositivePower: null,
        validFrom: '', validTo: null, sourceFilingId: filing ? filing.filingId : null, filingDate: filing ? filing.filingDate : '', reportingPeriod: filing ? filing.reportPeriod || filing.eventDate : '',
        evidenceText: evidence || '', evidenceStatus: 'DOCUMENTED', confidence: 'HIGH', isInferred: false, directIndirect: null,
      }, props || {});
      relationships.push(r);
      return r;
    }
    function filingRow(rec, filerEnt, issuerEnt, extra) {
      const f = rec.filing;
      if (filingByAcc.has(f.accessionNumber + '|' + f.formFamily)) return filingByAcc.get(f.accessionNumber + '|' + f.formFamily);
      const row = Object.assign({
        filingId: id('F'), formType: f.formType, formFamily: f.formFamily, accessionNumber: f.accessionNumber,
        filerEntityId: filerEnt ? filerEnt.entityId : null, issuerEntityId: issuerEnt ? issuerEnt.entityId : null,
        reportingPersonEntityIds: [], filingDate: f.filingDate, eventDate: f.eventDate || '', reportPeriod: f.reportPeriod || '',
        sourceUrl: f.sourceUrl, documentType: (f.sourceFormat || '').toUpperCase(), processingStatus: rec.validation.status === 'errors' ? 'ERROR' : rec.validation.status === 'warnings' ? 'PROCESSED_WITH_WARNINGS' : 'PROCESSED',
        positionCount: 0, recordId: rec.recordId,
      }, extra || {});
      filings.push(row);
      filingByAcc.set(f.accessionNumber + '|' + f.formFamily, row);
      return row;
    }

    // Issuers from the company list first (they carry tickers and EDGAR profiles)
    const issuerEnts = new Map();
    companies.forEach((c) => {
      const ent = entity({ name: c.name, cik: c.cik, hint: 'listed-company', jurisdiction: c.stateOfIncorporation || null, jurisdictionSource: 'EDGAR company record (state of incorporation)' });
      ent.ticker = (c.tickers || [c.ticker]).join(', ');
      ent.cusip = (c.cusips || []).join(', ');
      ent.edgarProfile = { name: c.name, exchanges: c.exchanges, sicDescription: c.sicDescription, source: c.submissionsUrl };
      issuerEnts.set(c.cik, ent);
      (c.cusips || []).forEach((cu) => security(cu, ent, '', c.name));
    });
    Object.values(profiles).forEach((p) => {
      const ent = entity({ name: p.name, cik: p.cik });
      ent.edgarProfile = p;
      ent.nameHistory = (p.formerNames || []).map((n) => ({ name: n.name, from: (n.from || '').slice(0, 10), to: (n.to || '').slice(0, 10) }));
      if (p.tickers && p.tickers.length) ent.ticker = p.tickers.join(', ');
      if (p.stateOfIncorporation && !ent.jurisdiction) { ent.jurisdiction = p.stateOfIncorporation; ent.jurisdictionSource = 'EDGAR company record (state of incorporation)'; }
    });
    const issuerFor = (rec) => {
      const cik = rec.issuer.cik;
      if (cik && issuerEnts.has(cik)) return issuerEnts.get(cik);
      if (!rec.issuer.name && !cik) return null;
      const cus = rec.issuer.cusips && rec.issuer.cusips[0];
      const known = cus && secByCusip.get(cus);
      if (!cik && known && known.issuerEntityId) return entities.find((e) => e.entityId === known.issuerEntityId);
      return entity({ name: rec.issuer.name, cik, hint: 'issuer' });
    };

    const insiderIdx = new Map();
    for (const rec of records) {
      const f = rec.filing, ext = rec.extension || {};
      const date = f.reportPeriod || f.eventDate || f.filingDate;
      if (f.formFamily === '13F') {
        const mgr = entity({ name: f.filerName, cik: f.filerCik, date: f.filingDate, hint: '13F-filer' });
        const fr = filingRow(rec, mgr, null);
        role(mgr, 'FILER', null, f.filingDate, fr.filingId);
        role(mgr, 'INSTITUTIONAL_INVESTMENT_MANAGER', null, f.reportPeriod, fr.filingId);
        (ext.otherIncludedManagers || []).forEach((om) => {
          const o = entity({ name: om.name, cik: om.cik, date: f.filingDate, weakName: true, hint: '13F-included' });
          role(o, 'OTHER_INCLUDED_MANAGER', mgr, f.reportPeriod, fr.filingId);
          rel(mgr, 'INCLUDES_OTHER_MANAGER', o, { validFrom: f.reportPeriod }, fr, `Listed as Other Included Manager #${om.sequenceNumber} (13F file no. ${om.form13FFileNumber || 'n/a'}) on the 13F summary page. A reporting link, not proof of ownership or control.`);
        });
        // positions per CUSIP / option flag / share type
        const groups = new Map();
        rec.holdings.forEach((h) => { const k = `${h.cusip}|${h.putCall}|${h.sharesType}`; (groups.get(k) || groups.set(k, []).get(k)).push(h); });
        for (const hs of groups.values()) {
          const h0 = hs[0];
          const sec = secByCusip.get(h0.cusip) || security(h0.cusip, null, h0.titleOfClass, h0.issuerName);
          const iss = sec.issuerEntityId ? entities.find((e) => e.entityId === sec.issuerEntityId) : null;
          const sum = (fn) => hs.reduce((s, h) => s + (fn(h) || 0), 0);
          const disc = {};
          hs.forEach((h) => { disc[h.investmentDiscretion] = (disc[h.investmentDiscretion] || 0) + (h.shares || 0); });
          const pos = {
            positionId: id('P', 5), positionType: '13F', filingId: fr.filingId, reportingEntityId: mgr.entityId, issuerEntityId: iss ? iss.entityId : null,
            issuerNameAsReported: h0.issuerName, securityId: sec.securityId, cusip: h0.cusip, securityClass: h0.titleOfClass, putCall: h0.putCall || '', sharesType: h0.sharesType,
            shares: sum((h) => h.shares), value: sum((h) => h.valueUSD), valueBasis: `13F reported value (${ext.valueUnit || 'USD'}) as of ${f.reportPeriod}; not a market value at the filing date`,
            investmentDiscretion: Object.keys(disc).join('/'), investmentDiscretionDetail: disc,
            votingAuthority: { sole: sum((h) => h.votingAuthority.sole), shared: sum((h) => h.votingAuthority.shared), none: sum((h) => h.votingAuthority.none) },
            beneficialOwnership: null, reportingPeriod: f.reportPeriod, sourceFilingId: fr.filingId, rows: hs.length,
          };
          positions.push(pos); fr.positionCount++;
          if (iss) {
            role(iss, 'ISSUER', null, f.reportPeriod, fr.filingId);
            rel(mgr, 'EXERCISES_INVESTMENT_DISCRETION_OVER', iss, { securityId: sec.securityId, shares: pos.shares, validFrom: f.reportPeriod, positionId: pos.positionId, putCall: pos.putCall, sharesType: pos.sharesType },
              fr, `Form 13F information table: ${hs.length} row(s), investment discretion ${pos.investmentDiscretion}. Reports discretion, not ownership.`);
            if (pos.votingAuthority.sole > 0) rel(mgr, 'HAS_SOLE_VOTING_POWER', iss, { securityId: sec.securityId, shares: pos.votingAuthority.sole, validFrom: f.reportPeriod, basis: '13F voting authority (sole)' }, fr, '13F information table, Voting Authority — Sole.');
            if (pos.votingAuthority.shared > 0) rel(mgr, 'HAS_SHARED_VOTING_POWER', iss, { securityId: sec.securityId, shares: pos.votingAuthority.shared, validFrom: f.reportPeriod, basis: '13F voting authority (shared)' }, fr, '13F information table, Voting Authority — Shared.');
            if (!pos.putCall && pos.sharesType !== 'PRN') role(mgr, 'VOTING_AUTHORITY_HOLDER', iss, f.reportPeriod, fr.filingId);
          }
        }
      } else if (f.formFamily === '13D' || f.formFamily === '13G') {
        const iss = issuerFor(rec);
        const filer = f.filerCik || f.filerName ? entity({ name: f.filerName, cik: f.filerCik, date: f.filingDate }) : null;
        const fr = filingRow(rec, filer, iss);
        if (filer) role(filer, 'FILER', iss, f.filingDate, fr.filingId);
        if (iss) role(iss, 'ISSUER', null, ext.eventDate, fr.filingId);
        const cus = (rec.issuer.cusips || [])[0];
        const sec = cus ? (secByCusip.get(cus) || security(cus, iss, ext.securitiesClassTitle, rec.issuer.name)) : null;
        const persons = ext.reportingPersons.map((p) => {
          // CIK: on the cover page, or the filer's when the name is the filer's (documented in the SEC header)
          const cik = p.cik || (filer && E.sameEntity({ name: p.name }, { name: f.filerName }).same ? f.filerCik : '');
          const hint = (p.typeOfReportingPerson || []).join(',');
          const ent = entity({ name: p.name, cik, date: f.filingDate, hint: 'type:' + hint, jurisdiction: p.citizenshipOrOrganization || null, jurisdictionSource: `${f.formType} cover page (citizenship or place of organization)` });
          fr.reportingPersonEntityIds.push(ent.entityId);
          return { p, ent };
        });
        persons.forEach(({ p, ent }) => {
          role(ent, 'REPORTING_PERSON', iss, ext.eventDate, fr.filingId);
          const pos = {
            positionId: id('P', 5), positionType: '13DG', filingId: fr.filingId, reportingEntityId: ent.entityId, issuerEntityId: iss ? iss.entityId : null,
            issuerNameAsReported: rec.issuer.name, securityId: sec ? sec.securityId : null, cusip: cus || '', securityClass: ext.securitiesClassTitle, shares: p.aggregateAmountOwned, value: null,
            investmentDiscretion: null, votingAuthority: null,
            beneficialOwnership: { aggregateShares: p.aggregateAmountOwned, percentOfClass: p.percentOfClass, soleVotingPower: p.soleVotingPower, sharedVotingPower: p.sharedVotingPower, soleDispositivePower: p.soleDispositivePower, sharedDispositivePower: p.sharedDispositivePower },
            reportingPeriod: ext.eventDate, sourceFilingId: fr.filingId, heuristic: !!p.heuristic,
          };
          positions.push(pos); fr.positionCount++;
          if (!iss) return;
          const conf = p.heuristic ? 'MEDIUM' : 'HIGH';
          const base = { securityId: sec ? sec.securityId : null, validFrom: ext.eventDate, positionId: pos.positionId, confidence: conf };
          const pctNote = p.percentOfClass !== null ? `${p.percentOfClass}% of class (reported by the filer)` : '';
          rel(ent, 'REPORTS_BENEFICIAL_OWNERSHIP_OF', iss, Object.assign({}, base, { shares: p.aggregateAmountOwned, ownershipPercentage: p.percentOfClass, votingPower: { sole: p.soleVotingPower, shared: p.sharedVotingPower }, dispositivePower: { sole: p.soleDispositivePower, shared: p.sharedDispositivePower } }),
            fr, `${f.formType} cover page: aggregate ${p.aggregateAmountOwned ?? 'n/a'} shares, ${pctNote}.`);
          if ((p.aggregateAmountOwned || 0) > 0) {
            role(ent, 'BENEFICIAL_OWNER', iss, ext.eventDate, fr.filingId);
            rel(ent, 'BENEFICIALLY_OWNS', iss, Object.assign({}, base, { shares: p.aggregateAmountOwned, ownershipPercentage: p.percentOfClass }), fr, 'Beneficial ownership under Rule 13d-3 (voting and/or investment power), as reported on the cover page.');
          }
          [['soleVotingPower', 'HAS_SOLE_VOTING_POWER', 'VOTING_AUTHORITY_HOLDER', 'Sole voting power'], ['sharedVotingPower', 'HAS_SHARED_VOTING_POWER', 'VOTING_AUTHORITY_HOLDER', 'Shared voting power'],
            ['soleDispositivePower', 'HAS_SOLE_DISPOSITIVE_POWER', 'DISPOSITIVE_AUTHORITY_HOLDER', 'Sole dispositive power'], ['sharedDispositivePower', 'HAS_SHARED_DISPOSITIVE_POWER', 'DISPOSITIVE_AUTHORITY_HOLDER', 'Shared dispositive power']]
            .forEach(([field, type, rc, label]) => { if ((p[field] || 0) > 0) { rel(ent, type, iss, Object.assign({}, base, { shares: p[field] }), fr, `${label} (cover page): ${p[field]}`); role(ent, rc, iss, ext.eventDate, fr.filingId); } });
          if (filer && filer !== ent) rel(filer, 'FILES_FOR', ent, { validFrom: ext.eventDate }, fr, `${f.formType} submitted by ${f.filerName} naming ${p.name} as a reporting person.`);
        });
        for (let i = 0; i < persons.length; i++) for (let j = i + 1; j < persons.length; j++) {
          rel(persons[i].ent, 'JOINT_REPORTING_PERSON', persons[j].ent, { validFrom: ext.eventDate, relationshipDirection: 'BIDIRECTIONAL' }, fr, 'Both are reporting persons on the same Schedule. Joint filing alone does not establish control.');
          const pi = persons[i].p, pj = persons[j].p;
          if ((pi.sharedVotingPower || pi.sharedDispositivePower) && (pj.sharedVotingPower || pj.sharedDispositivePower)) {
            rel(persons[i].ent, 'SHARED_BENEFICIAL_OWNERSHIP', persons[j].ent, { validFrom: ext.eventDate, relationshipDirection: 'BIDIRECTIONAL', confidence: 'MEDIUM', isInferred: true, evidenceStatus: 'INFERRED' }, fr, 'Both report shared voting or dispositive power on the same Schedule; the shares are likely shared with each other, but the filing does not say with whom exactly.');
          }
        }
      } else if (/^FORM[345]$/.test(f.formFamily)) {
        const iss = issuerFor(rec);
        const owners = (ext.reportingOwners || []).map((o) => ({ o, ent: entity({ name: o.name, cik: o.cik, date: f.filingDate, hint: 'insider' }) }));
        const fr = filingRow(rec, owners[0] && owners[0].ent, iss);
        if (iss) role(iss, 'ISSUER', null, ext.periodOfReport, fr.filingId);
        owners.forEach(({ o, ent }) => {
          fr.reportingPersonEntityIds.push(ent.entityId);
          role(ent, 'FILER', iss, f.filingDate, fr.filingId);
          role(ent, 'REPORTING_PERSON', iss, ext.periodOfReport, fr.filingId);
          if (!iss) return;
          if (o.isDirector) { role(ent, 'DIRECTOR', iss, ext.periodOfReport, fr.filingId); upsertInsider(ent, 'DIRECTOR_OF', iss, fr, ext.periodOfReport, 'Director box checked'); }
          if (o.isOfficer) { role(ent, 'EXECUTIVE_OFFICER', iss, ext.periodOfReport, fr.filingId); upsertInsider(ent, 'OFFICER_OF', iss, fr, ext.periodOfReport, `Officer box checked: ${o.officerTitle || 'title not stated'}`); }
          if (o.isTenPercentOwner || o.isOther) { role(ent, o.isTenPercentOwner ? 'TEN_PERCENT_OWNER' : 'REPORTING_PERSON', iss, ext.periodOfReport, fr.filingId); upsertInsider(ent, 'INSIDER_OF', iss, fr, ext.periodOfReport, o.isTenPercentOwner ? '10% owner box checked' : `Other: ${o.otherText}`); }
        });
        // holdings after the last transaction, per security / direct-indirect / nature (lead owner)
        const lead = owners[0];
        if (lead && iss) rec.ownershipRelationships.filter((x) => x.type === 'DIRECT_OWNERSHIP' || x.type === 'INDIRECT_OWNERSHIP').forEach((x) => {
          const sec = (iss.cusip ? secByCusip.get(iss.cusip.split(', ')[0]) : null);
          const pos = { positionId: id('P', 5), positionType: 'SECTION16', filingId: fr.filingId, reportingEntityId: lead.ent.entityId, issuerEntityId: iss.entityId, issuerNameAsReported: rec.issuer.name, securityId: null, cusip: '', securityClass: x.securityClass, shares: x.shares, value: null, investmentDiscretion: null, votingAuthority: null, beneficialOwnership: null, directIndirect: x.nature, natureOfOwnership: x.natureDetail || '', reportingPeriod: x.asOfDate, sourceFilingId: fr.filingId, jointFiling: owners.length > 1 };
          positions.push(pos); fr.positionCount++;
          upsertOwnership(lead.ent, x.nature === 'indirect' ? 'INDIRECTLY_OWNS' : 'DIRECTLY_OWNS', iss, fr, x, pos, sec);
          role(lead.ent, x.nature === 'indirect' ? 'INDIRECT_OWNER' : 'DIRECT_OWNER', iss, x.asOfDate, fr.filingId);
        });
      }
    }

    // Insider and Section 16 ownership edges: keep the latest per person/issuer (+security/nature)
    function upsertInsider(ent, type, iss, fr, date, text) {
      const k = `${type}|${ent.entityId}|${iss.entityId}`;
      const prev = insiderIdx.get(k);
      if (prev && prev.validFrom >= date) { if (date && date < prev.firstSeen) prev.firstSeen = date; return; }
      if (prev) relationships.splice(relationships.indexOf(prev), 1);
      const r = rel(ent, type, iss, { validFrom: date, firstSeen: prev ? prev.firstSeen : date }, fr, `${fr.formType}: ${text}.`);
      insiderIdx.set(k, r);
    }
    function upsertOwnership(ent, type, iss, fr, x, pos, sec) {
      const k = `${type}|${ent.entityId}|${iss.entityId}|${x.securityClass}|${x.natureDetail || ''}`;
      const prev = insiderIdx.get(k);
      if (prev && prev.validFrom > x.asOfDate) return;
      if (prev) relationships.splice(relationships.indexOf(prev), 1);
      insiderIdx.set(k, rel(ent, type, iss, { shares: x.shares, validFrom: x.asOfDate, directIndirect: x.nature === 'indirect' ? 'INDIRECT' : 'DIRECT', positionId: pos.positionId, securityId: sec ? sec.securityId : null, natureOfOwnership: x.natureDetail || '' },
        fr, `${fr.formType}: ${x.nature} holding of ${x.securityClass} after the last reported transaction${x.natureDetail ? ' — ' + x.natureDetail : ''}. Section 16 holdings are on a pecuniary-interest basis; no % is reported.`));
    }

    // ------------------------------------------------------------ demonstration data: BlackRock's full 13F + 13G/A exhibit
    if (ueim && ueim.blackrock13G) {
      const g = ueim.blackrock13G;
      const parent = entity({ name: g.record.reportingPersons[0].name, cik: g.record.reportingPersons[0].cik });
      const fr = filingByAcc.get(g.record.filing.accessionNumber + '|13G');
      const apple = issuerEnts.get('0000320193');
      g.exhibitA.forEach((s) => {
        const sub = entity({ name: s.name, date: g.record.filing.filingDate, weakName: true, hint: 'subsidiary' });
        role(sub, 'SUBSIDIARY', parent, g.record.extension.eventDate, fr && fr.filingId, 'Schedule 13G Item 7 / Exhibit A');
        role(parent, 'PARENT', null, g.record.extension.eventDate, fr && fr.filingId);
        rel(parent, 'PARENT_OF', sub, { validFrom: g.record.extension.eventDate }, fr, `Exhibit A of ${g.record.filing.formType} ${g.record.filing.accessionNumber}: "Identification and Classification of the Subsidiary Which Acquired the Security Being Reported on by the Parent Holding Company".`);
        rel(sub, 'SUBSIDIARY_OF', parent, { validFrom: g.record.extension.eventDate }, fr, 'Same Exhibit A, read in the other direction.');
        if (apple) rel(sub, 'HOLDS_SECURITIES_OF', apple, { validFrom: g.record.extension.eventDate, shares: null, confidence: 'MEDIUM' }, fr, `Exhibit A names this subsidiary as having acquired Apple common stock reported by the parent. The filing gives no per-subsidiary share count${s.fivePercentOrMore ? '' : ', and does not mark it as holding 5% or more on its own'}.`);
      });
    }
    let fullBlackRock = null;
    if (ueim && ueim.blackrock13F) {
      const b = ueim.blackrock13F;
      const mgr = byCik.get(b.filerCik);
      const fr = [...filingByAcc.values()].find((x) => x.accessionNumber === b.accessionNumber);
      const cols = b.columns;
      fullBlackRock = {
        entityId: mgr ? mgr.entityId : null, filingId: fr ? fr.filingId : null, meta: b,
        positions: b.positions.map((row) => { const o = {}; cols.forEach((c, i) => { o[c] = row[i]; }); const k = b.known[o.cusip]; o.issuerCik = k ? k.cik : ''; o.ticker = k ? k.ticker : ''; o.issuerEntityId = k && issuerEnts.get(k.cik) ? issuerEnts.get(k.cik).entityId : null; return o; }),
      };
    }

    // ------------------------------------------------------------ validity: a later 13D/G in the same chain closes the earlier one
    const chain = new Map();
    const DG_TYPES = ['REPORTS_BENEFICIAL_OWNERSHIP_OF', 'BENEFICIALLY_OWNS', 'HAS_SOLE_VOTING_POWER', 'HAS_SHARED_VOTING_POWER', 'HAS_SOLE_DISPOSITIVE_POWER', 'HAS_SHARED_DISPOSITIVE_POWER'];
    const dgFiling = (r) => { const f = r.sourceFilingId && filings.find((x) => x.filingId === r.sourceFilingId); return f && (f.formFamily === '13D' || f.formFamily === '13G'); };
    // 13D/G chains per type/person/issuer; 13F positions per manager/issuer/CUSIP close at the next quarter
    relationships.filter((r) => (DG_TYPES.includes(r.relationshipType) && dgFiling(r)) || r.relationshipType === 'EXERCISES_INVESTMENT_DISCRETION_OVER').forEach((r) => {
      const k = r.relationshipType + '|' + r.fromEntityId + '|' + r.toEntityId + '|' + (r.securityId || '') + '|' + (r.putCall || '');
      (chain.get(k) || chain.set(k, []).get(k)).push(r);
    });
    for (const list of chain.values()) {
      list.sort((a, b) => ((a.validFrom || a.filingDate) < (b.validFrom || b.filingDate) ? -1 : 1));
      list.forEach((r, i) => { if (list[i + 1]) { r.validTo = list[i + 1].validFrom || list[i + 1].filingDate; r.closedBy = 'Superseded by a later filing in the same chain.'; } });
    }
    // a later filing from the same filer that no longer names a person closes that person's figures
    const ownView = (iss) => SOI.ownership.buildIssuerView(records, iss, {}).beneficial;
    companies.forEach((c) => {
      const b = ownView({ name: c.name, cik: c.cik, cusips: c.cusips, multiClass: c.multiClass });
      b.persons.filter((p) => p.superseded).forEach((p) => {
        const ent = (p.cik && byCik.get(p.cik)) || [...(byName.get(E.tokenKey(p.name)) || [])][0];
        const iss = issuerEnts.get(c.cik);
        if (!ent || !iss) return;
        relationships.filter((r) => r.fromEntityId === ent.entityId && r.toEntityId === iss.entityId && !r.validTo && ['REPORTS_BENEFICIAL_OWNERSHIP_OF', 'BENEFICIALLY_OWNS', 'HAS_SOLE_VOTING_POWER', 'HAS_SHARED_VOTING_POWER', 'HAS_SOLE_DISPOSITIVE_POWER', 'HAS_SHARED_DISPOSITIVE_POWER'].includes(r.relationshipType) && r.sourceFilingId && filings.find((f) => f.filingId === r.sourceFilingId).formFamily !== '13F')
          .forEach((r) => { r.validTo = p.superseded.filingDate; r.closedBy = `Later ${p.superseded.formType} ${p.superseded.accessionNumber} from the same filer no longer names this person.`; });
      });
    });
    // last seen = latest evidence of any role (issuers get dates from the filings about them)
    entityRoles.forEach((r) => { const e = entities.find((x) => x.entityId === r.entityId); if (r.lastEvidence && (!e.lastSeen || r.lastEvidence > e.lastSeen)) e.lastSeen = r.lastEvidence; if (r.validFrom && (!e.firstSeen || r.validFrom < e.firstSeen)) e.firstSeen = r.validFrom; });
    // insider roles: validFrom = first evidence
    relationships.forEach((r) => { if (r.firstSeen) r.validFrom = r.firstSeen; });

    // ------------------------------------------------------------ entity types (with the basis for each), names, status
    const today = input.asOf || new Date().toISOString().slice(0, 10);
    for (const ent of entities) {
      const h = ent.typeHints.join(' ');
      const p = ent.edgarProfile || {};
      if (/listed-company/.test(h) || (p.tickers && p.tickers.length)) { ent.entityType = 'PUBLIC_COMPANY'; ent.entityTypeBasis = 'Has an exchange ticker in its EDGAR company record'; }
      else if (/type:[^ ]*\bIN\b/.test(h)) { ent.entityType = 'INDIVIDUAL'; ent.entityTypeBasis = 'Type of reporting person "IN" on a Schedule 13D/G cover page'; }
      else if (/type:[^ ]*\bPN\b/.test(h)) { ent.entityType = 'PARTNERSHIP'; ent.entityTypeBasis = 'Type of reporting person "PN" on a Schedule 13D/G cover page'; }
      else if (/type:[^ ]*\bIV\b/.test(h)) { ent.entityType = 'FUND'; ent.entityTypeBasis = 'Type of reporting person "IV" (investment company)'; }
      else if (/type:[^ ]*\b(CO|HC|IA|BK|IC|BD)\b/.test(h) || /\b(INC|LLC|CORP|CORPORATION|LTD|LIMITED|S A|AG|B V|N A|PLC|CO)\b/.test(' ' + E.tokens(ent.allNames[0]).join(' ') + ' ') || /,? (Inc|LLC|Ltd|S\.A\.|AG|B\.V\.|Limited|Co\.)/.test(ent.allNames.join(' '))) { ent.entityType = 'COMPANY'; ent.entityTypeBasis = /type:/.test(h) ? 'Type code on a Schedule 13D/G cover page (corporation / holding company / adviser)' : 'Legal-form word in the name (Inc., LLC, Ltd, S.A., …)'; }
      else if (/trust/i.test(ent.allNames.join(' '))) { ent.entityType = 'TRUST'; ent.entityTypeBasis = '"Trust" in the reported name'; }
      else if (/insider/.test(h)) { ent.entityType = 'INDIVIDUAL'; ent.entityTypeBasis = 'Section 16 reporting owner with a personal name (Last First Middle)'; }
      else { ent.entityType = 'OTHER'; ent.entityTypeBasis = 'Not stated in the loaded filings'; }
      ent.legalName = p.name || ent.reportedName || ent.allNames[0] || '';
      ent.otherNames = ent.allNames.filter((n) => n !== ent.legalName);
      ent.createdDate = ent.firstSeen; ent.lastUpdated = ent.lastSeen;
      const age = ent.lastSeen ? (new Date(today) - new Date(ent.lastSeen)) / 86400000 : null;
      ent.entityStatus = age === null ? 'REFERENCE_ONLY' : age <= 400 ? 'ACTIVE_IN_FILINGS' : 'NOT_RECENTLY_REPORTED';
      delete ent.typeHints;
    }
    // same name, different CIK (e.g. two BlackRock legal entities)
    for (const set of byName.values()) {
      const withCik = [...set].filter((e) => e.cik);
      if (withCik.length > 1) withCik.forEach((e) => { e.sameNameOtherCiks = withCik.filter((x) => x !== e).map((x) => ({ entityId: x.entityId, cik: x.cik, legalName: x.legalName })); });
    }
    // Role validity: a role whose last evidence is old gets validTo = last evidence
    entityRoles.forEach((r) => { const age = r.lastEvidence ? (new Date(today) - new Date(r.lastEvidence)) / 86400000 : 0; if (age > 400) r.validTo = r.lastEvidence; });

    const byId = new Map(entities.map((e) => [e.entityId, e]));
    const filingById = new Map(filings.map((f) => [f.filingId, f]));
    return {
      roles: ROLES, relTypes: REL_TYPES, entityTypes: ENTITY_TYPES,
      entities, entityRoles, relationships, filings, securities, positions, fullBlackRock,
      byId, byCik, filingById, records,
      stats: { entities: entities.length, relationships: relationships.length, filings: filings.length, positions: positions.length, securities: securities.length, unresolved: entities.filter((e) => e.resolution === 'UNRESOLVED_NAME').length },
    };
  }

  SOI.ueim = { build, ROLES, REL_TYPES, ENTITY_TYPES };
  if (typeof module !== 'undefined' && module.exports) module.exports = SOI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
