/*
 * index.js — parser registry and the single entry point used by the apps.
 *
 *   SOI.parsers.detect({ name, text })              -> detection result
 *   SOI.parsers.parse(input, { family?, ...ctx })   -> Promise<record>
 *
 * When `family` is omitted the detector chooses; if detection is ambiguous
 * the promise rejects with err.code === 'AMBIGUOUS' and err.detection, so the
 * UI can ask the user to choose.
 */
(function (g) {
  'use strict';
  const SOI = (g.SOI = g.SOI || {});
  const registry = () => ({
    '13F': new SOI.Parser13F(),
    '13D': new SOI.Parser13D(),
    '13G': new SOI.Parser13G(),
    FORM3: new SOI.ParserForm3(),
    FORM4: new SOI.ParserForm4(),
    FORM5: new SOI.ParserForm5(),
  });

  async function parse(input, context = {}) {
    const PB = SOI.parserBase;
    const doc = await PB.readInput(input);
    let family = context.family;
    const detection = PB.detect(doc);
    if (!family) {
      if (!detection.family || detection.confidence === 'low') {
        const err = new Error('Filing type could not be identified with confidence: ' + detection.reasons.join('; '));
        err.code = 'AMBIGUOUS';
        err.detection = detection;
        throw err;
      }
      family = detection.family;
    }
    const parser = registry()[family];
    if (!parser) throw new Error('No parser for filing type ' + family);
    const rec = await parser.parse(doc, context);
    rec.detection = { detectedFamily: detection.family, usedFamily: family, confidence: detection.confidence, reasons: detection.reasons, chosenByUser: !!context.family && context.family !== detection.family };
    return rec;
  }

  SOI.parsers = { registry, parse, detect: (doc) => SOI.parserBase.detect(doc) };
  if (typeof module !== 'undefined' && module.exports) module.exports = SOI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
