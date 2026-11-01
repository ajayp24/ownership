/* diagrams.js — mini SVG diagrams and Cytoscape styling shared by the views. */
(function (g) {
  'use strict';
  const SOI = (g.SOI = g.SOI || {});
  const M = SOI.models;
  const esc = (s) => SOI.ui.esc(s);

  const dashFor = (style) => (style === 'dashed' ? '6 4' : style === 'dotted' ? '2 3' : '');

  /** Layered left-to-right SVG for concept cards. diagram = { nodes: [[id,label,kind]], edges: [[from,to,label,relType]] } */
  function svgMini(diagram) {
    const nodes = diagram.nodes.map(([id, label, kind]) => ({ id, label, kind, layer: 0 }));
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    for (let pass = 0; pass < nodes.length; pass++) {
      diagram.edges.forEach(([a, b]) => { if (byId[b].layer <= byId[a].layer && byId[a].layer < nodes.length) byId[b].layer = byId[a].layer + 1; });
    }
    const layers = {};
    nodes.forEach((n) => (layers[n.layer] = layers[n.layer] || []).push(n));
    const nl = Object.keys(layers).length;
    const W = 560, colW = W / nl, boxW = Math.min(150, colW - 30), boxH = 38;
    const maxRows = Math.max(...Object.values(layers).map((l) => l.length));
    const H = Math.max(110, maxRows * 70 + 20);
    Object.entries(layers).forEach(([L, list]) => list.forEach((n, i) => { n.x = colW * L + colW / 2; n.y = (H / (list.length + 1)) * (i + 1); }));
    const color = (k) => (M.ENTITY_KINDS[k] || M.ENTITY_KINDS.entity).color;
    let defs = '', edges = '', labels = '';
    const seenPair = {};
    diagram.edges.forEach(([a, b, label, rel], i) => {
      const A = byId[a], B = byId[b];
      const rt = M.RELATIONSHIP_TYPES[rel] || { color: '#64748b', style: 'solid' };
      const pk = [a, b].sort().join('|');
      const off = (seenPair[pk] = (seenPair[pk] || 0) + 1) - 1;
      defs += `<marker id="ah${i}-${rel}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${rt.color}"/></marker>`;
      let x1 = A.x, y1 = A.y, x2 = B.x, y2 = B.y;
      if (A.layer !== B.layer) { x1 += (x2 > x1 ? 1 : -1) * boxW / 2; x2 -= (x2 > x1 ? 1 : -1) * boxW / 2; }
      else { y1 += (y2 > y1 ? 1 : -1) * boxH / 2; y2 -= (y2 > y1 ? 1 : -1) * boxH / 2; }
      const bend = off * 18;
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - bend;
      edges += `<path d="M${x1},${y1} Q${mx},${my - bend} ${x2},${y2}" fill="none" stroke="${rt.color}" stroke-width="2" stroke-dasharray="${dashFor(rt.style)}" marker-end="url(#ah${i}-${rel})"/>`;
      labels += `<text x="${mx}" y="${my - bend - 4}" text-anchor="middle" font-size="11" fill="var(--text-2)" paint-order="stroke" stroke="var(--surface)" stroke-width="3">${esc(label)}</text>`;
    });
    const boxes = nodes.map((n) => `<g><rect x="${n.x - boxW / 2}" y="${n.y - boxH / 2}" width="${boxW}" height="${boxH}" rx="7" fill="var(--surface)" stroke="${color(n.kind)}" stroke-width="2"/><text x="${n.x}" y="${n.y + 4}" text-anchor="middle" font-size="12" font-weight="600" fill="var(--text)">${esc(n.label)}</text></g>`).join('');
    return `<svg class="mini-diagram" viewBox="0 0 ${W} ${H}" role="img" aria-label="Relationship diagram"><defs>${defs}</defs>${edges}${boxes}${labels}</svg>`;
  }

  function cyStyle() {
    const css = SOI.ui.cssVar;
    const text = css('--text') || '#0f1b2d';
    const surface = css('--surface') || '#fff';
    const st = [
      { selector: 'node', style: { label: 'data(label)', 'font-size': 11, color: text, 'text-wrap': 'wrap', 'text-max-width': 150, 'text-valign': 'bottom', 'text-margin-y': 5, 'background-color': '#64748b', width: 26, height: 26, 'border-width': 2, 'border-color': surface, 'text-outline-color': surface, 'text-outline-width': 2 } },
      { selector: 'edge', style: { width: 2, 'curve-style': 'bezier', 'target-arrow-shape': 'triangle', 'arrow-scale': 0.9, 'line-color': '#94a3b8', 'target-arrow-color': '#94a3b8', 'font-size': 10, color: text, 'text-outline-color': surface, 'text-outline-width': 2, 'text-rotation': 'autorotate' } },
      { selector: 'edge[label]', style: { label: 'data(label)' } },
      { selector: '.faded', style: { opacity: 0.12 } },
      { selector: '.hl', style: { 'border-color': '#f59e0b', 'border-width': 4 } },
      { selector: 'node:selected', style: { 'border-color': '#f59e0b', 'border-width': 4 } },
      { selector: 'edge:selected', style: { width: 4 } },
      { selector: 'node[?collapsed]', style: { 'border-style': 'double', 'border-width': 5, 'border-color': '#f59e0b' } },
    ];
    for (const [k, v] of Object.entries(M.ENTITY_KINDS)) {
      st.push({ selector: `node[kind="${k}"]`, style: { 'background-color': v.color, shape: v.shape, width: k === 'issuer' ? 46 : k === 'category' ? 34 : 26, height: k === 'issuer' ? 46 : k === 'category' ? 22 : 26, 'font-weight': k === 'issuer' || k === 'category' ? 700 : 400 } });
    }
    for (const [k, v] of Object.entries(M.RELATIONSHIP_TYPES)) {
      st.push({ selector: `edge[type="${k}"]`, style: { 'line-color': v.color, 'target-arrow-color': v.color, 'line-style': v.style === 'dotted' ? 'dotted' : v.style === 'dashed' ? 'dashed' : 'solid' } });
    }
    st.push({ selector: 'edge[type="CATEGORY"]', style: { 'line-color': '#cbd5e1', 'target-arrow-shape': 'none', width: 1.5 } });
    st.push({ selector: 'node[kind="issuer"]', style: { color: text, 'font-size': 13 } });
    return st;
  }

  function legendHtml(kinds, rels) {
    const k = (kinds || Object.keys(M.ENTITY_KINDS).filter((x) => x !== 'category')).map((key) => {
      const v = M.ENTITY_KINDS[key];
      return `<span><span class="sw" style="background:${v.color};border-radius:${v.shape === 'ellipse' ? '50%' : '3px'}"></span>${esc(v.label)}</span>`;
    }).join('');
    const r = (rels || Object.keys(M.RELATIONSHIP_TYPES)).map((key) => {
      const v = M.RELATIONSHIP_TYPES[key];
      return `<span><span class="ln" style="border-top:3px ${v.style === 'dotted' ? 'dotted' : v.style === 'dashed' ? 'dashed' : 'solid'} ${v.color}"></span>${esc(v.label)}</span>`;
    }).join('');
    return `<div class="legend" style="margin-bottom:6px"><strong class="small">Nodes:</strong> ${k}</div><div class="legend"><strong class="small">Edges:</strong> ${r}</div>`;
  }

  /** Mount an illustrative scenario (from content-learn.js) in a Cytoscape container. */
  function mountScenario(el, sc, enabledTypes) {
    const elements = [];
    sc.nodes.forEach(([id, label, kind]) => elements.push({ data: { id, label, kind } }));
    sc.edges.forEach(([s, t, type, label], i) => { if (!enabledTypes || enabledTypes.has(type)) elements.push({ data: { id: 'e' + i, source: s, target: t, type, label } }); });
    return cytoscape({
      container: el, elements, style: cyStyle(), wheelSensitivity: 0.25,
      layout: { name: 'breadthfirst', directed: true, spacingFactor: 1.35, padding: 30 },
    });
  }

  SOI.diagrams = { svgMini, cyStyle, legendHtml, mountScenario };
})(typeof globalThis !== 'undefined' ? globalThis : this);
