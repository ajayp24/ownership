/*
 * parser-13f.js — Form 13F-HR / 13F-HR/A.
 *
 * A 13F filing on EDGAR has two XML documents:
 *   1. primary_doc.xml  — cover page, summary page, signature, other included managers
 *   2. the Information Table — one <infoTable> row per holding
 * Either can be parsed alone; both together (or a full-submission .txt that
 * contains both) give a complete record. CSV information tables are accepted
 * when the header names the standard columns.
 *
 * Units: since 3 January 2023 the Information Table "value" column is in whole
 * US dollars; earlier filings reported thousands of dollars. The parser keeps
 * the raw value and records which unit it applied.
 */
(function (g) {
  'use strict';
  const SOI = (g.SOI = g.SOI || {});
  const NAME = 'Parser13F@1.0';
  const DOLLAR_RULE_DATE = '2023-01-03';

  function bool(s) { return /^(true|y|yes|1)$/i.test(String(s || '').trim()); }

  class Parser13F {
    constructor() { this.name = NAME; this.family = '13F'; }

    async parse(input, context = {}) {
      const PB = SOI.parserBase;
      const doc = await PB.readInput(input);
      const parts = { cover: null, infoTable: null, header: null };

      if (PB.isFullSubmission(doc.text)) {
        const sub = PB.splitFullSubmission(doc.text);
        parts.header = sub.header;
        for (const d of sub.documents) {
          if (!d.isXml) continue;
          if (/INFORMATION TABLE/i.test(d.type) || /<informationTable/i.test(d.text.slice(0, 400))) parts.infoTable = { name: d.filename || 'infotable.xml', text: d.text };
          else if (/^13F/i.test(d.type)) parts.cover = { name: d.filename || 'primary_doc.xml', text: d.text };
        }
      } else {
        const det = PB.detect(doc);
        if (det.role === 'infoTable') parts.infoTable = doc;
        else parts.cover = doc;
      }
      if (context.companion) {
        const comp = await PB.readInput(context.companion);
        const det = PB.detect(comp);
        if (det.role === 'infoTable' && !parts.infoTable) parts.infoTable = comp;
        if (det.role === 'cover' && !parts.cover) parts.cover = comp;
      }
      return this.parseParts(parts, doc, context);
    }

    parseParts(parts, doc, context) {
      const PB = SOI.parserBase, M = SOI.models, X = SOI.xml;
      const rec = PB.baseRecord(doc, '13F', NAME, context);
      const ext = (rec.extension = {
        type: '13F',
        reportType: '', isAmendment: false, amendmentNumber: null, amendmentType: '',
        confidentialTreatment: { isConfidentialOmitted: null, confDeniedExpired: null },
        form13FFileNumber: '', crdNumber: '', secFileNumber: '',
        filingManager: { name: '', address: '' },
        otherIncludedManagers: [],
        summary: { otherIncludedManagersCount: null, tableEntryTotal: null, tableValueTotal: null },
        valueUnit: '', valueUnitReason: '',
        signature: {},
        parts: { cover: !!parts.cover, infoTable: !!parts.infoTable },
        holdingsFilter: null,
      });
      rec.filing.sourceFormat = parts.header ? 'txt-submission' : /\.csv$/i.test(doc.name) ? 'csv' : 'xml';

      if (parts.header) {
        const h = parts.header;
        rec.filing.accessionNumber = rec.filing.accessionNumber || h.accessionNumber;
        rec.filing.filingDate = rec.filing.filingDate || h.filingDate;
        rec.filing.reportPeriod = h.reportPeriod;
        rec.filing.formType = h.formType;
        rec.filing.filerCik = h.filer.cik;
        rec.filing.filerName = h.filer.name;
      }

      if (parts.cover) {
        try { this.parseCover(rec, X.parse(parts.cover.text), parts.cover.name); }
        catch (e) { rec.validation.errors.push(`Cover page (${parts.cover.name}): ${e.message}`); }
      }
      if (parts.infoTable) {
        try {
          if (/\.csv$/i.test(parts.infoTable.name) || PB.detect(parts.infoTable).format === 'csv') this.parseCsv(rec, parts.infoTable);
          else this.parseInfoTable(rec, X.parse(parts.infoTable.text), parts.infoTable.name);
        } catch (e) { rec.validation.errors.push(`Information table (${parts.infoTable.name}): ${e.message}`); }
      }

      this.applyUnits(rec);
      if (context.cusipFilter) this.filterHoldings(rec, context.cusipFilter);
      this.validate(rec);
      rec.recordId = M.makeRecordId(rec);
      return M.finalizeValidation(rec);
    }

    parseCover(rec, root, fileName) {
      const M = SOI.models, X = SOI.xml;
      const t = new SOI.parserBase.FieldTracker(rec, root, fileName + ':');
      const ext = rec.extension;
      rec.filing.documentSchemaVersion = t.take('schemaVersion');
      rec.filing.formType = t.take('headerData/submissionType', null, 'filing.formType') || rec.filing.formType;
      t.take('headerData/filerInfo/liveTestFlag');
      t.takeTree('headerData/filerInfo/filer/credentials/ccc');
      rec.filing.filerCik = M.padCik(t.take('headerData/filerInfo/filer/credentials/cik', null, 'filing.filerCik')) || rec.filing.filerCik;
      const period = M.isoDate(t.take('headerData/filerInfo/periodOfReport', null, 'filing.reportPeriod'));
      const cp = X.find(root, 'formData/coverPage');
      const cal = M.isoDate(t.take('reportCalendarOrQuarter', cp));
      rec.filing.reportPeriod = period || cal || rec.filing.reportPeriod;
      ext.isAmendment = bool(t.take('isAmendment', cp));
      ext.amendmentNumber = M.toNumber(t.take('amendmentNo', cp));
      ext.amendmentType = t.take('amendmentInfo/amendmentType', cp);
      ext.confidentialTreatment.confDeniedExpired = t.take('amendmentInfo/confDeniedExpired', cp) || null;
      ext.filingManager.name = M.cleanName(t.take('filingManager/name', cp, 'filing.filerName'));
      const addr = X.find(cp, 'filingManager/address');
      if (addr) { ext.filingManager.address = addr.children.map((c) => X.text(c)).filter(Boolean).join(', '); t.takeTree(addr); }
      ext.reportType = t.take('reportType', cp);
      ext.form13FFileNumber = t.take('form13FFileNumber', cp);
      ext.crdNumber = t.take('crdNumber', cp);
      ext.secFileNumber = t.take('secFileNumber', cp);
      t.take('provideInfoForInstruction5', cp);
      ext.additionalInformation = t.take('additionalInformation', cp);
      rec.filing.filerName = ext.filingManager.name || rec.filing.filerName;
      rec.filing.isAmendment = ext.isAmendment || /\/A$/.test(rec.filing.formType);
      rec.filing.amendmentNumber = ext.amendmentNumber;
      rec.filing.amendmentType = ext.amendmentType;

      // 13F-NT style "other managers reporting for this manager"
      for (const om of X.findAll(cp || root, 'otherManager')) {
        ext.managersReportingForThisManager = ext.managersReportingForThisManager || [];
        ext.managersReportingForThisManager.push({ name: t.take('name', om), form13FFileNumber: t.take('form13FFileNumber', om), cik: M.padCik(t.take('cik', om)) });
      }

      const sig = X.find(root, 'formData/signatureBlock');
      if (sig) {
        for (const c of sig.children) ext.signature[c.local] = t.take(c);
        if (!rec.filing.filingDate && ext.signature.signatureDate) {
          ext.signatureDateUsedAsFilingDateProxy = true;
        }
      }

      const sp = X.find(root, 'formData/summaryPage');
      if (sp) {
        ext.summary.otherIncludedManagersCount = M.toNumber(t.take('otherIncludedManagersCount', sp));
        ext.summary.tableEntryTotal = M.toNumber(t.take('tableEntryTotal', sp));
        ext.summary.tableValueTotal = M.toNumber(t.take('tableValueTotal', sp));
        ext.confidentialTreatment.isConfidentialOmitted = bool(t.take('isConfidentialOmitted', sp));
        for (const om2 of X.findAll(sp, 'otherManager2')) {
          const om = X.child(om2, 'otherManager');
          const m = {
            sequenceNumber: M.toNumber(t.take('sequenceNumber', om2)),
            name: M.cleanName(t.take('name', om)),
            cik: M.padCik(t.take('cik', om)),
            form13FFileNumber: t.take('form13FFileNumber', om),
            crdNumber: t.take('crdNumber', om),
            secFileNumber: t.take('secFileNumber', om),
            sourcePath: fileName + ':' + om2.path,
          };
          ext.otherIncludedManagers.push(m);
        }
      }

      rec.investmentManagers.push({ role: 'filingManager', name: rec.filing.filerName, cik: rec.filing.filerCik, form13FFileNumber: ext.form13FFileNumber });
      const filer = { name: rec.filing.filerName, cik: rec.filing.filerCik, kind: 'manager' };
      for (const m of ext.otherIncludedManagers) {
        rec.investmentManagers.push(Object.assign({ role: 'otherIncludedManager' }, m));
        rec.ownershipRelationships.push(
          M.relationship(rec, 'OTHER_INCLUDED_MANAGER', filer, { name: m.name, cik: m.cik, kind: 'manager' },
            { asOfDate: rec.filing.reportPeriod, dateBasis: 'reportPeriod', sequenceNumber: m.sequenceNumber },
            { path: m.sourcePath, note: 'Listed on the 13F summary page as an "Other Included Manager" whose holdings are reported in this filing. This shows a reporting relationship, not ownership.' })
        );
      }
      t.collectUnmapped();
    }

    parseInfoTable(rec, root, fileName) {
      const M = SOI.models, X = SOI.xml;
      const t = new SOI.parserBase.FieldTracker(rec, root, fileName + ':');
      const rows = X.childrenNamed(root, 'infoTable');
      rows.forEach((row, i) => {
        const vote = X.child(row, 'votingAuthority');
        const others = X.childrenNamed(row, 'otherManager').map((o) => t.take(o)).join(',');
        const h = {
          row: i + 1,
          issuerName: M.cleanName(t.take('nameOfIssuer', row)),
          titleOfClass: t.take('titleOfClass', row),
          cusip: t.take('cusip', row).toUpperCase(),
          figi: t.take('figi', row),
          valueRaw: M.toNumber(t.take('value', row)),
          valueUSD: null,
          shares: M.toNumber(t.take('shrsOrPrnAmt/sshPrnamt', row)),
          sharesType: t.take('shrsOrPrnAmt/sshPrnamtType', row),
          putCall: t.take('putCall', row),
          investmentDiscretion: t.take('investmentDiscretion', row),
          otherManagers: others ? others.split(/[,\s]+/).filter(Boolean).map(Number) : [],
          votingAuthority: {
            sole: M.toNumber(t.take('Sole', vote)),
            shared: M.toNumber(t.take('Shared', vote)),
            none: M.toNumber(t.take('None', vote)),
          },
          sourcePath: fileName + ':' + row.path,
        };
        rec.holdings.push(h);
      });
      if (!rows.length) rec.validation.errors.push('Information table contains no <infoTable> rows');
      t.collectUnmapped();
    }

    parseCsv(rec, doc) {
      const M = SOI.models;
      const lines = doc.text.split(/\r?\n/).filter((l) => l.trim());
      const split = (line) => {
        const out = []; let cur = '', q = false;
        for (let i = 0; i < line.length; i++) {
          const c = line[i];
          if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
          else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
        }
        out.push(cur); return out.map((s) => s.trim());
      };
      const header = split(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z]/g, ''));
      const col = (...names) => header.findIndex((h) => names.includes(h));
      const idx = {
        issuerName: col('nameofissuer', 'issuer', 'issuername', 'name'),
        titleOfClass: col('titleofclass', 'class', 'securityclass'),
        cusip: col('cusip'),
        value: col('value', 'valueusd', 'marketvalue'),
        shares: col('sshprnamt', 'shares', 'sharesorprincipalamount', 'amount'),
        sharesType: col('sshprnamttype', 'sharestype', 'type'),
        putCall: col('putcall'),
        discretion: col('investmentdiscretion', 'discretion'),
        otherManager: col('othermanager', 'othermanagers'),
        sole: col('sole', 'votingsole', 'votingauthoritysole'),
        shared: col('shared', 'votingshared', 'votingauthorityshared'),
        none: col('none', 'votingnone', 'votingauthoritynone'),
      };
      if (idx.cusip < 0) { rec.validation.errors.push('CSV has no CUSIP column'); return; }
      const known = new Set(Object.values(idx).filter((v) => v >= 0));
      lines.slice(1).forEach((line, i) => {
        const c = split(line);
        const get = (k) => (idx[k] >= 0 ? c[idx[k]] : '');
        rec.holdings.push({
          row: i + 1, issuerName: get('issuerName'), titleOfClass: get('titleOfClass'), cusip: get('cusip').toUpperCase(), figi: '',
          valueRaw: M.toNumber(get('value')), valueUSD: null, shares: M.toNumber(get('shares')), sharesType: get('sharesType') || 'SH',
          putCall: get('putCall'), investmentDiscretion: get('discretion'),
          otherManagers: get('otherManager') ? get('otherManager').split(/[,;\s]+/).filter(Boolean).map(Number) : [],
          votingAuthority: { sole: M.toNumber(get('sole')), shared: M.toNumber(get('shared')), none: M.toNumber(get('none')) },
          sourcePath: `${doc.name}:line ${i + 2}`,
        });
        c.forEach((v, j) => { if (!known.has(j) && v) rec.unmapped.push({ path: `${doc.name}:line ${i + 2}:${header[j]}`, value: v }); });
      });
      rec.validation.warnings.push('CSV input: filing metadata (accession number, filer, period) must come from the cover page or be entered manually.');
    }

    applyUnits(rec) {
      const ext = rec.extension;
      const basisDate = rec.filing.filingDate || ext.signature.signatureDate && SOI.models.isoDate(ext.signature.signatureDate) || '';
      let dollars;
      if (basisDate) {
        dollars = basisDate >= DOLLAR_RULE_DATE;
        ext.valueUnitReason = `${rec.filing.filingDate ? 'Filing date' : 'Signature date'} ${basisDate} is ${dollars ? 'on/after' : 'before'} ${DOLLAR_RULE_DATE}`;
      } else if (rec.filing.reportPeriod) {
        dollars = rec.filing.reportPeriod >= '2022-12-31';
        ext.valueUnitReason = `No filing date; inferred from report period ${rec.filing.reportPeriod}`;
        rec.validation.warnings.push('Value unit (dollars vs thousands) inferred from the report period because the filing date is unknown.');
      } else {
        dollars = true;
        ext.valueUnitReason = 'No filing date or period available; assumed whole dollars (post-2023 format)';
        rec.validation.warnings.push('Value unit could not be determined; assumed whole US dollars.');
      }
      ext.valueUnit = dollars ? 'USD' : 'USD_THOUSANDS';
      for (const h of rec.holdings) h.valueUSD = h.valueRaw === null ? null : dollars ? h.valueRaw : h.valueRaw * 1000;
    }

    /** Used by the SEC retrieval tool to keep only rows for selected issuers. */
    filterHoldings(rec, cusips) {
      const set = new Set(cusips.map((c) => c.toUpperCase()));
      const before = rec.holdings.length;
      const totalValue = rec.holdings.reduce((s, h) => s + (h.valueRaw || 0), 0);
      rec.extension.holdingsFilter = {
        cusips: [...set], rowsInDocument: before, valueTotalInDocument: totalValue,
        note: 'Only information-table rows for the selected CUSIPs were kept. The full filing contains more holdings.',
      };
      rec.holdings = rec.holdings.filter((h) => set.has(h.cusip));
      rec.unmapped = rec.unmapped.filter((u) => !/infoTable/.test(u.path)).slice(0, 50);
    }

    validate(rec) {
      const PB = SOI.parserBase, ext = rec.extension, v = rec.validation;
      PB.requireField(rec, 'filing.accessionNumber', rec.filing.accessionNumber);
      PB.requireField(rec, 'filing.reportPeriod', rec.filing.reportPeriod);
      PB.requireField(rec, 'filing.filerCik', rec.filing.filerCik);
      PB.requireField(rec, 'filing.filerName', rec.filing.filerName);
      if (!rec.filing.filingDate) v.missing.push('filing.filingDate');
      if (!ext.parts.cover) v.warnings.push('Cover page (primary_doc.xml) not supplied: filer, period and amendment details are unknown.');
      if (!ext.parts.infoTable && ext.reportType !== '13F NOTICE') v.warnings.push('Information table not supplied: no holdings were extracted.');
      if (!rec.filing.formType) rec.filing.formType = ext.isAmendment ? '13F-HR/A' : '13F-HR';
      if (ext.parts.cover && ext.parts.infoTable) {
        const n = ext.holdingsFilter ? ext.holdingsFilter.rowsInDocument : rec.holdings.length;
        if (ext.summary.tableEntryTotal !== null && ext.summary.tableEntryTotal !== n) {
          v.warnings.push(`Summary page says ${ext.summary.tableEntryTotal} entries but the information table has ${n} rows.`);
        }
      }
      if (ext.parts.cover && ext.parts.infoTable) {
        const sum = ext.holdingsFilter ? ext.holdingsFilter.valueTotalInDocument : rec.holdings.reduce((s, h) => s + (h.valueRaw || 0), 0);
        if (ext.summary.tableValueTotal !== null && Math.abs(sum - ext.summary.tableValueTotal) > Math.max(5, ext.summary.tableValueTotal * 0.0005)) {
          v.warnings.push(`Summary table value total ${ext.summary.tableValueTotal} differs from the sum of rows ${sum}.`);
        }
      }
      rec.holdings.forEach((h) => {
        if (!/^[0-9A-Z]{9}$/.test(h.cusip)) v.warnings.push(`Row ${h.row}: CUSIP "${h.cusip}" is not 9 characters`);
        if (h.shares === null) v.warnings.push(`Row ${h.row}: shares/principal amount missing`);
        if (h.investmentDiscretion && !SOI.models.INVESTMENT_DISCRETION[h.investmentDiscretion]) v.warnings.push(`Row ${h.row}: unknown investment discretion "${h.investmentDiscretion}"`);
      });
      if (v.warnings.length > 60) { const n = v.warnings.length; v.warnings = v.warnings.slice(0, 60); v.warnings.push(`…and ${n - 60} more warnings`); }
      if (ext.confidentialTreatment.isConfidentialOmitted) v.warnings.push('The filer states that confidential information has been omitted — some positions are not in this public filing.');
    }
  }

  SOI.Parser13F = Parser13F;
  if (typeof module !== 'undefined' && module.exports) module.exports = SOI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
