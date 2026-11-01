/*
 * parser-form4.js — Form 4, Statement of Changes in Beneficial Ownership.
 * Reports transactions (purchases, sales, awards, exercises, gifts, …) and
 * the holdings that follow each transaction.
 */
(function (g) {
  'use strict';
  const SOI = (g.SOI = g.SOI || {});
  class ParserForm4 {
    constructor() { this.name = 'ParserForm4@1.0'; this.family = 'FORM4'; }
    async parse(input, context) {
      const rec = await SOI.parseSection16('FORM4', this.name, input, context);
      const ext = rec.extension;
      if (ext.type === 'SECTION16') {
        if (!ext.nonDerivativeTransactions.length && !ext.derivativeTransactions.length) {
          rec.validation.warnings.push('Form 4 contains no transaction rows (holdings-only Form 4s are unusual).');
        }
        ext.nonDerivativeTransactions.concat(ext.derivativeTransactions).forEach((r, i) => {
          if (!r.code) rec.validation.warnings.push(`Transaction ${i + 1}: transaction code missing`);
          if (!r.transactionDate) rec.validation.warnings.push(`Transaction ${i + 1}: transaction date missing`);
        });
      }
      return SOI.models.finalizeValidation(rec);
    }
  }
  SOI.ParserForm4 = ParserForm4;
  if (typeof module !== 'undefined' && module.exports) module.exports = SOI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
