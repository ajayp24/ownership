/*
 * storage.js — local persistence and export/import (browser only).
 *
 *   IndexedDB  "soi-ownership-db"
 *     records : normalized filing records (keyPath recordId)
 *     files   : original uploaded documents as Blobs (keyPath fileId)
 *   localStorage "soi.prefs.*" : UI preferences only
 *
 * Nothing here sends data anywhere. Exports are saved with the File System
 * Access API when the browser supports it, otherwise as a normal download.
 *
 * Note: browsers isolate storage by origin. Pages opened from file:// may or
 * may not share one IndexedDB depending on the browser; serving the project
 * folder locally (see README) makes the parser and the dashboard share data.
 */
(function (g) {
  'use strict';
  const SOI = (g.SOI = g.SOI || {});
  const DB_NAME = 'soi-ownership-db';
  const DB_VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!g.indexedDB) return reject(new Error('IndexedDB is not available in this browser context'));
      const req = g.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('records')) {
          const s = db.createObjectStore('records', { keyPath: 'recordId' });
          s.createIndex('formFamily', 'filing.formFamily');
          s.createIndex('issuerCik', 'issuer.cik');
          s.createIndex('filerCik', 'filing.filerCik');
          s.createIndex('filingDate', 'filing.filingDate');
        }
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'fileId' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      let result;
      Promise.resolve(fn(s)).then((r) => { result = r; });
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('Transaction aborted'));
    });
  }
  const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

  const db = {
    open,
    putRecords: (recs) => tx('records', 'readwrite', (s) => { recs.forEach((r) => s.put(r)); return recs.length; }),
    getRecords: () => tx('records', 'readonly', (s) => reqP(s.getAll())),
    getRecord: (id) => tx('records', 'readonly', (s) => reqP(s.get(id))),
    deleteRecords: (ids) => tx('records', 'readwrite', (s) => { ids.forEach((id) => s.delete(id)); return ids.length; }),
    clearRecords: () => tx('records', 'readwrite', (s) => reqP(s.clear())),
    putFile: (f) => tx('files', 'readwrite', (s) => reqP(s.put(f))),
    getFile: (id) => tx('files', 'readonly', (s) => reqP(s.get(id))),
    listFiles: () => tx('files', 'readonly', (s) => reqP(s.getAll())).then((fs) => fs.map((f) => ({ fileId: f.fileId, name: f.name, size: f.size, type: f.type, uploadedAt: f.uploadedAt, recordIds: f.recordIds }))),
    deleteFile: (id) => tx('files', 'readwrite', (s) => reqP(s.delete(id))),
    clearFiles: () => tx('files', 'readwrite', (s) => reqP(s.clear())),
  };

  // ---------- preferences (localStorage; failures are ignored) ----------
  const prefs = {
    get(key, fallback) {
      try { const v = g.localStorage.getItem('soi.prefs.' + key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
    },
    set(key, value) {
      try { g.localStorage.setItem('soi.prefs.' + key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ }
    },
  };

  // ---------- flattening for CSV / Excel ----------

  function tables(records) {
    const filings = [], holdings = [], persons = [], tx16 = [], rels = [], validation = [], unmapped = [];
    for (const r of records) {
      const f = r.filing, ext = r.extension || {};
      filings.push({
        recordId: r.recordId, formType: f.formType, formFamily: f.formFamily, accessionNumber: f.accessionNumber, filingDate: f.filingDate,
        reportPeriod: f.reportPeriod, eventDate: f.eventDate, isAmendment: f.isAmendment, amendmentType: f.amendmentType,
        filerCik: f.filerCik, filerName: f.filerName, issuerName: r.issuer.name, issuerCik: r.issuer.cik, issuerTicker: r.issuer.ticker,
        issuerCusips: (r.issuer.cusips || []).join(' '), holdingsRows: r.holdings.length, sourceFile: f.sourceFile, sourceUrl: f.sourceUrl,
        sourceFormat: f.sourceFormat, dataOrigin: f.dataOrigin, parser: f.parser, validationStatus: r.validation.status,
        errors: r.validation.errors.length, warnings: r.validation.warnings.length, missing: r.validation.missing.join(' '),
      });
      r.holdings.forEach((h) => holdings.push({
        recordId: r.recordId, accessionNumber: f.accessionNumber, reportPeriod: f.reportPeriod, manager: f.filerName, managerCik: f.filerCik,
        row: h.row, issuerName: h.issuerName, titleOfClass: h.titleOfClass, cusip: h.cusip, figi: h.figi, valueRaw: h.valueRaw,
        valueUnit: ext.valueUnit, valueUSD: h.valueUSD, shares: h.shares, sharesType: h.sharesType, putCall: h.putCall,
        investmentDiscretion: h.investmentDiscretion, otherManagers: h.otherManagers.join(' '),
        votingSole: h.votingAuthority.sole, votingShared: h.votingAuthority.shared, votingNone: h.votingAuthority.none, sourcePath: h.sourcePath,
      }));
      (ext.reportingPersons || []).forEach((p) => persons.push({
        recordId: r.recordId, accessionNumber: f.accessionNumber, formType: f.formType, eventDate: ext.eventDate, issuerName: r.issuer.name,
        issuerCik: r.issuer.cik, reportingPerson: p.name, reportingPersonCik: p.cik, types: (p.typeOfReportingPerson || []).join(' '),
        soleVotingPower: p.soleVotingPower, sharedVotingPower: p.sharedVotingPower, soleDispositivePower: p.soleDispositivePower,
        sharedDispositivePower: p.sharedDispositivePower, aggregateAmountOwned: p.aggregateAmountOwned, percentOfClass: p.percentOfClass,
        heuristic: !!p.heuristic, sourcePath: p.sourcePath,
      }));
      ['nonDerivativeTransactions', 'derivativeTransactions', 'nonDerivativeHoldings', 'derivativeHoldings'].forEach((k) => (ext[k] || []).forEach((t) => tx16.push({
        recordId: r.recordId, accessionNumber: f.accessionNumber, formType: f.formType, issuerName: r.issuer.name, issuerCik: r.issuer.cik,
        reportingOwners: (ext.reportingOwners || []).map((o) => o.name).join('; '), table: t.table, kind: t.kind, securityTitle: t.securityTitle,
        transactionDate: t.transactionDate, code: t.code, codeDescription: t.codeDescription || '', shares: t.shares, pricePerShare: t.pricePerShare,
        acquiredDisposed: t.acquiredDisposed, sharesOwnedFollowing: t.sharesOwnedFollowing, directOrIndirect: t.directOrIndirect,
        natureOfOwnership: t.natureOfOwnership, footnotes: (t.footnoteIds || []).join(' '), sourcePath: t.sourcePath,
      })));
      r.ownershipRelationships.forEach((x) => rels.push({
        recordId: r.recordId, type: x.type, from: x.from.name, fromCik: x.from.cik, to: x.to.name, toCik: x.to.cik, securityClass: x.securityClass || '',
        shares: x.shares ?? '', percentOfClass: x.percentOfClass ?? '', percentBasis: x.percentBasis || '', asOfDate: x.asOfDate, dateBasis: x.dateBasis,
        status: x.status, confidence: x.confidence, accessionNumber: x.evidence.accessionNumber, formType: x.evidence.formType, path: x.evidence.path, note: x.evidence.note,
      }));
      r.validation.errors.forEach((m) => validation.push({ recordId: r.recordId, level: 'error', message: m }));
      r.validation.warnings.forEach((m) => validation.push({ recordId: r.recordId, level: 'warning', message: m }));
      r.validation.missing.forEach((m) => validation.push({ recordId: r.recordId, level: 'missing', message: m }));
      r.unmapped.forEach((u) => unmapped.push({ recordId: r.recordId, path: u.path, value: u.value }));
    }
    return { Filings: filings, Holdings_13F: holdings, ReportingPersons_13DG: persons, Section16_Rows: tx16, Relationships: rels, Validation: validation, Unmapped_Fields: unmapped };
  }

  function toCSV(rows) {
    if (!rows.length) return '';
    const cols = Object.keys(rows[0]);
    const esc = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return [cols.join(',')].concat(rows.map((r) => cols.map((c) => esc(r[c])).join(','))).join('\r\n');
  }

  function bundle(records, meta) {
    return { schema: 'soi.bundle/1.0', exportedAt: new Date().toISOString(), exportedBy: 'SEC Ownership Intelligence', meta: meta || {}, records };
  }

  /** Excel workbook: readable sheets plus a "_records_json" sheet that lets the dashboard re-import losslessly. */
  function toWorkbook(records) {
    const XLSX = g.XLSX;
    if (!XLSX) throw new Error('SheetJS (XLSX) is not loaded');
    const wb = XLSX.utils.book_new();
    const t = tables(records);
    for (const [name, rows] of Object.entries(t)) {
      const ws = rows.length ? XLSX.utils.json_to_sheet(rows) : XLSX.utils.aoa_to_sheet([['(no rows)']]);
      XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
    }
    const chunks = [['recordId', 'chunk', 'json']];
    for (const r of records) {
      const s = JSON.stringify(r);
      for (let i = 0, n = 0; i < s.length; i += 30000, n++) chunks.push([r.recordId, n, s.slice(i, i + 30000)]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(chunks), '_records_json');
    return wb;
  }

  async function saveBlob(blob, suggestedName) {
    if (g.showSaveFilePicker) {
      try {
        const ext = suggestedName.split('.').pop();
        const handle = await g.showSaveFilePicker({ suggestedName, types: [{ description: ext.toUpperCase() + ' file', accept: { [blob.type || 'application/octet-stream']: ['.' + ext] } }] });
        const w = await handle.createWritable();
        await w.write(blob);
        await w.close();
        return 'saved';
      } catch (e) {
        if (e && e.name === 'AbortError') return 'cancelled';
        // fall through to download (e.g. SecurityError on file://)
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = suggestedName;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return 'downloaded';
  }

  const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

  const exporters = {
    json: (records, meta) => saveBlob(new Blob([JSON.stringify(bundle(records, meta), null, 2)], { type: 'application/json' }), `sec-ownership-records-${stamp()}.json`),
    csv: (records, table) => {
      const t = tables(records);
      const name = table || 'Filings';
      return saveBlob(new Blob([toCSV(t[name])], { type: 'text/csv' }), `sec-ownership-${name.toLowerCase()}-${stamp()}.csv`);
    },
    xlsx: (records) => {
      const out = g.XLSX.write(toWorkbook(records), { bookType: 'xlsx', type: 'array' });
      return saveBlob(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `sec-ownership-records-${stamp()}.xlsx`);
    },
    zip: async (records, meta) => {
      if (!g.JSZip) throw new Error('JSZip is not loaded');
      const zip = new g.JSZip();
      zip.file('records.json', JSON.stringify(bundle(records, meta), null, 2));
      const t = tables(records);
      for (const [name, rows] of Object.entries(t)) zip.file(`csv/${name}.csv`, toCSV(rows));
      const recDir = zip.folder('records');
      records.forEach((r) => recDir.file(`${r.recordId.replace(/[^\w.-]+/g, '_')}.json`, JSON.stringify(r, null, 2)));
      zip.file('README.txt', 'Normalized SEC filing records exported by SEC Ownership Intelligence.\nrecords.json can be imported into the dashboard or the parser.\n');
      const blob = await zip.generateAsync({ type: 'blob' });
      return saveBlob(blob, `sec-ownership-records-${stamp()}.zip`);
    },
  };

  /** Import from a .json bundle/array or an .xlsx produced by exporters.xlsx. Returns records[]. */
  async function importFile(file) {
    const name = file.name || '';
    if (/\.xlsx$/i.test(name)) {
      const XLSX = g.XLSX;
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const ws = wb.Sheets._records_json;
      if (!ws) throw new Error('This workbook has no "_records_json" sheet. Only workbooks exported by this tool can be imported.');
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }).slice(1);
      const parts = new Map();
      rows.forEach(([id, n, json]) => { if (!parts.has(id)) parts.set(id, []); parts.get(id)[n] = json; });
      return [...parts.values()].map((p) => JSON.parse(p.join('')));
    }
    const data = JSON.parse(await file.text());
    const recs = Array.isArray(data) ? data : data.records;
    if (!Array.isArray(recs)) throw new Error('JSON does not contain a records array');
    const bad = recs.filter((r) => !r || !r.recordId || !r.filing || !r.issuer || !r.validation);
    if (bad.length) throw new Error(`${bad.length} item(s) are not normalized filing records (missing recordId/filing/issuer/validation)`);
    return recs;
  }

  SOI.storage = { db, prefs, tables, toCSV, bundle, toWorkbook, saveBlob, exporters, importFile };
})(typeof globalThis !== 'undefined' ? globalThis : this);
