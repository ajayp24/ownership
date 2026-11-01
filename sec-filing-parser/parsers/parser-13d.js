/*
 * parser-13d.js — Schedule 13D and 13D/A (structured XML and legacy HTML/TXT).
 * Shares cover-page logic with Parser13G (parser-13dg-common.js); adds the
 * 13D narrative items: Item 4 (purpose), Item 6 (contracts), Item 7 (exhibits).
 */
(function (g) {
  'use strict';
  const SOI = (g.SOI = g.SOI || {});
  class Parser13D {
    constructor() { this.name = 'Parser13D@1.0'; this.family = '13D'; }
    async parse(input, context) {
      const rec = await SOI.parse13DG('13D', this.name, input, context);
      const ext = rec.extension;
      if (!ext.purposeOfTransaction) rec.validation.missing.push('extension.purposeOfTransaction (Item 4)');
      return SOI.models.finalizeValidation(rec);
    }
  }
  SOI.Parser13D = Parser13D;
  if (typeof module !== 'undefined' && module.exports) module.exports = SOI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
