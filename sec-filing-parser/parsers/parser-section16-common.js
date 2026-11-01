/*
 * parser-section16-common.js — Forms 3, 4 and 5 share one EDGAR XML schema
 * (<ownershipDocument>). This module reads it; ParserForm3/4/5 add the checks
 * that differ between the forms.
 *
 * Note on terminology: for Section 16 reporting, "beneficial ownership" of a
 * holding generally means a pecuniary interest (Rule 16a-1(a)(2)); whether a
 * person is a 10% owner is decided under the Section 13(d) definition. The
 * normalized record keeps the filer's direct (D) / indirect (I) code and the
 * stated nature of indirect ownership exactly as reported.
 */
(function (g) {
  'use strict';
  const SOI = (g.SOI = g.SOI || {});

  function flag(s) { return /^(1|true|y)$/i.test(String(s || '').trim()); }

  async function parseSection16(expectedFamily, parserName, input, context = {}) {
    const PB = SOI.parserBase, M = SOI.models, X = SOI.xml;
    const doc = await PB.readInput(input);
    let header = null, body = doc;
    if (PB.isFullSubmission(doc.text)) {
      const sub = PB.splitFullSubmission(doc.text);
      header = sub.header;
      const primary = sub.documents.find((d) => d.isXml && /<ownershipDocument/i.test(d.text.slice(0, 2000)));
      if (!primary) throw new Error('Submission has no <ownershipDocument> XML');
      body = { name: primary.filename || doc.name, text: primary.text };
    }
    const rec = PB.baseRecord(doc, expectedFamily, parserName, context);
    if (header) {
      rec.filing.accessionNumber = rec.filing.accessionNumber || header.accessionNumber;
      rec.filing.filingDate = rec.filing.filingDate || header.filingDate;
    }
    rec.filing.sourceFormat = header ? 'txt-submission' : 'xml';
    let root;
    try { root = X.parse(body.text); } catch (e) {
      rec.validation.errors.push('XML is not well formed: ' + e.message);
      rec.recordId = M.makeRecordId(rec);
      return M.finalizeValidation(rec);
    }
    if (root.local !== 'ownershipDocument') {
      rec.validation.errors.push(`Expected <ownershipDocument>, found <${root.local}>. Forms 3/4/5 must be uploaded as EDGAR XML.`);
      rec.recordId = M.makeRecordId(rec);
      return M.finalizeValidation(rec);
    }

    const t = new PB.FieldTracker(rec, root, body.name + ':');
    const ext = (rec.extension = {
      type: 'SECTION16', documentType: '', periodOfReport: '', dateOfOriginalSubmission: '',
      notSubjectToSection16: null, aff10b5One: null, noSecuritiesOwned: null,
      form3HoldingsReported: null, form4TransactionsReported: null,
      reportingOwners: [], nonDerivativeTransactions: [], nonDerivativeHoldings: [],
      derivativeTransactions: [], derivativeHoldings: [], footnotes: {}, remarks: '', signatures: [],
    });
    rec.filing.documentSchemaVersion = t.take('schemaVersion');
    ext.documentType = t.take('documentType', null, 'filing.formType');
    ext.periodOfReport = M.isoDate(t.take('periodOfReport', null, 'filing.reportPeriod'));
    ext.dateOfOriginalSubmission = M.isoDate(t.take('dateOfOriginalSubmission'));
    const opt = (name) => { const n = X.child(root, name); return n ? flag(t.take(n)) : null; };
    ext.notSubjectToSection16 = opt('notSubjectToSection16');
    ext.aff10b5One = opt('aff10b5One');
    ext.noSecuritiesOwned = opt('noSecuritiesOwned');
    ext.form3HoldingsReported = opt('form3HoldingsReported');
    ext.form4TransactionsReported = opt('form4TransactionsReported');

    rec.filing.formType = ext.documentType || (header && header.formType) || '';
    rec.filing.isAmendment = /\/A$/.test(rec.filing.formType);
    rec.filing.reportPeriod = ext.periodOfReport;
    const famFound = M.familyForForm(rec.filing.formType);
    if (famFound && famFound !== expectedFamily) {
      rec.validation.warnings.push(`Document type is ${rec.filing.formType} but it is being parsed as ${M.FORM_FAMILIES[expectedFamily].label}.`);
    }

    const iss = X.child(root, 'issuer');
    rec.issuer.cik = M.padCik(t.take('issuerCik', iss, 'issuer.cik'));
    rec.issuer.name = M.cleanName(t.take('issuerName', iss, 'issuer.name'));
    rec.issuer.ticker = t.take('issuerTradingSymbol', iss, 'issuer.ticker') || rec.issuer.ticker;

    X.childrenNamed(root, 'reportingOwner').forEach((ro, i) => {
      const id = X.child(ro, 'reportingOwnerId');
      const rel = X.child(ro, 'reportingOwnerRelationship');
      const addr = X.child(ro, 'reportingOwnerAddress');
      t.takeTree(X.child(id, 'rptOwnerCcc'));
      const owner = {
        cik: M.padCik(t.take('rptOwnerCik', id, `extension.reportingOwners[${i}].cik`)),
        name: M.cleanName(t.take('rptOwnerName', id, `extension.reportingOwners[${i}].name`)),
        address: addr ? addr.children.map((c) => X.text(c)).filter(Boolean).join(', ') : '',
        isDirector: flag(t.take('isDirector', rel)),
        isOfficer: flag(t.take('isOfficer', rel)),
        isTenPercentOwner: flag(t.take('isTenPercentOwner', rel)),
        isOther: flag(t.take('isOther', rel)),
        officerTitle: t.take('officerTitle', rel),
        otherText: t.take('otherText', rel),
        sourcePath: body.name + ':' + ro.path,
      };
      if (addr) t.takeTree(addr);
      owner.roles = [owner.isDirector && 'Director', owner.isOfficer && (owner.officerTitle || 'Officer'), owner.isTenPercentOwner && '10% owner', owner.isOther && (owner.otherText || 'Other')].filter(Boolean);
      ext.reportingOwners.push(owner);
    });

    const readRow = (row, table, kind) => {
      const coding = X.child(row, 'transactionCoding');
      const amounts = X.child(row, 'transactionAmounts');
      const post = X.child(row, 'postTransactionAmounts');
      const nature = X.child(row, 'ownershipNature');
      const fn = [];
      const v = (path, base) => { if (!base && path.includes('/')) return { value: '', footnotes: [] }; const r = t.takeValue(path, base); fn.push(...r.footnotes); return r.value; };
      const r = {
        table, kind,
        securityTitle: v('securityTitle', row),
        transactionDate: M.isoDate(v('transactionDate', row)),
        deemedExecutionDate: M.isoDate(v('deemedExecutionDate', row)),
        formType: coding ? t.take('transactionFormType', coding) : '',
        code: coding ? t.take('transactionCode', coding) : '',
        equitySwapInvolved: coding ? flag(t.take('equitySwapInvolved', coding)) : null,
        timeliness: v('transactionTimeliness', row),
        shares: M.toNumber(amounts ? v('transactionShares', amounts) : ''),
        totalValue: M.toNumber(amounts ? v('transactionTotalValue', amounts) : ''),
        pricePerShare: M.toNumber(amounts ? v('transactionPricePerShare', amounts) : ''),
        acquiredDisposed: amounts ? v('transactionAcquiredDisposedCode', amounts) : '',
        sharesOwnedFollowing: M.toNumber(post ? v('sharesOwnedFollowingTransaction', post) : ''),
        valueOwnedFollowing: M.toNumber(post ? v('valueOwnedFollowingTransaction', post) : ''),
        directOrIndirect: nature ? v('directOrIndirectOwnership', nature) : '',
        natureOfOwnership: nature ? v('natureOfOwnership', nature) : '',
        sourcePath: body.name + ':' + row.path,
      };
      if (coding) X.findAll(coding, 'footnoteId').forEach((f) => fn.push(f.attrs.id));
      if (table === 'derivative') {
        r.conversionOrExercisePrice = M.toNumber(v('conversionOrExercisePrice', row));
        r.exerciseDate = M.isoDate(v('exerciseDate', row)) || v('exerciseDate', row);
        r.expirationDate = M.isoDate(v('expirationDate', row)) || v('expirationDate', row);
        const u = X.child(row, 'underlyingSecurity');
        r.underlyingSecurityTitle = u ? v('underlyingSecurityTitle', u) : '';
        r.underlyingShares = M.toNumber(u ? v('underlyingSecurityShares', u) : '');
        r.underlyingValue = M.toNumber(u ? v('underlyingSecurityValue', u) : '');
      }
      if (r.code) r.codeDescription = (M.TRANSACTION_CODES[r.code] || {}).label || 'Unknown code';
      r.footnoteIds = [...new Set(fn.filter(Boolean))];
      return r;
    };
    const ndt = X.child(root, 'nonDerivativeTable');
    const dt = X.child(root, 'derivativeTable');
    ext.nonDerivativeTransactions = X.childrenNamed(ndt, 'nonDerivativeTransaction').map((r) => readRow(r, 'nonDerivative', 'transaction'));
    ext.nonDerivativeHoldings = X.childrenNamed(ndt, 'nonDerivativeHolding').map((r) => readRow(r, 'nonDerivative', 'holding'));
    ext.derivativeTransactions = X.childrenNamed(dt, 'derivativeTransaction').map((r) => readRow(r, 'derivative', 'transaction'));
    ext.derivativeHoldings = X.childrenNamed(dt, 'derivativeHolding').map((r) => readRow(r, 'derivative', 'holding'));

    for (const f of X.findAll(X.child(root, 'footnotes'), 'footnote')) ext.footnotes[f.attrs.id] = t.take(f);
    ext.remarks = t.take('remarks');
    for (const s of X.childrenNamed(root, 'ownerSignature')) {
      ext.signatures.push({ name: t.take('signatureName', s), date: M.isoDate(t.take('signatureDate', s)) });
    }
    t.collectUnmapped();

    rec.reportingPersons = ext.reportingOwners.map((o) => ({ name: o.name, cik: o.cik, role: 'reportingOwner', roles: o.roles, officerTitle: o.officerTitle }));
    rec.filing.filerCik = (ext.reportingOwners[0] || {}).cik || '';
    rec.filing.filerName = ext.reportingOwners.map((o) => o.name).join('; ');
    buildRelationships(rec);
    validateCommon(rec);
    rec.recordId = M.makeRecordId(rec);
    return rec;
  }

  function buildRelationships(rec) {
    const M = SOI.models, ext = rec.extension;
    const issuer = { name: rec.issuer.name, cik: rec.issuer.cik, kind: 'issuer' };
    const owners = ext.reportingOwners;
    const joint = owners.length > 1;
    owners.forEach((o) => {
      rec.ownershipRelationships.push(M.relationship(rec, 'INSIDER_ROLE', { name: o.name, cik: o.cik, kind: 'insider' }, issuer,
        { roles: o.roles, asOfDate: ext.periodOfReport, dateBasis: 'periodOfReport' },
        { path: o.sourcePath, note: 'Relationship to issuer as checked in the reportingOwnerRelationship box.' }));
    });
    // Post-transaction holdings: last reported figure per security + direct/indirect + nature
    const rows = ext.nonDerivativeTransactions.concat(ext.nonDerivativeHoldings).filter((r) => r.sharesOwnedFollowing !== null);
    const latest = new Map();
    rows.forEach((r) => {
      const key = `${r.securityTitle}|${r.directOrIndirect}|${r.natureOfOwnership}`;
      const prev = latest.get(key);
      if (!prev || (r.transactionDate || '') >= (prev.transactionDate || '')) latest.set(key, r);
    });
    const lead = owners[0] || { name: '', cik: '' };
    for (const r of latest.values()) {
      const indirect = r.directOrIndirect === 'I';
      rec.ownershipRelationships.push(M.relationship(rec, indirect ? 'INDIRECT_OWNERSHIP' : 'DIRECT_OWNERSHIP',
        { name: lead.name, cik: lead.cik, kind: 'insider' }, issuer,
        {
          securityClass: r.securityTitle, shares: r.sharesOwnedFollowing, percentOfClass: null, percentBasis: 'not-reported',
          nature: indirect ? 'indirect' : 'direct', natureDetail: r.natureOfOwnership,
          asOfDate: r.transactionDate || ext.periodOfReport, dateBasis: r.transactionDate ? 'transactionDate' : 'periodOfReport',
          jointFiling: joint,
        },
        { path: r.sourcePath, note: (indirect ? `Indirect holding (${r.natureOfOwnership || 'nature not stated'}). ` : 'Direct holding. ') + (joint ? 'Joint filing: the figure is reported for all listed reporting owners together.' : '') + ' Forms 3/4/5 do not report a percentage of class.' }));
    }
  }

  function validateCommon(rec) {
    const PB = SOI.parserBase, v = rec.validation, ext = rec.extension, M = SOI.models;
    PB.requireField(rec, 'filing.accessionNumber', rec.filing.accessionNumber);
    PB.requireField(rec, 'filing.filingDate', rec.filing.filingDate);
    PB.requireField(rec, 'issuer.cik', rec.issuer.cik);
    PB.requireField(rec, 'issuer.name', rec.issuer.name);
    PB.requireField(rec, 'extension.periodOfReport', ext.periodOfReport);
    if (!ext.reportingOwners.length) v.errors.push('No reporting owner found');
    ext.reportingOwners.forEach((o, i) => { if (!o.roles.length) v.warnings.push(`Reporting owner ${i + 1}: no relationship box is checked`); });
    const all = ext.nonDerivativeTransactions.concat(ext.derivativeTransactions);
    all.forEach((r, i) => {
      if (r.code && !M.TRANSACTION_CODES[r.code]) v.warnings.push(`Transaction ${i + 1}: unknown transaction code "${r.code}"`);
      if (r.acquiredDisposed && !/^[AD]$/.test(r.acquiredDisposed)) v.warnings.push(`Transaction ${i + 1}: acquired/disposed code "${r.acquiredDisposed}" is not A or D`);
      if (r.directOrIndirect && !/^[DI]$/.test(r.directOrIndirect)) v.warnings.push(`Transaction ${i + 1}: ownership form "${r.directOrIndirect}" is not D or I`);
      if (r.directOrIndirect === 'I' && !r.natureOfOwnership) v.warnings.push(`Transaction ${i + 1}: indirect ownership without a stated nature`);
    });
    const referenced = new Set(all.concat(ext.nonDerivativeHoldings, ext.derivativeHoldings).flatMap((r) => r.footnoteIds));
    referenced.forEach((id) => { if (!ext.footnotes[id]) v.warnings.push(`Footnote ${id} is referenced but not defined`); });
  }

  SOI.parseSection16 = parseSection16;
  if (typeof module !== 'undefined' && module.exports) module.exports = SOI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
