/*
 * parser-13g.js — Schedule 13G and 13G/A (structured XML and legacy HTML/TXT).
 * Adds 13G-specific checks: the Rule 13d-1(b)/(c)/(d) basis the filer relies
 * on, Item 3 filer type and the Item 5 "5% or less" exit flag.
 */
(function (g) {
  'use strict';
  const SOI = (g.SOI = g.SOI || {});
  const RULE_LABELS = {
    'Rule 13d-1(b)': 'Qualified institutional investor',
    'Rule 13d-1(c)': 'Passive investor',
    'Rule 13d-1(d)': 'Exempt investor',
  };
  class Parser13G {
    constructor() { this.name = 'Parser13G@1.0'; this.family = '13G'; }
    async parse(input, context) {
      const rec = await SOI.parse13DG('13G', this.name, input, context);
      const ext = rec.extension;
      ext.filerCategories = ext.rulesDesignated.map((r) => RULE_LABELS[r.trim()] || r);
      if (!ext.rulesDesignated.length && ext.format === 'xml') rec.validation.missing.push('extension.rulesDesignated (Rule 13d-1(b)/(c)/(d))');
      return SOI.models.finalizeValidation(rec);
    }
  }
  Parser13G.RULE_LABELS = RULE_LABELS;
  SOI.Parser13G = Parser13G;
  if (typeof module !== 'undefined' && module.exports) module.exports = SOI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
