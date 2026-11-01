/*
 * data-models.js — the normalized record model shared by the parser, the
 * ownership engine, the dashboard and the Node tools.
 *
 * One uploaded/fetched SEC document becomes one "filing record":
 *
 *   {
 *     schema, recordId,
 *     filing:   { formType, formFamily, accessionNumber, filingDate, reportPeriod, ... },
 *     issuer:   { name, cik, ticker, cusips[] },
 *     reportingPersons:   [...],      // who the filing is about / filed by
 *     investmentManagers: [...],      // 13F filing manager + other included managers
 *     holdings: [...],                // 13F information-table rows only
 *     ownershipRelationships: [...],  // every edge carries its own evidence
 *     extension: { type: '13F' | '13DG' | 'SECTION16', ... },   // form-specific detail
 *     sourceRefs: { 'normalized.field': 'xml/element/path' },
 *     unmapped: [ { path, value } ],  // fields the parser did not map (never silently dropped)
 *     validation: { status, errors[], warnings[], missing[] }
 *   }
 *
 * Form-specific data lives in `extension` because 13F, 13D/G and Forms 3/4/5
 * have genuinely different structures; nothing is forced into common fields
 * that do not fit.
 */
(function (g) {
  'use strict';
  const SOI = (g.SOI = g.SOI || {});

  const SCHEMA = 'soi.filing/1.0';

  const FORM_FAMILIES = {
    '13F': { label: 'Form 13F', forms: ['13F-HR', '13F-HR/A'], extension: '13F' },
    '13D': { label: 'Schedule 13D', forms: ['SCHEDULE 13D', 'SCHEDULE 13D/A', 'SC 13D', 'SC 13D/A'], extension: '13DG' },
    '13G': { label: 'Schedule 13G', forms: ['SCHEDULE 13G', 'SCHEDULE 13G/A', 'SC 13G', 'SC 13G/A'], extension: '13DG' },
    FORM3: { label: 'Form 3', forms: ['3', '3/A'], extension: 'SECTION16' },
    FORM4: { label: 'Form 4', forms: ['4', '4/A'], extension: 'SECTION16' },
    FORM5: { label: 'Form 5', forms: ['5', '5/A'], extension: 'SECTION16' },
  };

  /** Form 4/5 transaction codes (Form 4 General Instruction 8). */
  const TRANSACTION_CODES = {
    P: { group: 'General', label: 'Open market or private purchase' },
    S: { group: 'General', label: 'Open market or private sale' },
    V: { group: 'General', label: 'Transaction voluntarily reported earlier than required' },
    A: { group: 'Rule 16b-3', label: 'Grant, award or other acquisition from the issuer' },
    D: { group: 'Rule 16b-3', label: 'Disposition to the issuer' },
    F: { group: 'Rule 16b-3', label: 'Payment of exercise price or tax liability by delivering or withholding securities' },
    I: { group: 'Rule 16b-3', label: 'Discretionary transaction' },
    M: { group: 'Rule 16b-3', label: 'Exercise or conversion of derivative security exempted under Rule 16b-3' },
    C: { group: 'Derivative', label: 'Conversion of derivative security' },
    E: { group: 'Derivative', label: 'Expiration of short derivative position' },
    H: { group: 'Derivative', label: 'Expiration (or cancellation) of long derivative position with value received' },
    O: { group: 'Derivative', label: 'Exercise of out-of-the-money derivative security' },
    X: { group: 'Derivative', label: 'Exercise of in-the-money or at-the-money derivative security' },
    G: { group: 'Other', label: 'Bona fide gift' },
    L: { group: 'Other', label: 'Small acquisition under Rule 16a-6' },
    W: { group: 'Other', label: 'Acquisition or disposition by will or the laws of descent and distribution' },
    Z: { group: 'Other', label: 'Deposit into or withdrawal from voting trust' },
    J: { group: 'Other', label: 'Other acquisition or disposition (described in footnotes)' },
    K: { group: 'Other', label: 'Transaction in equity swap or similar instrument' },
    U: { group: 'Other', label: 'Disposition due to a tender of shares in a change of control transaction' },
  };

  /** Schedule 13D/G cover-page "Type of Reporting Person" codes. */
  const REPORTING_PERSON_TYPES = {
    BD: 'Broker-dealer', BK: 'Bank', IC: 'Insurance company', IV: 'Investment company',
    IA: 'Investment adviser', EP: 'Employee benefit plan or endowment fund',
    HC: 'Parent holding company or control person', SA: 'Savings association',
    CP: 'Church plan', CO: 'Corporation', PN: 'Partnership', IN: 'Individual',
    FI: 'Non-U.S. institution', OO: 'Other',
  };

  /** 13F information-table investment discretion values. */
  const INVESTMENT_DISCRETION = {
    SOLE: 'Sole — the manager alone has investment discretion',
    DFND: 'Defined — shared with an affiliate (e.g. a parent or subsidiary manager)',
    OTR: 'Other — shared with another manager not covered by DFND',
  };

  /**
   * Relationship (edge) types. `ownership` says whether the edge asserts any
   * kind of ownership — a 13F holding edge deliberately does not.
   */
  const RELATIONSHIP_TYPES = {
    REPORTED_13F_HOLDING: { label: '13F reported holding (investment discretion)', ownership: false, color: '#2563eb', style: 'solid' },
    BENEFICIAL_OWNERSHIP: { label: 'Beneficial ownership (Schedule 13D/G)', ownership: true, color: '#dc6b19', style: 'solid' },
    DIRECT_OWNERSHIP: { label: 'Direct ownership (Section 16)', ownership: true, color: '#16a34a', style: 'solid' },
    INDIRECT_OWNERSHIP: { label: 'Indirect ownership (Section 16)', ownership: true, color: '#16a34a', style: 'dashed' },
    INSIDER_ROLE: { label: 'Insider role (director / officer / 10% owner)', ownership: false, color: '#7c3aed', style: 'dotted' },
    JOINT_FILER: { label: 'Joint reporting (same filing)', ownership: false, color: '#64748b', style: 'dashed' },
    OTHER_INCLUDED_MANAGER: { label: 'Other included manager (reported within this 13F)', ownership: false, color: '#0891b2', style: 'dashed' },
    MANAGES: { label: 'Manages (adviser → fund)', ownership: false, color: '#0e7490', style: 'solid' },
    CONTROLS: { label: 'Controls (parent → subsidiary)', ownership: false, color: '#b91c1c', style: 'solid' },
    VOTING_POWER: { label: 'Voting power', ownership: false, color: '#ca8a04', style: 'dotted' },
    FILES_FOR: { label: 'Files on behalf of', ownership: false, color: '#475569', style: 'dotted' },
  };

  const ENTITY_KINDS = {
    issuer: { label: 'Issuer', color: '#0f2b4c', shape: 'round-rectangle' },
    manager: { label: 'Institutional investment manager', color: '#2563eb', shape: 'ellipse' },
    fund: { label: 'Fund', color: '#0891b2', shape: 'ellipse' },
    beneficialOwner: { label: 'Beneficial owner (13D/G reporting person)', color: '#dc6b19', shape: 'diamond' },
    insider: { label: 'Insider (director / officer / 10% owner)', color: '#16a34a', shape: 'round-triangle' },
    entity: { label: 'Other entity (trust, LLC, partnership)', color: '#64748b', shape: 'hexagon' },
    category: { label: 'Category', color: '#94a3b8', shape: 'round-rectangle' },
  };

  // ---------- small normalizers ----------

  function padCik(cik) {
    if (cik === undefined || cik === null || cik === '') return '';
    const digits = String(cik).replace(/\D/g, '');
    return digits ? digits.padStart(10, '0') : '';
  }

  function formatAccession(acc) {
    if (!acc) return '';
    const d = String(acc).replace(/\D/g, '');
    if (d.length !== 18) return String(acc).trim();
    return `${d.slice(0, 10)}-${d.slice(10, 12)}-${d.slice(12)}`;
  }

  /** Accepts MM-DD-YYYY, MM/DD/YYYY, YYYY-MM-DD, YYYYMMDD; returns ISO YYYY-MM-DD or ''. */
  function isoDate(v) {
    if (!v) return '';
    const s = String(v).trim();
    let m;
    if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
    if ((m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/))) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) return `${m[1]}-${m[2]}-${m[3]}`;
    return '';
  }

  /** Parses "1,234.5", "(1,000)", "12.3%"; returns null when not numeric. */
  function toNumber(v) {
    if (v === undefined || v === null) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    let s = String(v).trim();
    if (!s) return null;
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    s = s.replace(/[,$%\s]/g, '');
    if (!/^-?\d*\.?\d+(e[-+]?\d+)?$/i.test(s)) return null;
    const n = Number(s);
    return Number.isFinite(n) ? (neg ? -n : n) : null;
  }

  function cleanName(s) {
    return String(s || '').replace(/\s+/g, ' ').trim();
  }

  function hashString(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }

  function familyForForm(formType) {
    const f = String(formType || '').toUpperCase().trim();
    for (const [fam, meta] of Object.entries(FORM_FAMILIES)) if (meta.forms.includes(f)) return fam;
    if (/^13F-HR/.test(f)) return '13F';
    if (/13D/.test(f)) return '13D';
    if (/13G/.test(f)) return '13G';
    if (/^3(\/A)?$/.test(f)) return 'FORM3';
    if (/^4(\/A)?$/.test(f)) return 'FORM4';
    if (/^5(\/A)?$/.test(f)) return 'FORM5';
    return '';
  }

  function emptyRecord() {
    return {
      schema: SCHEMA,
      recordId: '',
      filing: {
        formType: '', formFamily: '', isAmendment: false, amendmentNumber: null, amendmentType: '',
        accessionNumber: '', filingDate: '', reportPeriod: '', eventDate: '',
        filerCik: '', filerName: '', sourceFile: '', sourceUrl: '', sourceFormat: '',
        documentSchemaVersion: '', parser: '', parsedAt: '',
        dataOrigin: 'user-upload',
      },
      issuer: { name: '', cik: '', ticker: '', cusips: [] },
      reportingPersons: [],
      investmentManagers: [],
      holdings: [],
      ownershipRelationships: [],
      extension: {},
      sourceRefs: {},
      unmapped: [],
      validation: { status: 'unvalidated', errors: [], warnings: [], missing: [] },
    };
  }

  function makeRecordId(rec) {
    const f = rec.filing;
    const key = f.accessionNumber || hashString(`${f.sourceFile}|${f.formType}|${f.filerCik}|${f.reportPeriod}|${rec.holdings.length}`);
    return `${key}#${f.formFamily}#${(f.sourceFile || '').split('/').pop()}`;
  }

  function finalizeValidation(rec) {
    const v = rec.validation;
    v.status = v.errors.length ? 'errors' : v.warnings.length || v.missing.length ? 'warnings' : 'valid';
    return rec;
  }

  /** A relationship always carries its evidence (spec §11). */
  function relationship(rec, type, from, to, props, evidence) {
    const f = rec.filing;
    return Object.assign(
      {
        id: '',
        type,
        from, // { name, cik, kind }
        to,
        status: 'reported', // 'reported' = stated in the filing; 'inferred' = derived by this tool
        confidence: 'high',
        asOfDate: '',
        dateBasis: '',
      },
      props || {},
      {
        evidence: Object.assign(
          {
            formType: f.formType,
            accessionNumber: f.accessionNumber,
            filingDate: f.filingDate,
            reportPeriod: f.reportPeriod,
            sourceUrl: f.sourceUrl,
            sourceFile: f.sourceFile,
            path: '',
            note: '',
          },
          evidence || {}
        ),
      }
    );
  }

  SOI.models = {
    SCHEMA, FORM_FAMILIES, TRANSACTION_CODES, REPORTING_PERSON_TYPES, INVESTMENT_DISCRETION,
    RELATIONSHIP_TYPES, ENTITY_KINDS,
    padCik, formatAccession, isoDate, toNumber, cleanName, hashString, familyForForm,
    emptyRecord, makeRecordId, finalizeValidation, relationship,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = SOI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
