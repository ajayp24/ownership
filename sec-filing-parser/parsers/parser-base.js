/*
 * parser-base.js — shared plumbing for every filing parser:
 *   - reading input (browser File, Blob or { name, text })
 *   - splitting an EDGAR full-submission .txt into its documents and header
 *   - filing-type detection
 *   - field-consumption tracking so unmapped XML fields are reported, not dropped
 *
 * Every parser implements:  parse(input, context?) -> Promise<normalized record>
 * `context` may carry metadata the document itself does not contain
 * (accessionNumber, filingDate, sourceUrl, ticker, dataOrigin).
 */
(function (g) {
  'use strict';
  const SOI = (g.SOI = g.SOI || {});
  const X = () => SOI.xml;
  const M = () => SOI.models;

  async function readInput(input) {
    if (input && typeof input.text === 'string') return { name: input.name || 'document', text: input.text };
    if (input && typeof input.text === 'function') return { name: input.name || 'document', text: await input.text() };
    if (typeof input === 'string') return { name: 'document', text: input };
    throw new Error('Unsupported input: expected a File, Blob or { name, text }');
  }

  // ---------- EDGAR full submission (.txt) ----------

  function isFullSubmission(text) {
    return /<SEC-DOCUMENT>|<SEC-HEADER>|<IMS-HEADER>/.test(text.slice(0, 5000)) ||
      (/<DOCUMENT>/.test(text) && /<TYPE>/.test(text));
  }

  function parseSecHeader(text) {
    const h = {};
    const m = text.match(/<(SEC|IMS)-HEADER>([\s\S]*?)<\/(SEC|IMS)-HEADER>/);
    const block = m ? m[2] : text.slice(0, 4000);
    const grab = (label) => {
      const r = new RegExp('^\\s*' + label + ':\\s*(.+)$', 'mi').exec(block);
      return r ? r[1].trim() : '';
    };
    h.accessionNumber = M().formatAccession(grab('ACCESSION NUMBER'));
    h.formType = grab('CONFORMED SUBMISSION TYPE');
    h.filingDate = M().isoDate(grab('FILED AS OF DATE'));
    h.reportPeriod = M().isoDate(grab('CONFORMED PERIOD OF REPORT'));
    // Subject company (issuer) and filer sections, when present
    const section = (name) => {
      const r = new RegExp(name + ':([\\s\\S]*?)(?=\\n[A-Z][A-Z -]+:\\s*\\n|$)').exec(block);
      return r ? r[1] : '';
    };
    const nameIn = (s) => ((/COMPANY CONFORMED NAME:\s*(.+)/.exec(s) || [])[1] || '').trim();
    const cikIn = (s) => ((/CENTRAL INDEX KEY:\s*(\d+)/.exec(s) || [])[1] || '').trim();
    const subj = section('SUBJECT COMPANY');
    const filer = section('FILER') || section('FILED BY') || section('REPORTING-OWNER');
    h.subjectCompany = { name: nameIn(subj), cik: M().padCik(cikIn(subj)) };
    h.filer = { name: nameIn(filer), cik: M().padCik(cikIn(filer)) };
    return h;
  }

  function splitFullSubmission(text) {
    const header = parseSecHeader(text);
    const documents = [];
    const re = /<DOCUMENT>([\s\S]*?)<\/DOCUMENT>/g;
    let m;
    while ((m = re.exec(text))) {
      const body = m[1];
      const tag = (t) => ((new RegExp('<' + t + '>([^\\n<]*)').exec(body) || [])[1] || '').trim();
      const textBlock = (/<TEXT>([\s\S]*?)<\/TEXT>/.exec(body) || [])[1] || '';
      const xml = (/<XML>([\s\S]*?)<\/XML>/i.exec(textBlock) || [])[1];
      documents.push({
        type: tag('TYPE'),
        sequence: tag('SEQUENCE'),
        filename: tag('FILENAME'),
        description: tag('DESCRIPTION'),
        text: (xml !== undefined ? xml : textBlock).trim(),
        isXml: xml !== undefined,
      });
    }
    return { header, documents };
  }

  // ---------- detection ----------

  function stripHtml(html) {
    return X().decodeEntities(
      html
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d|table)>/gi, '\n')
        .replace(/<\/t[dh]>/gi, '\t')
        .replace(/<[^>]+>/g, ' ')
    )
      .replace(/ /g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n+/g, '\n');
  }

  /**
   * detect({ name, text }) -> { family, formType, role, format, confidence, reasons[], candidates[] }
   * family: '13F' | '13D' | '13G' | 'FORM3' | 'FORM4' | 'FORM5' | '' (unknown)
   * role (13F only): 'cover' | 'infoTable' | 'combined'
   */
  function detect(doc) {
    const name = doc.name || '';
    const text = doc.text || '';
    const head = text.slice(0, 20000);
    const out = { family: '', formType: '', role: 'primary', format: '', confidence: 'low', reasons: [], candidates: [] };

    if (isFullSubmission(text)) {
      const sub = splitFullSubmission(text);
      // A single EDGAR <DOCUMENT> (no SEC header) still names its type in <TYPE>
      const formType = sub.header.formType || (sub.documents[0] || {}).type || '';
      const fam = M().familyForForm(formType);
      out.format = 'txt-submission';
      out.formType = formType;
      out.family = fam;
      out.confidence = fam ? (sub.header.formType ? 'high' : 'medium') : 'low';
      out.role = fam === '13F' ? 'combined' : 'primary';
      out.reasons.push(sub.header.formType ? `EDGAR submission header says CONFORMED SUBMISSION TYPE: ${formType}` : `EDGAR document wrapper says <TYPE>${formType || '(missing)'}`);
      return out;
    }

    const trimmed = head.replace(/^﻿/, '').trimStart();
    if (trimmed.startsWith('<?xml') || /^<[A-Za-z][\w:.-]*[\s>]/.test(trimmed) && !/<html/i.test(head.slice(0, 500))) {
      out.format = 'xml';
      let root;
      try {
        root = X().parse(text);
      } catch (e) {
        out.reasons.push('XML is not well formed: ' + e.message);
        return out;
      }
      const ns = root.attrs.xmlns || '';
      if (root.local === 'informationTable') {
        Object.assign(out, { family: '13F', formType: '13F-HR', role: 'infoTable', confidence: 'high' });
        out.reasons.push('Root element <informationTable> is the Form 13F Information Table');
        return out;
      }
      if (root.local === 'ownershipDocument') {
        const dt = X().text(X().child(root, 'documentType'));
        const fam = M().familyForForm(dt);
        Object.assign(out, { family: fam, formType: dt, confidence: fam ? 'high' : 'low' });
        out.reasons.push(`Root <ownershipDocument> with <documentType>${dt}</documentType> (Section 16 insider report)`);
        return out;
      }
      if (root.local === 'edgarSubmission') {
        const st = X().text(X().find(root, 'headerData/submissionType'));
        let fam = M().familyForForm(st);
        if (!fam && /thirteenf/i.test(ns)) fam = '13F';
        if (!fam && /schedule13g/i.test(ns)) fam = '13G';
        if (!fam && /schedule13d/i.test(ns)) fam = '13D';
        Object.assign(out, { family: fam, formType: st, role: fam === '13F' ? 'cover' : 'primary', confidence: fam ? 'high' : 'low' });
        out.reasons.push(`Root <edgarSubmission> (namespace ${ns || 'none'}) with submissionType "${st || '(missing)'}"`);
        return out;
      }
      out.reasons.push(`Unrecognised XML root element <${root.local}>`);
      return out;
    }

    if (/\.csv$/i.test(name) || /^[^\n<]*cusip[^\n]*,/i.test(trimmed.split('\n')[0] || '')) {
      out.format = 'csv';
      const hdr = (trimmed.split('\n')[0] || '').toLowerCase();
      if (/cusip/.test(hdr) && /(value|shares|sshprnamt)/.test(hdr)) {
        Object.assign(out, { family: '13F', formType: '13F-HR', role: 'infoTable', confidence: 'medium' });
        out.reasons.push('CSV header has CUSIP and value/shares columns, matching a 13F information table');
      } else out.reasons.push('CSV header does not match a supported layout');
      return out;
    }

    // HTML or plain text (legacy Schedule 13D/G, or rendered forms)
    const isHtml = /<html|<body|<table|<div/i.test(head);
    out.format = isHtml ? 'html' : 'txt';
    const plain = (isHtml ? stripHtml(head) : head).toUpperCase().replace(/\s+/g, ' ');
    const has13D = /SCHEDULE\s+13D\b/.test(plain);
    const has13G = /SCHEDULE\s+13G\b/.test(plain);
    if (has13D && !has13G) {
      Object.assign(out, { family: '13D', formType: /AMENDMENT NO/.test(plain) ? 'SC 13D/A' : 'SC 13D', confidence: 'medium' });
      out.reasons.push('Text contains "SCHEDULE 13D" (legacy, non-XML format)');
    } else if (has13G && !has13D) {
      Object.assign(out, { family: '13G', formType: /AMENDMENT NO/.test(plain) ? 'SC 13G/A' : 'SC 13G', confidence: 'medium' });
      out.reasons.push('Text contains "SCHEDULE 13G" (legacy, non-XML format)');
    } else if (has13D && has13G) {
      out.candidates = ['13D', '13G'];
      out.reasons.push('Text mentions both Schedule 13D and Schedule 13G — please choose the filing type');
    } else if (/FORM\s+4\b.*STATEMENT OF CHANGES IN BENEFICIAL OWNERSHIP/.test(plain)) {
      out.candidates = ['FORM4'];
      out.reasons.push('Looks like a rendered (HTML) Form 4. Upload the XML version for reliable parsing.');
    } else if (/FORM 13F/.test(plain)) {
      out.candidates = ['13F'];
      out.reasons.push('Looks like a rendered (HTML) Form 13F. Upload the XML information table for reliable parsing.');
    } else {
      out.reasons.push('No filing type markers found');
    }
    return out;
  }

  // ---------- field-consumption tracking ----------

  /**
   * Context wrapper used inside a parser. `take()` marks an XML node as mapped
   * and returns its text; at the end `collectUnmapped()` lists every leaf that
   * was never taken, so unsupported fields are preserved in `record.unmapped`.
   */
  class FieldTracker {
    constructor(rec, root, pathPrefix) {
      this.rec = rec;
      this.root = root;
      this.prefix = pathPrefix || '';
      this.used = new Set();
      this.trees = new Set();
    }
    node(path, base) {
      return path ? X().find(base || this.root, path) : base || this.root;
    }
    take(nodeOrPath, base, refKey) {
      const node = typeof nodeOrPath === 'string' ? this.node(nodeOrPath, base) : nodeOrPath;
      if (!node) return '';
      this.used.add(node);
      if (refKey) this.rec.sourceRefs[refKey] = this.prefix + node.path;
      return X().text(node);
    }
    /** Marks a whole subtree as handled (e.g. a signature block kept verbatim). */
    takeTree(nodeOrPath, base) {
      const node = typeof nodeOrPath === 'string' ? this.node(nodeOrPath, base) : nodeOrPath;
      if (node) this.trees.add(node);
      return node;
    }
    /** Section 16 values look like <x><value>..</value><footnoteId id="F1"/></x>. */
    takeValue(path, base, refKey) {
      const node = this.node(path, base);
      if (!node) return { value: '', footnotes: [] };
      this.trees.add(node);
      const v = X().child(node, 'value');
      const footnotes = X().findAll(node, 'footnoteId').map((f) => f.attrs.id);
      return { value: this.take(v || node, null, refKey), footnotes };
    }
    collectUnmapped() {
      for (const leaf of X().leaves(this.root)) {
        if (this.used.has(leaf.node)) continue;
        let p = leaf.node, covered = false;
        while (p && !covered) { covered = this.trees.has(p); p = p.parent; }
        if (!covered && (leaf.value !== '' || Object.keys(leaf.node.attrs).length)) {
          this.rec.unmapped.push({ path: this.prefix + leaf.path, value: leaf.value || JSON.stringify(leaf.node.attrs) });
        }
      }
    }
  }

  function baseRecord(doc, family, parserName, context) {
    const M_ = M();
    const rec = M_.emptyRecord();
    const ctx = context || {};
    rec.filing.formFamily = family;
    rec.filing.sourceFile = ctx.sourceFile || doc.name || '';
    rec.filing.sourceUrl = ctx.sourceUrl || '';
    rec.filing.parser = parserName;
    rec.filing.parsedAt = ctx.parsedAt || new Date().toISOString();
    rec.filing.dataOrigin = ctx.dataOrigin || 'user-upload';
    rec.filing.accessionNumber = M_.formatAccession(ctx.accessionNumber || guessAccession(doc.name));
    rec.filing.filingDate = M_.isoDate(ctx.filingDate || '');
    if (ctx.ticker) rec.issuer.ticker = ctx.ticker;
    return rec;
  }

  /** EDGAR file names often embed the accession number (0001193125-26-352200.txt). */
  function guessAccession(name) {
    const m = /(\d{10}-\d{2}-\d{6})/.exec(name || '') || /(?:^|\D)(\d{18})(?:\D|$)/.exec(name || '');
    return m ? m[1] : '';
  }

  function requireField(rec, label, value) {
    if (value === '' || value === null || value === undefined) rec.validation.missing.push(label);
  }

  SOI.parserBase = {
    readInput, isFullSubmission, splitFullSubmission, parseSecHeader, detect, stripHtml,
    FieldTracker, baseRecord, guessAccession, requireField,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = SOI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
