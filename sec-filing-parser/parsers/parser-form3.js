/*
 * parser-form3.js — Form 3, Initial Statement of Beneficial Ownership.
 * Filed when a person becomes a director, officer or 10% owner. Reports
 * holdings only (no transactions); "noSecuritiesOwned" may be checked.
 */
(function (g) {
  'use strict';
  const SOI = (g.SOI = g.SOI || {});
  class ParserForm3 {
    constructor() { this.name = 'ParserForm3@1.0'; this.family = 'FORM3'; }
    async parse(input, context) {
      const rec = await SOI.parseSection16('FORM3', this.name, input, context);
      const ext = rec.extension;
      if (ext.type === 'SECTION16') {
        if (ext.nonDerivativeTransactions.length || ext.derivativeTransactions.length) {
          rec.validation.warnings.push('Form 3 should report holdings only, but transaction rows were found.');
        }
        if (!ext.noSecuritiesOwned && !ext.nonDerivativeHoldings.length && !ext.derivativeHoldings.length) {
          rec.validation.warnings.push('No holdings reported and "no securities owned" is not checked.');
        }
      }
      return SOI.models.finalizeValidation(rec);
    }
  }
  SOI.ParserForm3 = ParserForm3;
  if (typeof module !== 'undefined' && module.exports) module.exports = SOI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
