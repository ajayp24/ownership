/*
 * parser-form5.js — Form 5, Annual Statement of Changes in Beneficial Ownership.
 * Due within 45 days after the issuer's fiscal year end; reports transactions
 * eligible for deferred reporting and any that should have been reported
 * earlier. Flags "form3HoldingsReported" / "form4TransactionsReported" show
 * late items carried on this Form 5.
 */
(function (g) {
  'use strict';
  const SOI = (g.SOI = g.SOI || {});
  class ParserForm5 {
    constructor() { this.name = 'ParserForm5@1.0'; this.family = 'FORM5'; }
    async parse(input, context) {
      const rec = await SOI.parseSection16('FORM5', this.name, input, context);
      const ext = rec.extension;
      if (ext.type === 'SECTION16') {
        if (ext.form3HoldingsReported) rec.validation.warnings.push('This Form 5 reports holdings that should previously have been reported on Form 3.');
        if (ext.form4TransactionsReported) rec.validation.warnings.push('This Form 5 reports transactions that should previously have been reported on Form 4.');
        ext.nonDerivativeTransactions.concat(ext.derivativeTransactions).forEach((r) => {
          if (r.formType && r.formType !== '5') r.reportedLate = true;
        });
      }
      return SOI.models.finalizeValidation(rec);
    }
  }
  SOI.ParserForm5 = ParserForm5;
  if (typeof module !== 'undefined' && module.exports) module.exports = SOI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
