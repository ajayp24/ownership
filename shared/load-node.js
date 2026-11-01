/* Loads the shared modules and all parsers into one SOI namespace for Node (tools and tests). */
const path = require('path');
const root = path.join(__dirname, '..');
[
  'shared/xml-lite.js', 'shared/data-models.js',
  'sec-filing-parser/parsers/parser-base.js', 'sec-filing-parser/parsers/parser-13f.js',
  'sec-filing-parser/parsers/parser-13dg-common.js', 'sec-filing-parser/parsers/parser-13d.js', 'sec-filing-parser/parsers/parser-13g.js',
  'sec-filing-parser/parsers/parser-section16-common.js', 'sec-filing-parser/parsers/parser-form3.js',
  'sec-filing-parser/parsers/parser-form4.js', 'sec-filing-parser/parsers/parser-form5.js',
  'sec-filing-parser/parsers/index.js',
  'shared/entity-resolution.js', 'shared/relationship-engine.js', 'shared/ownership-engine.js',
].forEach((f) => { try { require(path.join(root, f)); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; } });
module.exports = globalThis.SOI;
