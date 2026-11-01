/*
 * parser-13dg-common.js — logic shared by Parser13D and Parser13G.
 *
 * Two input generations exist on EDGAR:
 *   - Structured XML (required for Schedules 13D and 13G filed from 18 Dec 2024):
 *     form types "SCHEDULE 13D", "SCHEDULE 13D/A", "SCHEDULE 13G", "SCHEDULE 13G/A".
 *   - Legacy HTML / text documents ("SC 13D", "SC 13G", …). These have no
 *     fixed structure, so values are read with labelled-row heuristics and
 *     every extracted number is flagged as heuristic with low confidence.
 */
(function (g) {
  'use strict';
  const SOI = (g.SOI = g.SOI || {});

  function splitTypes(s) {
    return String(s || '').split(/[\s,;/]+/).map((x) => x.trim().toUpperCase()).filter((x) => /^[A-Z]{2}$/.test(x));
  }

  function baseExtension(schedule) {
    return {
      type: '13DG', schedule, format: '', amendmentNumber: null, securitiesClassTitle: '',
      eventDate: '', rulesDesignated: [], previouslyFiledFlag: null,
      reportingPersons: [], items: {}, signatures: [], heuristic: false,
    };
  }

  async function parse13DG(schedule, parserName, input, context = {}) {
    const PB = SOI.parserBase, M = SOI.models, X = SOI.xml;
    const doc = await PB.readInput(input);
    let header = null, body = doc;
    if (PB.isFullSubmission(doc.text)) {
      const sub = PB.splitFullSubmission(doc.text);
      header = sub.header;
      const primary = sub.documents.find((d) => d.isXml && /13[DG]/i.test(d.type)) || sub.documents[0];
      if (!primary) throw new Error('Submission contains no documents');
      body = { name: primary.filename || doc.name, text: primary.text };
    }
    const rec = PB.baseRecord(doc, schedule, parserName, context);
    rec.extension = baseExtension(schedule);
    if (header) {
      rec.filing.accessionNumber = rec.filing.accessionNumber || header.accessionNumber;
      rec.filing.filingDate = rec.filing.filingDate || header.filingDate;
      rec.filing.formType = header.formType;
      rec.filing.filerCik = header.filer.cik;
      rec.filing.filerName = header.filer.name;
      rec.issuer.name = header.subjectCompany.name;
      rec.issuer.cik = header.subjectCompany.cik;
    }
    const det = PB.detect(body);
    try {
      if (det.format === 'xml') parseXml(rec, X.parse(body.text), body.name, schedule);
      else parseLegacy(rec, body, schedule, det.format);
    } catch (e) {
      rec.validation.errors.push(e.message);
    }
    rec.filing.sourceFormat = header ? 'txt-submission' : det.format;
    buildRelationships(rec);
    validate(rec, schedule);
    rec.recordId = M.makeRecordId(rec);
    return M.finalizeValidation(rec);
  }

  // ---------- structured XML ----------

  function parseXml(rec, root, fileName, schedule) {
    const M = SOI.models, X = SOI.xml;
    const t = new SOI.parserBase.FieldTracker(rec, root, fileName + ':');
    const ext = rec.extension;
    ext.format = 'xml';
    const ns = root.attrs.xmlns || '';
    if (schedule === '13D' && /schedule13g/i.test(ns)) rec.validation.warnings.push('Document namespace is Schedule 13G but it is being parsed as 13D.');
    if (schedule === '13G' && /schedule13d/i.test(ns)) rec.validation.warnings.push('Document namespace is Schedule 13D but it is being parsed as 13G.');
    rec.filing.documentSchemaVersion = t.take('schemaVersion');
    rec.filing.formType = t.take('headerData/submissionType', null, 'filing.formType') || rec.filing.formType;
    t.take('headerData/filerInfo/liveTestFlag');
    const credCik = X.findAll(X.find(root, 'headerData'), 'cik')[0];
    rec.filing.filerCik = M.padCik(t.take(credCik, null, 'filing.filerCik')) || rec.filing.filerCik;
    X.findAll(X.find(root, 'headerData'), 'ccc').forEach((n) => t.takeTree(n));
    X.findAll(X.find(root, 'headerData'), 'cik').slice(1).forEach((n) => t.take(n));

    const cph = X.find(root, 'formData/coverPageHeader');
    ext.amendmentNumber = M.toNumber(t.take('amendmentNo', cph));
    ext.securitiesClassTitle = t.take('securitiesClassTitle', cph, 'extension.securitiesClassTitle');
    ext.eventDate = M.isoDate(t.take('eventDateRequiresFilingThisStatement', cph) || t.take('dateOfEvent', cph));
    const pf = t.take('previouslyFiledFlag', cph);
    ext.previouslyFiledFlag = pf ? /^(true|y)/i.test(pf) : null;
    const ii = X.child(cph, 'issuerInfo');
    rec.issuer.cik = M.padCik(t.take('issuerCik', ii, 'issuer.cik') || t.take('issuerCIK', ii, 'issuer.cik')) || rec.issuer.cik;
    rec.issuer.name = M.cleanName(t.take('issuerName', ii, 'issuer.name')) || rec.issuer.name;
    const cusips = X.findAll(ii, 'issuerCusipNumber').concat(X.findAll(ii, 'issuerCUSIP'));
    rec.issuer.cusips = cusips.map((c) => t.take(c).toUpperCase()).filter(Boolean);
    const addr = X.child(ii, 'issuerPrincipalExecutiveOfficeAddress') || X.child(ii, 'address');
    if (addr) { rec.issuer.address = addr.children.map((c) => X.text(c)).filter(Boolean).join(', '); t.takeTree(addr); }
    ext.rulesDesignated = X.findAll(cph, 'designateRulePursuantThisScheduleFiled').map((n) => t.take(n));
    const auth = X.child(cph, 'authorizedPersons');
    if (auth) { ext.authorizedPersons = X.findAll(auth, 'personName').map((n) => X.text(n)); t.takeTree(auth); }

    // Reporting persons: 13G uses coverPageHeaderReportingPersonDetails, 13D uses reportingPersons/reportingPersonInfo
    const rpNodes = X.findAll(X.find(root, 'formData'), 'coverPageHeaderReportingPersonDetails')
      .concat(X.findAll(X.find(root, 'formData/reportingPersons'), 'reportingPersonInfo'));
    rpNodes.forEach((n, i) => {
      const pick = (...names) => { for (const nm of names) { const c = X.findAll(n, nm)[0]; if (c) return t.take(c, null, `extension.reportingPersons[${i}].${names[0]}`); } return ''; };
      const p = {
        name: M.cleanName(pick('reportingPersonName')),
        cik: M.padCik(pick('reportingPersonCIK', 'reportingPersonCik')),
        noCik: /^y/i.test(pick('reportingPersonNoCIK')),
        memberOfGroup: pick('memberOfGroup', 'memberGroup'),
        sourceOfFunds: pick('fundType'),
        citizenshipOrOrganization: pick('citizenshipOrOrganization'),
        soleVotingPower: M.toNumber(pick('soleVotingPower')),
        sharedVotingPower: M.toNumber(pick('sharedVotingPower')),
        soleDispositivePower: M.toNumber(pick('soleDispositivePower')),
        sharedDispositivePower: M.toNumber(pick('sharedDispositivePower')),
        aggregateAmountOwned: M.toNumber(pick('reportingPersonBeneficiallyOwnedAggregateNumberOfShares', 'aggregateAmountOwned')),
        aggregateExcludesCertainShares: /^y/i.test(pick('isAggregateExcludeShares')),
        percentOfClass: M.toNumber(pick('classPercent', 'percentOfClass')),
        typeOfReportingPerson: splitTypes(X.findAll(n, 'typeOfReportingPerson').map((c) => t.take(c)).join(',')),
        comments: pick('comments', 'commentContent'),
        sourcePath: fileName + ':' + n.path,
      };
      ext.reportingPersons.push(p);
    });

    // Items: keep every item's text fields verbatim, keyed by element name
    const itemsRoot = X.find(root, 'formData/items') || X.find(root, 'formData/items1To7');
    if (itemsRoot) {
      for (const item of itemsRoot.children) {
        const fields = {};
        for (const leaf of X.leaves(item)) {
          const key = leaf.path.slice(item.path.length + 1) || item.local;
          fields[key] = t.take(leaf.node);
        }
        ext.items[item.local] = fields;
      }
    }
    // 13G-specific: Item 3 type of person filing, Item 5 "5% or less" exit flag
    const it3 = ext.items.item3 || {};
    if (it3.typeOfPersonFiling) ext.item3TypeOfPersonFiling = splitTypes(it3.typeOfPersonFiling);
    const it5 = ext.items.item5 || {};
    if (it5.classOwnership5PercentOrLess) ext.ownershipFiveOrLess = /^y/i.test(it5.classOwnership5PercentOrLess);
    // 13D-specific narrative items surfaced for the UI
    const it4 = ext.items.item4 || {};
    if (it4.transactionPurpose) ext.purposeOfTransaction = it4.transactionPurpose;
    const it6 = ext.items.item6 || {};
    if (it6.contractDescription) ext.contractsArrangements = it6.contractDescription;
    const it7 = ext.items.item7 || {};
    if (it7.filedExhibits) ext.exhibits = it7.filedExhibits;
    if (schedule === '13G' && it7.subsidiaryIdentification) ext.subsidiaryIdentification = it7.subsidiaryIdentification;

    const sigRoot = X.find(root, 'formData/signatureInformation') || X.find(root, 'formData/signatureInfo');
    if (sigRoot) {
      for (const sd of X.findAll(sigRoot, 'signatureDetails')) {
        ext.signatures.push({ signature: X.text(X.child(sd, 'signature')), title: X.text(X.child(sd, 'title')), date: SOI.models.isoDate(X.text(X.child(sd, 'date'))) });
      }
      t.takeTree(sigRoot);
    }
    rec.filing.isAmendment = /\/A$/.test(rec.filing.formType);
    rec.filing.amendmentNumber = ext.amendmentNumber;
    rec.filing.eventDate = ext.eventDate;
    rec.filing.reportPeriod = ext.eventDate;
    if (!rec.filing.filerName) {
      const match = ext.reportingPersons.find((p) => p.cik && p.cik === rec.filing.filerCik);
      rec.filing.filerName = (match || ext.reportingPersons[0] || {}).name || '';
    }
    t.collectUnmapped();
  }

  // ---------- legacy HTML / text ----------

  /** Label in any case ("TYPE OF REPORTING PERSON" / "Type of reporting person"), codes in capitals (HC, IA, IN…). */
  function typeCodes(text) {
    const m = /type of reporting person\s*(?:\(see instructions\))?\s*[:.]?\s*/i.exec(text);
    if (!m) return '';
    return (/^((?:[A-Z]{2}\b[\s,;]*)+)/.exec(text.slice(m.index + m[0].length)) || [])[1] || '';
  }

  function num(re, s) {
    const m = re.exec(s);
    if (!m) return null;
    if (/^-?0-?$|^none$|^nil$/i.test(m[1].trim())) return 0;
    return SOI.models.toNumber(m[1]);
  }

  function parseLegacy(rec, doc, schedule, format) {
    const M = SOI.models, PB = SOI.parserBase;
    const ext = rec.extension;
    ext.format = format;
    ext.heuristic = true;
    const plain = format === 'html' ? PB.stripHtml(doc.text) : doc.text;
    const flat = plain.replace(/[ \t ]+/g, ' ');
    rec.filing.formType = rec.filing.formType || (/AMENDMENT\s+NO\.?\s*\d+/i.test(flat.slice(0, 5000)) ? `SC ${schedule}/A` : `SC ${schedule}`);
    const amend = /AMENDMENT\s+NO\.?\s*:?\s*(\d+)/i.exec(flat.slice(0, 6000));
    ext.amendmentNumber = amend ? Number(amend[1]) : null;
    // The value printed on the line(s) just above a parenthesised cover label, e.g. "Apple Inc. / (Name of Issuer)"
    // Item 2 style ("(d) Title of Class of Securities / Common Stock") has the value after the label instead.
    const meaningful = (l) => /[A-Za-z0-9]{3,}/.test(l) && !/^\(.*\)$/.test(l) && !/^(page|of \d+ pages|cusip)/i.test(l);
    const before = (label) => {
      const i = flat.search(new RegExp('\\(\\s*' + label + '[^)]*\\)', 'i'));
      if (i >= 0) {
        const lines = flat.slice(Math.max(0, i - 400), i).split('\n').map((l) => l.replace(/[_]+/g, ' ').trim());
        for (let k = lines.length - 1; k >= 0; k--) if (meaningful(lines[k])) return lines[k];
      }
      const j = flat.search(new RegExp(label, 'i'));
      if (j < 0) return '';
      const after = flat.slice(j).split('\n').slice(1, 5).map((l) => l.trim());
      return after.find(meaningful) || '';
    };
    rec.issuer.name = rec.issuer.name || M.cleanName(before('Name of Issuer'));
    ext.securitiesClassTitle = M.cleanName(before('Title of Class of Securities'));
    const cusip = /CUSIP\s*(?:No\.?|Number)?\s*[:.]?\s*([0-9A-Z]{6}\s?[0-9A-Z]{2}\s?[0-9A-Z])\b/i.exec(flat) || /([0-9A-Z]{6}\s?[0-9A-Z]{2}\s?[0-9])\s*\n?\s*\(CUSIP/i.exec(flat);
    if (cusip) rec.issuer.cusips = [cusip[1].replace(/\s/g, '').toUpperCase()];
    ext.eventDate = M.isoDate(before('Date of Event').replace(/^.*?(\w+ \d{1,2},? \d{4}|\d{1,2}\/\d{1,2}\/\d{4}).*$/, '$1')) || dateWords(before('Date of Event'));
    rec.filing.eventDate = ext.eventDate;
    rec.filing.reportPeriod = ext.eventDate;

    const chunks = flat.split(/NAMES?\s+OF\s+REPORTING\s+PERSONS?/i).slice(1);
    chunks.forEach((c, i) => {
      const lines = c.split('\n').map((l) => l.replace(/I\.?R\.?S\.?\s+IDENTIFICATION.*$/i, '').replace(/^[\s.:\-–]+/, '').trim()).filter((l) => l && !/^(S\.S\.|OR I\.R\.S|\(ENTITIES ONLY\)|\d+\.?$)/i.test(l));
      const NUM = '((?:-0-|[\\d,]+|none))';
      const c1 = c.replace(/\s+/g, ' '); // labels often wrap across lines
      ext.reportingPersons.push({
        name: M.cleanName(lines[0] || ''),
        cik: '', noCik: true,
        citizenshipOrOrganization: ((/CITIZENSHIP OR PLACE OF ORGANI[SZ]ATION\s*[:.]?\s*\n?\s*([^\n]+)/i.exec(c) || [])[1] || '').trim(),
        soleVotingPower: num(new RegExp('SOLE VOTING POWER[^\\d\\-n]{0,30}' + NUM, 'i'), c1),
        sharedVotingPower: num(new RegExp('SHARED VOTING POWER[^\\d\\-n]{0,30}' + NUM, 'i'), c1),
        soleDispositivePower: num(new RegExp('SOLE DISPOSITIVE POWER[^\\d\\-n]{0,30}' + NUM, 'i'), c1),
        sharedDispositivePower: num(new RegExp('SHARED DISPOSITIVE POWER[^\\d\\-n]{0,30}' + NUM, 'i'), c1),
        aggregateAmountOwned: num(new RegExp('AGGREGATE AMOUNT BENEFICIALLY OWNED BY EACH REPORTING PERSON[^\\d\\-n]{0,30}' + NUM, 'i'), c1),
        percentOfClass: num(/PERCENT OF CLASS REPRESENTED BY AMOUNT IN ROW\s*\(?\s*\d+\s*\)?\s*[:.]?\s*([\d.]+)\s*%?/i, c1),
        typeOfReportingPerson: splitTypes(typeCodes(c1)),
        heuristic: true,
        sourcePath: `${doc.name}: cover page ${i + 1} (text heuristic)`,
      });
    });
    if (schedule === '13D') {
      const item = (n, next) => {
        const m = new RegExp('Item\\s+' + n + '\\.?\\s*([\\s\\S]{0,4000}?)(?=Item\\s+' + next + '\\.?|SIGNATURE|$)', 'i').exec(flat);
        return m ? m[1].trim() : '';
      };
      ext.purposeOfTransaction = item(4, 5);
      ext.contractsArrangements = item(6, 7);
      ext.exhibits = item(7, 8);
    }
    if (!rec.filing.filerName && ext.reportingPersons[0]) rec.filing.filerName = ext.reportingPersons[0].name;
    rec.validation.warnings.push(`Legacy ${format.toUpperCase()} Schedule ${schedule}: values were read with text heuristics. Check every number against the original document.`);
  }

  function dateWords(s) {
    const m = /([A-Z][a-z]+)\s+(\d{1,2}),?\s+(\d{4})/.exec(s || '');
    if (!m) return '';
    const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    const mi = months.indexOf(m[1].toLowerCase());
    return mi < 0 ? '' : `${m[3]}-${String(mi + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }

  // ---------- relationships + validation ----------

  function buildRelationships(rec) {
    const M = SOI.models, ext = rec.extension;
    const issuer = { name: rec.issuer.name, cik: rec.issuer.cik, kind: 'issuer' };
    const persons = ext.reportingPersons;
    rec.reportingPersons = persons.map((p) => ({
      name: p.name, cik: p.cik, role: 'reportingPerson', types: p.typeOfReportingPerson,
      typeLabels: (p.typeOfReportingPerson || []).map((x) => M.REPORTING_PERSON_TYPES[x] || x),
    }));
    persons.forEach((p) => {
      rec.ownershipRelationships.push(M.relationship(rec, 'BENEFICIAL_OWNERSHIP',
        { name: p.name, cik: p.cik, kind: 'beneficialOwner' }, issuer,
        {
          securityClass: ext.securitiesClassTitle,
          shares: p.aggregateAmountOwned,
          percentOfClass: p.percentOfClass,
          percentBasis: 'reported',
          votingPower: { sole: p.soleVotingPower, shared: p.sharedVotingPower },
          dispositivePower: { sole: p.soleDispositivePower, shared: p.sharedDispositivePower },
          asOfDate: ext.eventDate, dateBasis: 'eventDate',
          status: 'reported',
          confidence: p.heuristic ? 'low' : 'high',
          jointFiling: persons.length > 1,
        },
        { path: p.sourcePath, note: persons.length > 1 ? `One of ${persons.length} reporting persons in a joint filing. Amounts can overlap between reporting persons and must not be added together.` : 'Cover-page amount reported by this reporting person.' }));
    });
    if (persons.length > 1) {
      const lead = persons[0];
      persons.slice(1).forEach((p) => {
        rec.ownershipRelationships.push(M.relationship(rec, 'JOINT_FILER',
          { name: lead.name, cik: lead.cik, kind: 'beneficialOwner' }, { name: p.name, cik: p.cik, kind: 'beneficialOwner' },
          { asOfDate: ext.eventDate, dateBasis: 'eventDate', memberOfGroup: p.memberOfGroup || '' },
          { path: p.sourcePath, note: 'Both persons are reporting persons on the same Schedule. Joint filing alone does not prove control or a group; see Items 2, 4, 6 and 8.' }));
      });
    }
  }

  function validate(rec, schedule) {
    const PB = SOI.parserBase, v = rec.validation, ext = rec.extension;
    PB.requireField(rec, 'filing.accessionNumber', rec.filing.accessionNumber);
    PB.requireField(rec, 'filing.filingDate', rec.filing.filingDate);
    PB.requireField(rec, 'issuer.name', rec.issuer.name);
    PB.requireField(rec, 'issuer.cik', rec.issuer.cik);
    PB.requireField(rec, 'issuer.cusips', rec.issuer.cusips.length ? 'ok' : '');
    PB.requireField(rec, 'extension.eventDate', ext.eventDate);
    if (!ext.reportingPersons.length) v.errors.push('No reporting persons found');
    ext.reportingPersons.forEach((p, i) => {
      if (!p.name) v.warnings.push(`Reporting person ${i + 1}: name missing`);
      if (p.aggregateAmountOwned === null) v.warnings.push(`Reporting person ${i + 1}: aggregate amount not found`);
      if (p.percentOfClass === null) v.warnings.push(`Reporting person ${i + 1}: percent of class not found`);
      const sumVote = (p.soleVotingPower || 0) + (p.sharedVotingPower || 0);
      if (p.aggregateAmountOwned !== null && sumVote > p.aggregateAmountOwned * 1.0001 && !p.heuristic) {
        v.warnings.push(`Reporting person ${i + 1}: sole + shared voting power exceeds the aggregate amount`);
      }
    });
    if (!rec.filing.formType) rec.filing.formType = `SCHEDULE ${schedule}`;
    if (schedule === '13G' && ext.ownershipFiveOrLess) {
      v.warnings.push('Item 5 is checked: the reporting person states it now owns 5% or less of the class (an "exit" amendment).');
    }
  }

  SOI.parse13DG = parse13DG;
  if (typeof module !== 'undefined' && module.exports) module.exports = SOI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
