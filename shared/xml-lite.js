/*
 * xml-lite.js — a small, dependency-free XML reader used by every parser.
 *
 * Why not DOMParser? The same parser code must run in the browser, in the
 * Node data-retrieval tool and in the Node unit tests. This reader builds a
 * plain tree that works identically in all three.
 *
 * Every node remembers its path (e.g. "formData/coverPage/filingManager/name")
 * so parsers can record exactly which XML element each value came from.
 */
(function (g) {
  'use strict';
  const SOI = (g.SOI = g.SOI || {});

  const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

  function decodeEntities(s) {
    if (!s || s.indexOf('&') === -1) return s;
    return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      const v = ENTITY[e.toLowerCase()];
      return v === undefined ? m : v;
    });
  }

  function localName(qname) {
    const i = qname.indexOf(':');
    return i === -1 ? qname : qname.slice(i + 1);
  }

  function parseAttrs(src) {
    const attrs = {};
    const re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let m;
    while ((m = re.exec(src))) attrs[m[1]] = decodeEntities(m[3] !== undefined ? m[3] : m[4]);
    return attrs;
  }

  /**
   * Parse an XML string into a tree of
   *   { name, local, attrs, children[], text, parent, path, index }
   * Throws an Error with a line number when the document is not well formed.
   */
  function parse(xml) {
    if (typeof xml !== 'string') throw new Error('XML input must be a string');
    let s = xml.replace(/^﻿/, '');
    const root = { name: '#document', local: '#document', attrs: {}, children: [], text: '', parent: null, path: '', index: 0 };
    let cur = root;
    let i = 0;
    const n = s.length;
    const lineAt = (pos) => s.slice(0, pos).split('\n').length;

    while (i < n) {
      const lt = s.indexOf('<', i);
      if (lt === -1) {
        appendText(cur, s.slice(i));
        break;
      }
      if (lt > i) appendText(cur, s.slice(i, lt));
      if (s.startsWith('<!--', lt)) {
        const end = s.indexOf('-->', lt + 4);
        if (end === -1) throw new Error('Unclosed comment at line ' + lineAt(lt));
        i = end + 3;
        continue;
      }
      if (s.startsWith('<![CDATA[', lt)) {
        const end = s.indexOf(']]>', lt + 9);
        if (end === -1) throw new Error('Unclosed CDATA at line ' + lineAt(lt));
        cur.text += s.slice(lt + 9, end);
        i = end + 3;
        continue;
      }
      if (s.startsWith('<?', lt)) {
        const end = s.indexOf('?>', lt + 2);
        if (end === -1) throw new Error('Unclosed processing instruction at line ' + lineAt(lt));
        i = end + 2;
        continue;
      }
      if (s.startsWith('<!', lt)) {
        // DOCTYPE or similar declaration; skip (handles one level of [ ] subset)
        let end = s.indexOf('>', lt);
        const bracket = s.indexOf('[', lt);
        if (bracket !== -1 && bracket < end) end = s.indexOf(']>', bracket) + 1;
        if (end <= 0) throw new Error('Unclosed declaration at line ' + lineAt(lt));
        i = end + 1;
        continue;
      }
      // find end of tag, respecting quoted attribute values
      let j = lt + 1;
      let quote = null;
      while (j < n) {
        const c = s[j];
        if (quote) {
          if (c === quote) quote = null;
        } else if (c === '"' || c === "'") quote = c;
        else if (c === '>') break;
        j++;
      }
      if (j >= n) throw new Error('Unclosed tag at line ' + lineAt(lt));
      const body = s.slice(lt + 1, j);
      i = j + 1;
      if (body[0] === '/') {
        const name = body.slice(1).trim();
        if (cur === root || cur.name !== name) {
          throw new Error(`Mismatched closing tag </${name}> at line ${lineAt(lt)}; expected </${cur.name}>`);
        }
        cur.text = decodeEntities(cur.text);
        cur = cur.parent;
        continue;
      }
      const selfClosing = body.endsWith('/');
      const inner = selfClosing ? body.slice(0, -1) : body;
      const sp = inner.search(/\s/);
      const name = (sp === -1 ? inner : inner.slice(0, sp)).trim();
      if (!name) throw new Error('Empty tag name at line ' + lineAt(lt));
      const node = {
        name,
        local: localName(name),
        attrs: sp === -1 ? {} : parseAttrs(inner.slice(sp)),
        children: [],
        text: '',
        parent: cur,
        path: '',
        index: 0,
      };
      const siblingsSame = cur.children.filter((c) => c.local === node.local).length;
      node.index = siblingsSame;
      node.path = (cur === root ? '' : cur.path + '/') + node.local + (siblingsSame ? `[${siblingsSame}]` : '');
      cur.children.push(node);
      if (!selfClosing) cur = node;
    }
    if (cur !== root) throw new Error(`Document ended before </${cur.name}> was closed`);
    const top = root.children[0];
    if (!top) throw new Error('No root element found');
    return top;
  }

  function appendText(node, t) {
    if (node.local === '#document') return; // ignore whitespace outside root
    node.text += t;
  }

  // ---------- navigation helpers (all match on local names, ignoring namespace prefixes) ----------

  function child(node, name) {
    if (!node) return null;
    for (const c of node.children) if (c.local === name) return c;
    return null;
  }

  function childrenNamed(node, name) {
    return node ? node.children.filter((c) => c.local === name) : [];
  }

  /** find(node, 'formData/coverPage/name') — follows the first match at each step. */
  function find(node, path) {
    let cur = node;
    for (const part of path.split('/')) {
      if (!part) continue;
      cur = child(cur, part);
      if (!cur) return null;
    }
    return cur;
  }

  /** findAll(node, 'infoTable') — every descendant with that local name. */
  function findAll(node, name, out = []) {
    if (!node) return out;
    for (const c of node.children) {
      if (c.local === name) out.push(c);
      findAll(c, name, out);
    }
    return out;
  }

  function text(node) {
    return node ? node.text.trim() : '';
  }

  /** All leaf elements (no element children) as { node, path, value }. */
  function leaves(node, out = []) {
    if (!node) return out;
    if (!node.children.length) {
      out.push({ node, path: node.path, value: node.text.trim() });
      return out;
    }
    for (const c of node.children) leaves(c, out);
    return out;
  }

  SOI.xml = { parse, child, childrenNamed, find, findAll, text, leaves, decodeEntities, localName };
  if (typeof module !== 'undefined' && module.exports) module.exports = SOI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
