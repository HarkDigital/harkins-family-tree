/* chart.js: the left-to-right pedigree chart (App.chart).
   The focus sits on the left, parents to the right, then grandparents and so on. Every direct-line person is
   drawn with their sibling group stacked in the same column (a father's siblings above him, a mother's below
   her), the focus's children fill one column to the left (an hourglass) and the focus's spouses sit as slim
   rows right under the focus card.
   Layout is a contour-based tidy tree (no overlaps, compact). Cards are keyed by pid and tweened between
   layouts with one rAF loop that also redraws the connectors, so lines follow the cards as they move.
   Pan and zoom only change the stage transform. */
(() => {
  /* ---------------------------------------------------------------- geometry */
  const G = {
    CW: 240, CH: 64,      // direct-line card
    FW: 280, FH: 80,      // the focus card
    RH: 30, RGAP: 4,      // sibling rows and the gap between them
    SPH: 32,              // spouse rows under the focus card
    BGAP: 6,              // between a card and its sibling block
    COLGAP: 64,           // horizontal gap between generation columns (connectors live here)
    PGAP: 10,             // between a father's and a mother's card
    SGAP: 18,             // between neighbouring subtrees in deeper columns
    KGAP: 10,             // between children cards
    BRACKET: 12,          // sibling bracket, this far right of the column
    MAXSIBS: 4,           // rows shown before "+N more" (the focus and the parents)
    MAXSIBS_DEEP: 2,      // ... and for grandparents and beyond, so the first view stays compact
    CIND: 20,             // cousin rows sit this far in from their parent's row
  };
  const GENS = [3, 4, 5, 6, Infinity];
  const DEFAULT_GENS = 4;                // what a first visit shows, and what Collapse all goes back to
  // touch screens get taller slim rows (and bigger expand tabs), so fingers hit the row they aim for
  const COARSE = window.matchMedia("(pointer: coarse)");
  const EXPW = () => (COARSE.matches ? 42 : 34);       // how far an expand tab reaches past its card
  const ZMIN = 0.25, ZMAX = 2;
  const DUR = 420;                       // card tween
  const GLIDE = 480;                     // camera glide after a refocus
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const colX = d => d < 0 ? -(G.CW + G.COLGAP) : d === 0 ? 0 : G.FW + G.COLGAP + (d - 1) * (G.CW + G.COLGAP);
  const colW = d => d === 0 ? G.FW : G.CW;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;     // ease-in-out cubic
  const easeOut = t => 1 - Math.pow(1 - t, 3);

  /* ---------------------------------------------------------------- state */
  const S = {
    mounted: false,
    host: null, root: null, viewport: null, stage: null, svg: null, edgeLayer: null, hlLayer: null, nodeLayer: null,
    header: null, legend: null, hint: null, tools: {},
    focus: null, pending: null,
    gens: GENS.includes(+store.get("hft.chart.gens")) ? +store.get("hft.chart.gens")
      : store.get("hft.chart.gens") === "all" ? Infinity : DEFAULT_GENS,
    sibs: store.get("hft.chart.sibs") !== "off",
    expanded: new Set(),       // pids whose hidden ancestry is revealed (two more generations)
    groupsAll: store.get("hft.chart.groups") === "all",   // Expand all: every sibling group shows everyone
    openGroups: new Set(),     // sibling groups switched from that: opened ("+6 more"), or folded again under groupsAll
    lines: new Set(),          // legend lines being highlighted
    layout: null,              // the current layout (see layoutChart)
    views: new Map(),          // key -> {el, card, data, g:{x,y,w,h,o}, f, t, leaving}
    edges: new Map(),          // id -> {el, def, leaving}
    cam: { x: 0, y: 0, k: 1 },
    size: { w: 0, h: 0 },
    tween: null, camTween: null, raf: 0, camRaf: 0,
    selected: null, cursor: null, traceKey: null,
    stats: { layoutMs: 0, nodes: 0 },
    interacted: false,
    // "fan": every column packed as close as it can get to the cards it hangs from (see fanOut);
    // "stair": ancestors level with their inner parent; "center": classic midpoint (both contour-based)
    layoutMode: "fan",
  };

  /* ---------------------------------------------------------------- people helpers */
  const person = pid => (pid && P[pid]) || null;
  // birth order; people without a year keep their GEDCOM order after the dated ones
  function birthOrder(ids) {
    return ids.filter(id => P[id]).map((id, i) => ({ id, i, by: isHidden(P[id]) ? null : P[id].by }))
      .sort((a, b) => ((a.by == null) - (b.by == null)) || (a.by - b.by) || (a.i - b.i)).map(o => o.id);
  }
  const marriageYear = fam => {
    const m = /\b(1[5-9]\d\d|20\d\d)\b/.exec((fam && fam.marr) || "");
    return m ? m[1] : "";
  };
  const ordinal = n => {
    const s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };
  function generationLabel(d, focusP) {
    if (d < 0) return "Children";
    if (d === 0) return !focusP ? "In focus" : focusP.id === App.ROOT ? (focusP.rel || "You") : firstName(focusP);
    if (d === 1) return "Parents";
    if (d === 2) return "Grandparents";
    if (d === 3) return "Great-grandparents";
    return `${ordinal(d - 2)} great-grandparents`;
  }
  const lineOf = p => (p && p.line) || "none";
  const spouseWord = p => (p && p.sex === "F" ? "Wife" : p && p.sex === "M" ? "Husband" : "Spouse");

  /* ---------------------------------------------------------------- layout */
  /* Sibling rows for one side of a card, top to bottom. Big groups show the MAXSIBS nearest the card and a
     "+N more" row at the far end. The parents' brothers and sisters (depth 1) bring their children along as
     indented cousin rows right under them, and each cousin brings their husband or wife and their children. */
  function sibRows(ids, side, owner, depth) {
    if (!S.sibs || !ids.length) return [];
    const gkey = `${owner}|${side}`;
    const max = depth >= 3 ? 1 : depth >= 2 ? G.MAXSIBS_DEEP : G.MAXSIBS;
    let rows = ids.map(pid => ({ kind: "sib", pid }));
    if (ids.length > max + 1) {
      const open = S.groupsAll !== S.openGroups.has(gkey);
      const more = { kind: "more", gkey, open, count: ids.length - max, total: ids.length, owner };
      if (side === "above") { if (!open) rows = rows.slice(-max); rows.unshift(more); }
      else { if (!open) rows = rows.slice(0, max); rows.push(more); }
    }
    if (depth === 1) rows = rows.flatMap(r => r.kind === "sib" ? [r, ...cousinRows(r.pid)] : [r]);
    return rows;
  }

  const kidsOf = (fams, seen = []) => {
    const ids = [];
    for (const fam of fams) for (const k of fam.kids || []) if (P[k] && !ids.includes(k) && !seen.includes(k)) ids.push(k);
    return birthOrder(ids);
  };
  /* lvl 1: a cousin; then, one family at a time, the spouse (sp, at the cousin's indent) and that family's
     children (lvl 2, indented once more) */
  function cousinRows(pid) {
    return kidsOf(P[pid].fams || []).flatMap(k => {
      const rows = [{ kind: "cousin", pid: k, lvl: 1 }], seen = [];
      for (const fam of P[k].fams || []) {
        if (fam.spouse && P[fam.spouse]) rows.push({ kind: "cousin", pid: fam.spouse, lvl: 1, sp: true });
        for (const c of kidsOf([fam], seen)) { seen.push(c); rows.push({ kind: "cousin", pid: c, lvl: 2 }); }
      }
      return rows;
    });
  }

  const placeholder = (role, depth) => ({
    ph: true, role, depth, w: colW(depth), h: G.CH, above: [], below: [], spouses: [], contour: [[0, G.CH]],
  });

  /* build(pid, depth, role, budget): one direct-line node and its ancestry.
     budget = generations still to show above this person; 0 means "edge" (an expand button when they have parents).
     Returns {pid, depth, role, w, h, above, below, spouses, father, mother, fy, my, contour, expand}:
     y values are relative to this card's top; contour[k] = [top, bottom] of the subtree in column depth + k. */
  /* direct-line people already placed in this layout: when two lines meet (cousins who married), the second
     card for the same ancestor is drawn without siblings or parents, and says so */
  let drawn = new Set();
  function build(pid, depth, role, budget, path) {
    const p = P[pid];
    const isFocus = role === "focus";
    const repeat = !isFocus && drawn.has(pid);
    drawn.add(pid);
    const n = {
      pid, depth, role, w: colW(depth), h: isFocus ? G.FH : G.CH, repeat,
      above: [], below: [], spouses: [], father: null, mother: null, fy: 0, my: 0, expand: null, contour: null,
    };
    // the sibling group
    const sibs = repeat ? [] : birthOrder((p.sibs || []).filter(id => id !== pid));
    if (isFocus) {
      const by = isHidden(p) ? null : p.by;
      const older = by ? sibs.filter(id => !isHidden(P[id]) && P[id].by && P[id].by < by) : [];
      const younger = sibs.filter(id => !older.includes(id));
      n.above = sibRows(older, "above", pid, depth);
      n.below = sibRows(younger, "below", pid, depth);
      for (const fam of p.fams || []) {
        if (fam.spouse && P[fam.spouse]) n.spouses.push({ kind: "spouse", pid: fam.spouse, fam });
      }
    } else if (role === "father") n.above = sibRows(sibs, "above", pid, depth);
    else n.below = sibRows(sibs, "below", pid, depth);

    // this column's block: rows above, the card, spouse rows, rows below
    const pitch = G.RH + G.RGAP;
    let top = 0;
    if (n.above.length) top = -(G.BGAP + n.above.length * pitch - G.RGAP);
    n.above.forEach((r, i) => { r.y = top + i * pitch; });
    let yb = n.h;
    n.spouses.forEach(r => { r.y = yb; yb += G.SPH; });
    if (n.below.length) {
      yb += n.spouses.length ? G.BGAP + 4 : G.BGAP;
      n.below.forEach((r, i) => { r.y = yb + i * pitch; });
      yb += n.below.length * pitch - G.RGAP;
    }
    n.contour = [[top, yb]];

    // parents
    const fId = !repeat && person(p.father) && !path.has(p.father) ? p.father : null;
    const mId = !repeat && person(p.mother) && !path.has(p.mother) ? p.mother : null;
    const hasParents = !!(fId || mId);
    if (budget <= 0 && hasParents) n.expand = S.expanded.has(pid) ? "less" : "more";
    const show = budget > 0 || S.expanded.has(pid);
    if (show && (hasParents || isFocus)) {
      const nb = budget > 0 ? budget - 1 : 1;
      const sub = (id, r) => {
        if (!id) return placeholder(r, depth + 1);
        path.add(id);
        const out = build(id, depth + 1, r, nb, path);
        path.delete(id);
        return out;
      };
      const F = n.father = sub(fId, "father");
      const M = n.mother = sub(mId, "mother");
      // the smallest offset s (mother top - father top) where the two subtrees clear each other in every column
      let s = -Infinity;
      const shared = Math.min(F.contour.length, M.contour.length);
      for (let k = 0; k < shared; k++) s = Math.max(s, F.contour[k][1] + (k === 0 ? G.PGAP : G.SGAP) - M.contour[k][0]);
      if (isFocus || S.layoutMode === "center") {
        // center this card on the midpoint of the parents' card centers
        n.fy = n.h / 2 - (F.h / 2 + s + M.h / 2) / 2;
      } else if (role === "father") {
        // level with his mother (the inner parent), so each couple stays together near the middle
        n.fy = n.h / 2 - M.h / 2 - s;
      } else {
        // level with her father (the inner parent)
        n.fy = n.h / 2 - F.h / 2;
      }
      n.my = n.fy + s;
      const deep = Math.max(F.contour.length, M.contour.length);
      for (let k = 0; k < deep; k++) {
        const a = F.contour[k], b = M.contour[k];
        n.contour.push([
          Math.min(a ? a[0] + n.fy : Infinity, b ? b[0] + n.my : Infinity),
          Math.max(a ? a[1] + n.fy : -Infinity, b ? b[1] + n.my : -Infinity),
        ]);
      }
    }
    return n;
  }

  /* fanOut(tree): place each generation column as close as possible to the column before it. A father's card
     wants its bottom just above the middle of his child's card and a mother's card her top just below it;
     the blocks (card plus sibling rows) keep their order down the column and may not overlap, and isotonic
     regression (pool adjacent violators) finds the positions nearest to those wishes. The near generations
     stay together around the focus while the wide deep columns fan out, so the parents and the four
     grandparents fit one screen. Sets n.fy / n.my (the parents' card tops relative to n's card top). */
  function fanOut(root) {
    root.ay = 0;
    let col = [root];
    while (col.length) {
      const next = [];
      for (const n of col) for (const c of [n.father, n.mother]) if (c) { c.kid = n; next.push(c); }
      if (!next.length) break;
      // u = y - O turns "no overlap" into "u never decreases down the column"
      let O = 0;
      const pools = [];
      next.forEach((c, i) => {
        if (i) {
          const p = next[i - 1];
          O += p.contour[0][1] + (p.kid === c.kid ? G.PGAP : G.SGAP) - c.contour[0][0];
        }
        const mid = c.kid.ay + c.kid.h / 2;
        const want = c.role === "father" ? mid - G.PGAP / 2 - c.h : mid + G.PGAP / 2;
        let pool = { sum: want - O, cnt: 1, items: [{ c, O }] };
        while (pools.length && pools[pools.length - 1].sum / pools[pools.length - 1].cnt > pool.sum / pool.cnt) {
          const q = pools.pop();
          pool = { sum: q.sum + pool.sum, cnt: q.cnt + pool.cnt, items: q.items.concat(pool.items) };
        }
        pools.push(pool);
      });
      for (const pool of pools) for (const it of pool.items) it.c.ay = pool.sum / pool.cnt + it.O;
      for (const c of next) {
        if (c.role === "father") c.kid.fy = c.ay - c.kid.ay; else c.kid.my = c.ay - c.kid.ay;
      }
      col = next;
    }
  }

  /* layoutChart(focusPid) -> {nodes: Map key -> node, edges: [edge], bounds, focusKey, depths: [min, max]}
     node: {key, pid, kind, x, y, w, h, depth, line, down, owner, of, sp, expand, count, open, gkey, marr, role}
       kind: "focus" | "direct" | "sib" | "cousin" | "more" | "spouse" | "child" | "ph"
       down: the key of the card one step toward the focus (for paths, keyboard ← and animations); a cousin
         row's is its parent's sibling row
       owner: for sibling, cousin, "more" and spouse rows, the direct-line card they belong to
     edge: {id, type: "parent" | "sib" | "cousin" | "kid", a: lower/left key, b: upper/right key, line} */
  function layoutChart(focusPid) {
    const t0 = performance.now();
    const fp = P[focusPid];
    Object.assign(G, COARSE.matches ? { RH: 36, RGAP: 6, SPH: 38 } : { RH: 30, RGAP: 4, SPH: 32 });
    drawn = new Set();
    const tree = build(focusPid, 0, "focus", S.gens, new Set([focusPid]));
    if (S.layoutMode === "fan") fanOut(tree);
    const nodes = new Map(), edges = [];
    const used = new Map();
    const keyFor = base => {
      const n = (used.get(base) || 0) + 1;
      used.set(base, n);
      return n === 1 ? base : `${base}~${n}`;
    };
    let minD = 0, maxD = 0;
    const add = node => { nodes.set(node.key, node); minD = Math.min(minD, node.depth); maxD = Math.max(maxD, node.depth); return node; };

    function place(n, y, downKey, childKey) {
      const x = colX(n.depth);
      let key;
      if (n.ph) {
        key = `ph:${childKey}:${n.role}`;
        add({ key, pid: null, kind: "ph", role: n.role, x, y, w: n.w, h: n.h, depth: n.depth, line: "none", down: downKey });
      } else {
        const p = P[n.pid];
        key = keyFor(n.pid);
        add({
          key, pid: n.pid, kind: n.role === "focus" ? "focus" : "direct", role: n.role, x, y, w: n.w, h: n.h,
          depth: n.depth, line: lineOf(p), down: downKey, expand: n.expand, repeat: n.repeat,
        });
        let sibKey = null, sibPid = null, cKey = null, cPid = null, hang = null;
        const rows = r => {
          if (r.kind === "cousin") {
            // a cousin hangs from the parent's sibling; their spouse sits right under them, and their children
            // hang from the couple's last row
            const rk = keyFor(r.pid), ind = G.CIND * r.lvl;
            const [down, of, from] = r.lvl === 1 && !r.sp ? [sibKey, sibPid, sibKey] : [cKey, cPid, hang];
            add({ key: rk, pid: r.pid, kind: "cousin", x: x + ind, y: y + r.y, w: n.w - ind, h: G.RH, depth: n.depth,
              line: lineOf(P[r.pid]), down, owner: key, of, sp: !!r.sp });
            if (!r.sp) edges.push({ id: `c:${rk}`, type: "cousin", a: rk, b: from, line: lineOf(P[r.pid]) });
            if (r.lvl === 1 && !r.sp) { cKey = rk; cPid = r.pid; }
            if (r.lvl === 1) hang = rk;
          } else if (r.kind === "more") {
            const rk = `more:${r.gkey}`;
            add({ key: rk, pid: null, kind: "more", x, y: y + r.y, w: n.w, h: G.RH, depth: n.depth, line: lineOf(p),
              down: key, owner: key, count: r.count, total: r.total, open: r.open, gkey: r.gkey });
            edges.push({ id: `s:${rk}`, type: "sib", a: rk, b: key, line: lineOf(p) });
          } else {
            const rk = sibKey = keyFor(r.pid);
            sibPid = r.pid;
            add({ key: rk, pid: r.pid, kind: "sib", x, y: y + r.y, w: n.w, h: G.RH, depth: n.depth, line: lineOf(P[r.pid]),
              down: key, owner: key });
            edges.push({ id: `s:${rk}`, type: "sib", a: rk, b: key, line: lineOf(P[r.pid]) });
          }
        };
        n.above.forEach(rows);
        n.below.forEach(rows);
        n.spouses.forEach(r => {
          const sp = P[r.pid];
          const hidden = isHidden(p) || isHidden(sp);
          add({ key: keyFor(r.pid), pid: r.pid, kind: "spouse", x, y: y + r.y, w: n.w, h: G.SPH, depth: n.depth,
            line: lineOf(sp), oline: lineOf(p), down: key, owner: key, marr: hidden ? "" : marriageYear(r.fam) });
        });
      }
      if (downKey) edges.push({ id: `p:${key}`, type: "parent", a: downKey, b: key, line: n.ph ? "none" : lineOf(P[n.pid]) });
      if (n.father) place(n.father, y + n.fy, key, key);
      if (n.mother) place(n.mother, y + n.my, key, key);
      return key;
    }
    const focusKey = place(tree, 0, null, null);

    // the children column, centered on the focus card; slim rows when there are many
    const kidIds = [];
    for (const fam of fp.fams || []) for (const k of fam.kids || []) if (P[k] && !kidIds.includes(k) && k !== focusPid) kidIds.push(k);
    const kids = birthOrder(kidIds);
    if (kids.length) {
      const slim = kids.length > 4;
      const h = slim ? G.RH : G.CH, gap = slim ? G.RGAP : G.KGAP;
      const total = kids.length * h + (kids.length - 1) * gap;
      let y = G.FH / 2 - total / 2;
      for (const k of kids) {
        const key = keyFor(k);
        add({ key, pid: k, kind: "child", slim, x: colX(-1), y, w: G.CW, h, depth: -1, line: lineOf(P[k]), down: focusKey });
        edges.push({ id: `k:${key}`, type: "kid", a: key, b: focusKey, line: lineOf(P[k]) });
        y += h + gap;
      }
    }

    // bounds (expand buttons hang 32px off the right edge)
    const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const n of nodes.values()) {
      b.x0 = Math.min(b.x0, n.x); b.y0 = Math.min(b.y0, n.y);
      b.x1 = Math.max(b.x1, n.x + n.w + (n.expand ? EXPW() : 0)); b.y1 = Math.max(b.y1, n.y + n.h);
    }
    S.stats = { layoutMs: +(performance.now() - t0).toFixed(2), nodes: nodes.size, edges: edges.length };
    return { nodes, edges, bounds: b, focusKey, focusPid, depths: [minD, maxD] };
  }

  /* move a whole layout by (dx, dy) so a chosen card stays put on screen */
  function shiftLayout(L, dx, dy) {
    for (const n of L.nodes.values()) { n.x += dx; n.y += dy; }
    L.bounds.x0 += dx; L.bounds.x1 += dx; L.bounds.y0 += dy; L.bounds.y1 += dy;
    L.ox = (L.ox || 0) + dx;     // where column 0 starts now (for the generation labels)
  }
  const colLeft = (L, d) => (L.ox || 0) + colX(d);

  /* the path from a card to the focus: {keys, edges} */
  function traceOf(key) {
    const L = S.layout;
    const keys = [], edges = [];
    let n = L && L.nodes.get(key);
    if (!n) return { keys, edges };
    keys.push(key);
    while (n && n.kind === "cousin") { if (!n.sp) edges.push(`c:${n.key}`); n = L.nodes.get(n.down); keys.push(n.key); }
    if (n.kind === "sib" || n.kind === "more") { edges.push(`s:${n.key}`); n = L.nodes.get(n.owner); keys.push(n.key); }
    else if (n.kind === "spouse") { keys.push(n.owner); return { keys, edges }; }
    while (n && n.down) {
      edges.push(n.kind === "child" ? `k:${n.key}` : `p:${n.key}`);
      n = L.nodes.get(n.down);
      if (n) keys.push(n.key);
    }
    return { keys, edges };
  }

  /* ---------------------------------------------------------------- cards */
  const KIND_CLASS = { focus: "ch-focus", direct: "ch-direct", sib: "ch-row", cousin: "ch-row ch-cousin", more: "ch-more", spouse: "ch-spouse", child: "ch-direct ch-child", ph: "ch-ph" };
  /* birthplaces on cards: "Philadelphia, Pa." (the full place is in the person panel) */
  const STATES = {
    Alabama: "Ala.", Arizona: "Ariz.", Arkansas: "Ark.", California: "Calif.", Colorado: "Colo.", Connecticut: "Conn.",
    Delaware: "Del.", "District of Columbia": "D.C.", Florida: "Fla.", Georgia: "Ga.", Illinois: "Ill.", Indiana: "Ind.",
    Kansas: "Kan.", Kentucky: "Ky.", Louisiana: "La.", Maryland: "Md.", Massachusetts: "Mass.", Michigan: "Mich.",
    Minnesota: "Minn.", Mississippi: "Miss.", Missouri: "Mo.", Montana: "Mont.", Nebraska: "Neb.", Nevada: "Nev.",
    "New Hampshire": "N.H.", "New Jersey": "N.J.", "New Mexico": "N.M.", "New York": "N.Y.", "North Carolina": "N.C.",
    "North Dakota": "N.D.", Oklahoma: "Okla.", Oregon: "Ore.", Pennsylvania: "Pa.", Penna: "Pa.", "Penna.": "Pa.",
    "Rhode Island": "R.I.", "South Carolina": "S.C.", "South Dakota": "S.D.", Tennessee: "Tenn.", Vermont: "Vt.",
    Virginia: "Va.", Washington: "Wash.", "West Virginia": "W.Va.", Wisconsin: "Wis.", Wyoming: "Wyo.",
  };
  function placeOf(p) {
    if (isHidden(p)) return "";
    const parts = shortPlace(p.bp || "").split(", ").filter(Boolean);
    if (parts.length > 1 && STATES[parts[parts.length - 1]]) parts[parts.length - 1] = STATES[parts[parts.length - 1]];
    return parts.join(", ");
  }
  /* text widths for deciding what fits on a slim row (the chart's own font, measured on a canvas) */
  const measureCtx = document.createElement("canvas").getContext("2d");
  const widths = new Map();
  function textWidth(text, font) {
    const key = `${font}|${text}`;
    let w = widths.get(key);
    if (w == null) {
      if (!S.fontFamily) S.fontFamily = getComputedStyle(document.body).fontFamily || "sans-serif";
      measureCtx.font = `${font} ${S.fontFamily}`;
      w = measureCtx.measureText(text).width;
      widths.set(key, w);
    }
    return w;
  }
  /* "Eugene Richard “Gene” Perret" -> "Eugene Perret": first name and surname, for rows too short for the rest */
  function shortName(p) {
    const words = nameWords(p).filter(w => !/[“”"‘’]/.test(w));
    if (words.length < 3) return p.name;
    const sur = String(p.surname || "").trim();
    const last = sur && words.join(" ").endsWith(sur) ? sur : words[words.length - 1];
    return `${words[0]} ${last}`;
  }
  /* the name a slim row can show in full: the whole name, else the short one (the row's tooltip and label
     always carry the whole name) */
  function rowName(p, n, side, role) {
    const room = n.w - 2 - 16 - 22 - 8 - (side ? 8 + textWidth(side, "500 11.5px") + 2 : 0)
      - (role ? 8 + textWidth(role.toUpperCase(), "600 10px") + role.length : 0);
    const font = "500 12.5px";
    if (textWidth(p.name, font) <= room) return p.name;
    return shortName(p);
  }
  function ariaFor(n, p) {
    const bits = [p.name, years(p), p.rel].filter(Boolean);
    if (n.kind === "spouse") bits.push(n.marr ? `married ${n.marr}` : "spouse");
    if (n.kind === "sib") bits.push("sibling");
    if (n.kind === "cousin" && !(n.sp && p.rel)) bits.push(`${n.sp ? spouseWord(p).toLowerCase() : "child"} of ${P[n.of].name}`);
    if (n.repeat) bits.push("also on another branch of the chart, where their ancestors are shown");
    return bits.join(", ");
  }

  /* the inside of one node; returns [cardEl, ...extra] */
  function nodeContent(n) {
    if (n.kind === "ph") {
      const who = n.role === "mother" ? "Mother" : "Father";
      return [el("div", { class: "ch-card", role: "img", "aria-label": `${who} not yet found` },
        el("span", { class: "ch-ph-mark", "aria-hidden": "true", text: "?" }),
        el("span", { class: "ch-text" },
          el("span", { class: "ch-name", text: `${who} unknown` }),
          el("span", { class: "ch-meta", text: "Not yet found" })))];
    }
    if (n.kind === "more") {
      const text = n.open ? "Show fewer" : `${n.count} more ${n.count === 1 ? "sibling" : "siblings"}`;
      return [el("button", {
        class: "ch-card", type: "button", tabindex: "-1", "aria-expanded": String(!!n.open),
        "aria-label": n.open ? `Show fewer siblings` : `Show ${n.count} more siblings (${n.total} in all)`,
        dataset: { act: "group" },
      }, icon(n.open ? "minus" : "plus", 14), el("span", { class: "ch-name", text }))];
    }
    const p = P[n.pid];
    const y = years(p);
    const kids = [];
    if (n.kind === "sib" || n.kind === "cousin" || n.kind === "spouse" || (n.kind === "child" && n.slim)) {
      const side = n.kind === "spouse" ? (n.marr ? `m. ${n.marr}` : "") : y;
      kids.push(avatar(p, { size: n.kind === "spouse" ? 24 : 22, cls: "ch-av" }));
      const role = n.kind === "spouse" || n.sp ? spouseWord(p) : "";
      if (role) kids.push(el("span", { class: "ch-role label", text: role }));
      kids.push(el("span", { class: "ch-name", text: n.kind === "spouse" ? p.name : rowName(p, n, side, role) }));
      if (side) kids.push(el("span", { class: n.kind === "spouse" ? "ch-marr" : "ch-years", text: side }));
    } else {
      const big = n.kind === "focus";
      const place = placeOf(p);
      kids.push(avatar(p, { size: big ? G.FH - 2 : G.CH - 2, cls: "ch-av" }),
        el("span", { class: "ch-text" },
          big && p.rel ? el("span", { class: "ch-rel", text: p.rel }) : null,
          el("span", { class: "ch-name", text: p.name }),
          el("span", { class: "ch-meta" },
            y ? el("span", { class: "ch-years", text: y }) : null,
            place ? el("span", { class: "ch-place", text: place }) : null)));
    }
    const card = el("button", {
      class: "ch-card", type: "button", tabindex: "-1", title: [p.name, y].filter(Boolean).join(", "),
      "aria-label": ariaFor(n, p), "aria-describedby": "ch-help", dataset: { act: "person" },
    }, kids);
    const out = [card];
    if (n.expand) {
      const more = n.expand === "more";
      out.push(el("button", {
        class: "ch-expand", type: "button", tabindex: "-1", dataset: { act: "expand" },
        title: more ? "Show two more generations" : "Hide these generations",
        "aria-label": more ? `Show ${firstName(p)}'s parents and grandparents` : `Hide ${firstName(p)}'s ancestors`,
      }, icon(more ? "chevron-right" : "chevron-left", 16)));
    }
    return out;
  }
  // what makes two renders of a node look the same (rebuild the content only when this changes)
  const sig = n => [n.kind, n.pid, n.expand, n.count, n.open, n.marr, n.slim, n.role, n.repeat, n.sp].join("|");

  function makeView(n) {
    const node = el("div", { class: "ch-node", dataset: { key: n.key } });
    const v = { el: node, card: null, data: null, sigv: "", g: null, f: null, t: null, leaving: false, arriving: false };
    fillView(v, n);
    S.nodeLayer.append(node);
    return v;
  }
  function fillView(v, n) {
    const s = sig(n);
    v.data = n;
    v.el.className = ["ch-node", KIND_CLASS[n.kind], n.kind === "child" && n.slim ? "ch-row" : "",
      n.pid && isHidden(P[n.pid]) ? "is-living" : "", v.arriving ? "is-arriving" : "", v.leaving ? "is-leaving" : ""]
      .filter(Boolean).join(" ");
    v.el.style.setProperty("--lc", `var(--${n.line || "none"})`);
    if (n.oline) v.el.style.setProperty("--focus-lc", `var(--${n.oline})`);
    v.el.dataset.line = n.line || "none";
    if (s !== v.sigv) {
      v.sigv = s;
      v.el.replaceChildren(...nodeContent(n));
      v.card = v.el.firstElementChild;
    }
  }
  function applyGeom(v) {
    const g = v.g, el = v.el;
    el.style.transform = `translate(${g.x}px, ${g.y}px)`;
    if (v.w !== g.w) { el.style.width = `${g.w}px`; v.w = g.w; }
    if (v.h !== g.h) { el.style.height = `${g.h}px`; v.h = g.h; }
    const o = g.o >= 0.999 ? "" : String(+g.o.toFixed(3));
    if (v.o !== o) { el.style.opacity = o; v.o = o; }
  }

  /* ---------------------------------------------------------------- connectors */
  const SVGNS = "http://www.w3.org/2000/svg";
  const r1 = v => Math.round(v * 2) / 2;      // half pixels keep 1px hairlines crisp at zoom 1
  function edgePath(e) {
    const A = S.views.get(e.a), B = S.views.get(e.b);
    if (!A || !B) return "";
    const a = A.g, b = B.g;
    if (e.type === "cousin") {
      // down the left edge of the parent's row, then in to the cousin's row
      const lx = b.x + G.CIND / 2;
      return `M${r1(lx)} ${r1(b.y + b.h)}V${r1(a.y + a.h / 2)}H${r1(a.x)}`;
    }
    if (e.type === "sib") {
      const bx = b.x + b.w + G.BRACKET;
      const ay = a.y + a.h / 2;
      // a card with an expand tab on its right middle takes its bracket near the top or bottom corner instead
      const tab = B.data && B.data.expand;
      const by = !tab ? b.y + b.h / 2 : ay < b.y ? b.y + 9 : b.y + b.h - 9;
      return `M${r1(a.x + a.w)} ${r1(ay)}H${r1(bx)}V${r1(by)}H${r1(b.x + b.w)}`;
    }
    const ax = a.x + a.w, ay = a.y + a.h / 2, by = b.y + b.h / 2;
    const jx = b.x - G.COLGAP / 2;
    return `M${r1(ax)} ${r1(ay)}H${r1(jx)}V${r1(by)}H${r1(b.x)}`;
  }
  function makeEdge(def) {
    const p = document.createElementNS(SVGNS, "path");
    p.setAttribute("class", `ch-edge ch-edge-${def.type}`);
    p.style.setProperty("--lc", `var(--${def.line || "none"})`);
    if (def.type === "parent" && def.b.startsWith("ph:")) p.classList.add("ch-edge-ph");
    S.edgeLayer.append(p);
    return { el: p, def, d: "", o: "" };
  }
  function drawEdges(moving = false) {
    for (const e of S.edges.values()) {
      if (moving && e.d) {
        // mid-tween: a connector between two cards that aren't moving is already drawn
        const A = S.views.get(e.def.a), B = S.views.get(e.def.b);
        if (A && B && A.still && B.still) continue;
      }
      const d = edgePath(e.def);
      if (d !== e.d) { e.el.setAttribute("d", d); e.d = d; }
      const A = S.views.get(e.def.a), B = S.views.get(e.def.b);
      const op = Math.min(A ? A.g.o : 0, B ? B.g.o : 0);
      const o = op >= 0.999 ? "" : String(+op.toFixed(3));
      if (o !== e.o) { e.el.style.opacity = o; e.o = o; }
    }
    if (S.traceKey) drawTrace();
  }

  /* ---------------------------------------------------------------- render + tween */
  /* render(L, {anchor, animate}): show layout L. anchor = a key that keeps its place on screen (its left edge
     and vertical center); without a usable anchor the focus card lands where "home" would put it. */
  function render(L, { anchor = null, animate = true } = {}) {
    const first = !S.layout;
    const old = S.layout;
    // keep the anchor still: shift the new layout so the anchor sits where it was
    const av = anchor && S.views.get(anchor), an = anchor && L.nodes.get(anchor);
    if (!first && av && !av.leaving && an) {
      shiftLayout(L, av.g.x - an.x, (av.g.y + av.g.h / 2) - (an.y + an.h / 2));
    } else if (!first) {
      const f = L.nodes.get(L.focusKey), home = homeCam(L, S.cam.k);
      // put the focus where the home camera would show it, under the current camera
      const sx = home.x + f.x * home.k, sy = home.y + f.y * home.k;
      shiftLayout(L, (sx - S.cam.x) / S.cam.k - f.x, (sy - S.cam.y) / S.cam.k - f.y);
    }
    S.layout = L;
    const anim = animate && !first && !reduced();
    const hadFocus = !!(S.root && S.root.contains(document.activeElement) && document.activeElement !== S.root);
    clearTrace();

    // nodes: update, create, retire
    const seen = new Set();
    for (const n of L.nodes.values()) {
      seen.add(n.key);
      let v = S.views.get(n.key);
      const target = { x: n.x, y: n.y, w: n.w, h: n.h, o: 1 };
      if (v) {
        if (v.leaving) { v.leaving = false; v.el.classList.remove("is-leaving"); }
        v.still = false;
        fillView(v, n);
        v.f = { ...v.g };
        v.t = target;
      } else {
        v = makeView(n);
        S.views.set(n.key, v);
        // cards fading in take no clicks until they have landed (they start tucked under other cards)
        if (anim) { v.arriving = true; v.el.classList.add("is-arriving"); }
        // new cards grow out of the card they hang from, if it was already on screen
        let src = null;
        for (let k = n.down, guard = 0; k && guard < 40; guard++) {
          const dv = S.views.get(k);
          if (dv && dv.g && !seen.has(`new:${k}`) && old && old.nodes.has(k)) { src = dv.g; break; }
          const dn = L.nodes.get(k);
          k = dn && dn.down;
        }
        seen.add(`new:${n.key}`);
        const from = anim && src
          ? { x: src.x + (n.depth > (L.nodes.get(n.down) || n).depth ? src.w - n.w * 0.4 : 0), y: src.y + src.h / 2 - n.h / 2, w: n.w, h: n.h, o: 0 }
          : { ...target, o: 0 };
        v.g = anim ? { ...from } : { ...target };
        v.f = from;
        v.t = target;
        applyGeom(v);
      }
    }
    for (const [key, v] of S.views) {
      if (seen.has(key)) continue;
      v.still = false;
      if (v.leaving) { v.f = { ...v.g }; if (!anim) v.t = { ...v.g, o: 0 }; continue; }   // still fading from the last change
      v.leaving = true;
      v.el.classList.add("is-leaving");
      // fold back into the card it hung from, if that one stays
      const n = v.data;
      const dn = n && n.down && L.nodes.get(n.down);
      v.f = { ...v.g };
      v.t = dn && anim
        ? { x: dn.x + (n.depth > dn.depth ? dn.w - v.g.w : 0), y: dn.y + dn.h / 2 - v.g.h / 2, w: v.g.w, h: v.g.h, o: 0 }
        : { ...v.g, o: 0 };
    }

    // edges: new set, plus the old ones whose cards are leaving
    const ids = new Set();
    for (const def of L.edges) {
      ids.add(def.id);
      const e = S.edges.get(def.id);
      if (e) { e.def = def; e.leaving = false; e.el.setAttribute("class", `ch-edge ch-edge-${def.type}${def.b.startsWith("ph:") ? " ch-edge-ph" : ""}`); e.el.style.setProperty("--lc", `var(--${def.line || "none"})`); }
      else S.edges.set(def.id, makeEdge(def));
    }
    for (const [id, e] of S.edges) if (!ids.has(id)) e.leaving = true;

    updateSelectionClasses();
    updateLineClasses();
    updateRoving();
    // a rebuilt card drops keyboard focus; hand it to the chart's tab stop
    if (hadFocus && !S.root.contains(document.activeElement)) {
      const v = S.views.get(rovingKey());
      if (v && v.card && v.card.tagName === "BUTTON") v.card.focus({ preventScroll: true });
    }
    if (anim) startTween(DUR);
    else finishTween();
    if (first) setCam(homeCam(L), { now: true });
    updateHeader();
    syncTools();
  }

  function startTween(dur) {
    S.tween = { start: performance.now(), dur };
    S.root.classList.add("is-animating");
    // big charts: cards that are off screen both before and after the change jump straight to their place,
    // so each frame only moves what can be seen (and only their connectors are redrawn)
    if (S.views.size > 80) {
      const { x, y, k } = S.cam, m = 240;
      const seen = g => x + (g.x + g.w) * k > -m && x + g.x * k < S.size.w + m && y + (g.y + g.h) * k > -m && y + g.y * k < S.size.h + m;
      for (const v of S.views.values()) {
        if (!v.f || !v.t || seen(v.f) || seen(v.t)) continue;
        v.g = { ...v.t }; applyGeom(v); v.f = v.t = null; v.still = true;
      }
    }
    cancelAnimationFrame(S.raf);
    const step = now => {
      const T = S.tween;
      if (!T) return;
      const t = Math.min(1, (now - T.start) / T.dur), e = ease(t);
      for (const v of S.views.values()) {
        if (!v.f || !v.t) continue;
        const f = v.f, to = v.t, g = v.g;
        g.x = f.x + (to.x - f.x) * e; g.y = f.y + (to.y - f.y) * e;
        g.w = f.w + (to.w - f.w) * e; g.h = f.h + (to.h - f.h) * e;
        // arrivals fade in late (they start tucked behind the card they grow from), leavers fade out early
        g.o = f.o + (to.o - f.o) * (v.leaving ? easeOut(t) : f.o < to.o ? e * e : e);
        applyGeom(v);
      }
      drawEdges(true);
      if (t < 1) S.raf = requestAnimationFrame(step);
      else finishTween();
    };
    S.raf = requestAnimationFrame(step);
  }
  function finishTween() {
    cancelAnimationFrame(S.raf);
    S.tween = null;
    for (const [key, v] of S.views) {
      if (v.leaving) { v.el.remove(); S.views.delete(key); continue; }
      if (v.arriving) { v.arriving = false; v.el.classList.remove("is-arriving"); }
      v.still = false;
      if (v.t) { v.g = { ...v.t }; applyGeom(v); }
      v.f = v.t = null;
    }
    for (const [id, e] of S.edges) if (e.leaving) { e.el.remove(); S.edges.delete(id); }
    drawEdges();
    if (S.root) S.root.classList.remove("is-animating");
    if (S.afterTween) { const fn = S.afterTween; S.afterTween = null; fn(); }
  }

  /* ---------------------------------------------------------------- camera */
  const PAD = () => (isPhone() ? 16 : 32);
  const HEADER_H = 30;     // the generation labels (and the line legend) along the top of the chart
  // the starting zoom for this screen size
  // (by the window, not the viewport: a docking panel mustn't change the zoom halfway through its slide)
  const baseZoom = () => (window.innerWidth < 700 ? 0.8 : window.innerWidth < 1100 ? 0.9 : 1);
  /* what the first view tries to show, best first: the focus with both parents and all four grandparents,
     then the focus with the parents, then the focus alone. Each is {y0, y1} in chart units. */
  function homeExtents(L) {
    const out = [];
    for (const maxD of [2, 1, 0]) {
      let y0 = Infinity, y1 = -Infinity;
      for (const n of L.nodes.values()) {
        if (n.depth < 0 || n.depth > maxD || !(n.kind === "focus" || n.kind === "direct" || n.kind === "ph")) continue;
        y0 = Math.min(y0, n.y); y1 = Math.max(y1, n.y + n.h);
      }
      if (y1 > y0) out.push({ y0, y1 });
    }
    return out;
  }
  const HOME_M = 16;       // breathing room above and below the home extent
  /* the opening zoom: the screen's base zoom, eased down (to 60% of it at most) so the focus, both parents
     and the four grandparents fit between the generation labels and the bottom of the chart */
  function homeZoom(L) {
    const base = baseZoom();
    const [ext] = homeExtents(L);
    if (!ext) return base;
    const R = visibleRect();
    const room = R.y1 - R.y0 - HOME_M * 2;
    let k = Math.min(base, room / Math.max(1, ext.y1 - ext.y0));
    // and, shrinking a little (to 85% of base at most), every column across; a phone can't show them anyway
    const b = L.bounds, across = (R.x1 - R.x0 - PAD() * 2) / Math.max(1, b.x1 - b.x0);
    if (!isPhone()) k = Math.min(k, Math.max(across, base * 0.85));
    // touch screens keep rows big enough to tap
    return clamp(k, base * (COARSE.matches ? 0.8 : 0.6), base);
  }
  /* home: the focus card at the left (children column visible); vertically, the biggest home extent that
     fits is centered (else the focus card); a chart narrower than the viewport is centered horizontally */
  function homeCam(L = S.layout, k = S.cam.k) {
    const f = L.nodes.get(L.focusKey);
    const b = L.bounds, R = visibleRect(), W = R.x1 - R.x0;
    const pad = PAD();
    let x;
    // (a chart that fits only by eating into the padding is centered too, rather than cut at the right edge)
    if ((b.x1 - b.x0) * k <= W) x = R.x0 + (W - (b.x1 - b.x0) * k) / 2 - b.x0 * k;
    else x = R.x0 + pad - b.x0 * k;
    // on narrow screens the children column would push the focus off the right edge: start at the focus
    // when the children, the focus and the parents' column don't all fit
    if (f.x > b.x0 && (f.x + f.w + G.COLGAP + G.CW * 0.6 - b.x0) * k + pad * 2 > W) x = R.x0 + pad - f.x * k;
    // in the part of the chart that isn't under the generation labels or the person panel
    const room = R.y1 - R.y0 - HOME_M * 2;
    const ext = homeExtents(L).find(e => (e.y1 - e.y0) * k <= room);
    const cy = ext ? (ext.y0 + ext.y1) / 2 : f.y + f.h / 2;
    const y = (R.y0 + R.y1) / 2 - cy * k;
    return { x, y, k };
  }
  function fitCam(L = S.layout) {
    // the room under the generation labels, clear of the panel and a notch
    const b = L.bounds, R = visibleRect(), W = R.x1 - R.x0, H = R.y1 - R.y0, pad = PAD();
    const k = clamp(Math.min((W - pad * 2) / (b.x1 - b.x0), (H - pad * 2) / (b.y1 - b.y0)), ZMIN, 1);
    return {
      k, x: R.x0 + (W - (b.x1 - b.x0) * k) / 2 - b.x0 * k,
      y: R.y0 + (H - (b.y1 - b.y0) * k) / 2 - b.y0 * k,
    };
  }
  /* keep at least `m` px of the chart on screen (loose = dragging) or keep the chart's edges inside the
     viewport (tight = wheel and touch scroll chaining). Returns [lo, hi] for x or y. */
  function camRange(axis, k, tight) {
    const b = S.layout.bounds;
    const view = axis === "x" ? S.size.w : S.size.h;
    const b0 = axis === "x" ? b.x0 : b.y0, b1 = axis === "x" ? b.x1 : b.y1;
    const top = axis === "y" ? HEADER_H : 0;
    let lo, hi;
    if (tight) { const pad = 40; lo = view - pad - b1 * k; hi = top + pad - b0 * k; }
    else { const m = Math.min(160, view * 0.3); lo = m - b1 * k; hi = view - m - b0 * k; }
    return lo <= hi ? [lo, hi] : [hi, lo];
  }
  function clampCam(c) {
    if (!S.layout) return c;
    const rx = camRange("x", c.k, false), ry = camRange("y", c.k, false);
    return { k: c.k, x: clamp(c.x, rx[0], rx[1]), y: clamp(c.y, ry[0], ry[1]) };
  }
  let camQueued = false;
  function setCam(c, { now = false, free = false } = {}) {
    const k = clamp(c.k, ZMIN, ZMAX);
    S.cam = free ? { ...c, k } : clampCam({ ...c, k });
    if (now) { applyCam(); return; }
    if (!camQueued) { camQueued = true; requestAnimationFrame(() => { camQueued = false; applyCam(); }); }
  }
  function applyCam() {
    const { x, y, k } = S.cam;
    if (!S.stage) return;
    S.stage.style.transform = `translate(${x}px, ${y}px) scale(${k})`;
    const grid = 32 * k;
    S.viewport.style.backgroundSize = `${grid}px ${grid}px`;
    S.viewport.style.backgroundPosition = `${x}px ${y}px`;
    updateHeader();
    if (S.tools.zoomLabel) S.tools.zoomLabel.textContent = `${Math.round(k * 100)}%`;
    if (S.tools.zoomOut) S.tools.zoomOut.disabled = k <= ZMIN + 1e-3;
    if (S.tools.zoomIn) S.tools.zoomIn.disabled = k >= ZMAX - 1e-3;
  }
  /* glide the camera to c (interruptible by any pan or zoom) */
  const sameCam = (a, b) => !!a && !!b && Math.abs(a.x - b.x) < 1.5 && Math.abs(a.y - b.y) < 1.5 && Math.abs(a.k - b.k) < 1e-3;
  function glide(c, dur = GLIDE) {
    const target = clampCam({ ...c, k: clamp(c.k, ZMIN, ZMAX) });
    // already there, or already on the way: one smooth move, not a stop and a second start
    if (S.camTween ? sameCam(target, S.glideTarget) : sameCam(target, S.cam)) return;
    cancelAnimationFrame(S.camRaf);
    S.glideTarget = target;
    if (reduced() || dur <= 0) { setCam(target, { now: true }); return; }
    const from = { ...S.cam }, start = performance.now();
    // zoom in log space so it feels even; keep the screen point that maps between the two cameras steady
    const step = now => {
      const t = Math.min(1, (now - start) / dur), e = ease(t);
      const k = Math.exp(Math.log(from.k) + (Math.log(target.k) - Math.log(from.k)) * e);
      S.cam = { x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, k };
      applyCam();
      if (t < 1) S.camRaf = requestAnimationFrame(step);
      else S.camTween = null;
    };
    S.camTween = true;
    S.camRaf = requestAnimationFrame(step);
  }
  // any pan or zoom by the user cancels camera moves that are running or about to start
  const stopGlide = () => {
    cancelAnimationFrame(S.camRaf);
    S.camTween = null;
    clearTimeout(S.glideTimer); S.glideTimer = 0;
    clearTimeout(S.selTimer);
  };
  function zoomAt(factor, px, py, { animate = false } = {}) {
    const c = S.cam;
    const k = clamp(c.k * factor, ZMIN, ZMAX);
    const lx = (px - c.x) / c.k, ly = (py - c.y) / c.k;
    const next = { k, x: px - lx * k, y: py - ly * k };
    if (animate) glide(next, 260); else { stopGlide(); setCam(next); }
  }

  /* ---------------------------------------------------------------- generation labels */
  let headerCells = new Map();
  /* label widths, measured once per text with a hidden probe in the strip: [one line, longest word] */
  const labelWidths = new Map();
  function labelWidth(text) {
    let w = labelWidths.get(text);
    if (w) return w;
    if (!S.probe) {
      S.probe = el("span", { class: "ch-col-label label ch-col-probe" }, el("span", { class: "ch-col-text" }));
      S.header.append(S.probe);
    }
    const t = S.probe.firstElementChild;
    t.textContent = text;
    const one = S.probe.offsetWidth;
    let word = 0;
    for (const part of text.split(/\s+|(?<=-)/)) { t.textContent = part; word = Math.max(word, S.probe.offsetWidth); }
    w = [one, word];
    if (one > 20) labelWidths.set(text, w);     // not cached while the strip is hidden
    return w;
  }
  function updateHeader() {
    const L = S.layout;
    if (!L || !S.header) return;
    const [d0, d1] = L.depths;
    const { x, k } = S.cam;
    const fp = P[L.focusPid];
    const want = new Set();
    // labels stop short of the legend at the right end of the strip
    const limit = (S.legendL != null ? S.legendL : S.size.w) - 12;
    for (let d = d0; d <= d1; d++) {
      want.add(d);
      let cell = headerCells.get(d);
      if (!cell) {
        cell = el("span", { class: "ch-col-label label" }, el("span", { class: "ch-col-text" }));
        headerCells.set(d, cell);
        S.header.append(cell);
      }
      const left = x + colLeft(L, d) * k, w = colW(d) * k;
      // a column running off the left edge keeps its label pinned to the edge while there's room
      const edge = 12 + ((S.safe && S.safe.l) || 0);
      const lx = Math.min(Math.max(left, edge), left + w - 72);
      const colEnd = left + (colW(d) + G.COLGAP) * k - 16;
      const room = Math.min(colEnd, limit) - lx;
      // one naming scheme: the full name on one line, else on two lines, else "Gen. N". A label squeezed only by
      // the legend is hidden rather than switched to "Gen. N", so the strip never reads "Parents · Gen. 2"
      const full = generationLabel(d, fp);
      const [one, word] = labelWidth(full);
      let text = full, two = false, squeezed = false;
      if (one > room) {
        if (word <= room && d > 0) two = true;
        else if (d > 0 && limit < colEnd && word <= colEnd - lx) squeezed = true;
        else if (d > 0) text = `Gen. ${d}`;
      }
      const t = cell.firstElementChild;
      if (t.textContent !== text) t.textContent = text;
      cell.classList.toggle("is-2l", two);
      cell.style.transform = `translateX(${Math.round(lx)}px)`;
      cell.style.width = `${Math.max(0, Math.round(room))}px`;
      cell.hidden = squeezed || room < (text === full ? Math.min(word, 56) : labelWidth(text)[0]) || left + w - 72 < edge || left > limit;
      cell.classList.toggle("is-focus", d === 0);
    }
    for (const [d, cell] of headerCells) if (!want.has(d)) { cell.remove(); headerCells.delete(d); }
  }

  /* ---------------------------------------------------------------- hover trace */
  function drawTrace() {
    const { keys, edges } = traceOf(S.traceKey);
    const frag = document.createDocumentFragment();
    for (const id of edges) {
      const e = S.edges.get(id);
      if (!e || !e.d) continue;
      const p = document.createElementNS(SVGNS, "path");
      p.setAttribute("d", e.d);
      p.setAttribute("class", `ch-trace ch-trace-${e.def.type}`);
      frag.append(p);
    }
    S.hlLayer.replaceChildren(frag);
    for (const v of S.views.values()) v.el.classList.toggle("is-trace", keys.includes(v.data.key));
  }
  function setTrace(key) {
    if (key === S.traceKey) return;
    S.traceKey = key;
    if (!key) { clearTrace(); return; }
    S.root.classList.add("is-tracing");
    drawTrace();
  }
  function clearTrace() {
    S.traceKey = null;
    if (!S.root) return;
    S.root.classList.remove("is-tracing");
    S.hlLayer.replaceChildren();
    for (const v of S.views.values()) v.el.classList.remove("is-trace");
  }

  /* ---------------------------------------------------------------- selection, lines, roving focus */
  function keyForPid(pid) {
    if (!pid || !S.layout) return null;
    if (S.cursor && S.layout.nodes.has(S.cursor) && S.layout.nodes.get(S.cursor).pid === pid) return S.cursor;
    for (const n of S.layout.nodes.values()) if (n.pid === pid && n.kind !== "spouse") return n.key;
    for (const n of S.layout.nodes.values()) if (n.pid === pid) return n.key;
    return null;
  }
  function updateSelectionClasses() {
    const key = keyForPid(S.selected);
    for (const v of S.views.values()) v.el.classList.toggle("is-selected", !!key && v.data.key === key && !v.leaving);
  }
  /* the grandparent lines a person belongs to: their own, or for the people below the four lines (the focus,
     Michael's parents: line "self") every line among their ancestors, so Kevin lights with Harkins and Perret */
  const linesMemo = new Map();
  function linesOf(pid, guard = 0) {
    if (linesMemo.has(pid)) return linesMemo.get(pid);
    const p = P[pid];
    let out = [];
    if (p && LINE_KEYS.includes(p.line)) out = [p.line];
    else if (p && p.line === "self" && guard < 6) {
      out = [...new Set([p.father, p.mother].filter(id => P[id]).flatMap(id => linesOf(id, guard + 1)))];
    }
    linesMemo.set(pid, out);
    return out;
  }
  /* the highlighted line a node or connector shows, or null */
  function litLine(n) {
    if (!n || !S.lines.size) return null;
    const ls = n.pid ? linesOf(n.pid) : [n.line];
    return ls.find(l => S.lines.has(l)) || null;
  }
  function updateLineClasses() {
    if (!S.root) return;
    const on = S.lines.size > 0;
    const L = S.layout;
    S.root.classList.toggle("has-lines", on);
    for (const v of S.views.values()) v.el.classList.toggle("is-lit", !!litLine(v.data));
    for (const e of S.edges.values()) {
      // a parent connector belongs to the parent; a sibling bracket or child connector to the row or child
      const n = L && L.nodes.get(e.def.type === "parent" ? e.def.b : e.def.a);
      const line = n ? litLine(n) : null;
      e.el.classList.toggle("is-lit", !!line);
      if (line) e.el.style.setProperty("--hl", `var(--${line})`);
    }
    if (S.legend) {
      $$("button[data-line]", S.legend).forEach(b => b.setAttribute("aria-pressed", String(S.lines.has(b.dataset.line))));
      syncLegend();
    }
  }
  // one card is the chart's tab stop: the keyboard cursor, else the selection, else the focus
  function rovingKey() {
    const L = S.layout;
    if (!L) return null;
    if (S.cursor && L.nodes.has(S.cursor)) return S.cursor;
    return keyForPid(S.selected) || L.focusKey;
  }
  function updateRoving() {
    const key = rovingKey();
    for (const v of S.views.values()) {
      const c = v.card;
      if (c && c.tagName === "BUTTON") c.tabIndex = v.data.key === key && !v.leaving ? 0 : -1;
    }
  }
  /* the part of the viewport that shows the chart once the person panel has settled: not under the generation
     labels, a notch (landscape safe areas), the floating tablet panel or the phone sheet. On desktop the
     docked panel narrows the viewport itself while it slides open, so the width it will take is subtracted
     up front: a camera move started with the click lands right, instead of gliding again after the resize. */
  function visibleRect() {
    const safe = S.safe || { l: 0, r: 0 };
    let right = S.size.w - safe.r, bottom = S.size.h;
    const panel = document.getElementById("person-panel");
    const open = !!(App.state.selected && panel);
    if (panel && window.innerWidth >= 1100) {
      const final = open ? parseFloat(getComputedStyle(panel).getPropertyValue("--panel-w")) || 420 : 0;
      right = Math.min(right, S.size.w + panel.offsetWidth - final - safe.r);
    } else if (open && S.size.w >= 700) right -= Math.min(420, S.size.w * 0.62);
    if (open && isPhone()) {
      // the sheet opens at its half snap (about 45% of the window) over the bottom of the chart
      const vpBottom = S.viewport.getBoundingClientRect().bottom;
      const covered = window.innerHeight * 0.47 - Math.max(0, window.innerHeight - vpBottom);
      bottom = clamp(S.size.h - covered, HEADER_H + 120, S.size.h);
    }
    return { x0: safe.l, y0: HEADER_H, x1: Math.max(safe.l + 120, right), y1: bottom, open };
  }
  /* glide just enough to bring a card (and a margin) into the visible part of the viewport; measured from
     where a running glide is heading */
  function ensureVisible(key, { margin = 32 } = {}) {
    const n = S.layout && S.layout.nodes.get(key);
    if (!n) return;
    const { x, y, k } = S.camTween && S.glideTarget ? S.glideTarget : S.cam, R = visibleRect();
    const sx0 = x + n.x * k, sx1 = x + (n.x + n.w + (n.expand ? EXPW() : 0)) * k;
    const sy0 = y + n.y * k, sy1 = y + (n.y + n.h) * k;
    let dx = 0, dy = 0;
    if (sx1 - sx0 + margin * 2 > R.x1 - R.x0) dx = R.x0 + margin - sx0;
    else if (sx0 < R.x0 + margin) dx = R.x0 + margin - sx0;
    else if (sx1 > R.x1 - margin) dx = R.x1 - margin - sx1;
    if (sy1 - sy0 + margin * 2 > R.y1 - R.y0) dy = R.y0 + margin - sy0;
    else if (sy0 < R.y0 + margin) dy = R.y0 + margin - sy0;
    else if (sy1 > R.y1 - margin) dy = R.y1 - margin - sy1;
    if (Math.abs(dx) >= 1 || Math.abs(dy) >= 1) { S.atHome = false; glide({ x: x + dx, y: y + dy, k }, 320); }
  }

  /* ---------------------------------------------------------------- actions */
  /* re-layout keeping `anchor` still; refocus glides to the new focus afterwards */
  function relayout({ anchor = null, animate = true, refocus = false, rehome = false } = {}) {
    if (!S.focus || !P[S.focus] || !S.size.w) return;
    const L = layoutChart(S.focus);
    if (refocus || (rehome && S.atHome)) {
      // a camera still at its home view goes to the new layout's home (and its zoom); one the user has
      // moved keeps its zoom
      const home = S.atHome;
      S.afterTween = null;
      render(L, { anchor, animate });
      const go = () => {
        S.glideTimer = 0;
        S.atHome = true;
        glide(homeCam(S.layout, home ? homeZoom(S.layout) : S.cam.k));
      };
      clearTimeout(S.glideTimer);
      if (animate && S.tween && !reduced()) S.glideTimer = setTimeout(go, DUR * 0.55);
      else go();
    } else render(L, { anchor, animate });
  }
  function refocus(pid, { animate = true } = {}) {
    if (!P[pid]) return;
    const same = pid === S.focus && S.layout;
    const anchor = keyForPid(pid);     // the card that was clicked keeps its place, then the camera glides
    S.focus = pid;
    S.cursor = null;
    if (same) { center(); return; }
    relayout({ anchor, animate, refocus: true });
    if (S.root) S.root.setAttribute("aria-label", `Pedigree chart centered on ${P[pid].name}`);
  }
  function toggleExpand(key) {
    const n = S.layout.nodes.get(key);
    if (!n || !n.pid) return;
    const was = S.expanded.has(n.pid);
    if (was) S.expanded.delete(n.pid); else S.expanded.add(n.pid);
    S.afterTween = was ? null : () => revealBranch(key);
    relayout({ anchor: key });
  }
  // after expanding, bring the new generations into view if they ended up off screen
  function revealBranch(key) {
    const L = S.layout, n = L.nodes.get(key);
    if (!n) return;
    let y0 = n.y, y1 = n.y + n.h, x1 = n.x + n.w;
    // everything that hangs from this card in the next two columns
    const hangsFrom = m => {
      for (let cur = m, guard = 0; cur && guard < 60; guard++) {
        const next = cur.owner || cur.down;
        if (next === key) return true;
        cur = next && L.nodes.get(next);
      }
      return false;
    };
    for (const m of L.nodes.values()) {
      if (m.depth <= n.depth || m.depth > n.depth + 2 || !hangsFrom(m)) continue;
      y0 = Math.min(y0, m.y); y1 = Math.max(y1, m.y + m.h); x1 = Math.max(x1, m.x + m.w);
    }
    const { x, y, k } = S.cam, R = visibleRect(), margin = 24;
    let dx = 0, dy = 0;
    if (x + x1 * k > R.x1 - margin) dx = Math.max(R.x1 - margin - (x + x1 * k), R.x0 + margin - (x + n.x * k));
    const h = (y1 - y0) * k;
    if (h + margin * 2 <= R.y1 - R.y0) {
      if (y + y0 * k < R.y0 + margin) dy = R.y0 + margin - (y + y0 * k);
      else if (y + y1 * k > R.y1 - margin) dy = R.y1 - margin - (y + y1 * k);
    }
    if (dx || dy) glide({ x: x + dx, y: y + dy, k }, 360);
  }
  function toggleGroup(key) {
    const n = S.layout.nodes.get(key);
    if (!n || !n.gkey) return;
    if (S.openGroups.has(n.gkey)) S.openGroups.delete(n.gkey); else S.openGroups.add(n.gkey);
    relayout({ anchor: n.owner });
  }
  function setGens(g) {
    if (g === S.gens) return;
    S.gens = g;
    store.set("hft.chart.gens", g === Infinity ? "all" : String(g));
    syncTools();
    relayout({ anchor: S.layout && S.layout.focusKey, rehome: true });
  }
  function setSibs(on) {
    S.sibs = on;
    store.set("hft.chart.sibs", on ? null : "off");
    syncTools();
    relayout({ anchor: S.layout && S.layout.focusKey, rehome: true });
  }
  /* Expand all: every generation, with every brother and sister (big families opened) */
  function expandAll() {
    S.gens = Infinity; S.sibs = true; S.groupsAll = true;
    S.openGroups.clear(); S.expanded.clear();
    store.set("hft.chart.gens", "all"); store.set("hft.chart.sibs", null); store.set("hft.chart.groups", "all");
    relayout({ anchor: S.layout && S.layout.focusKey, rehome: true });
    syncTools();   // after the new layout, which decides what each button can still do (and where focus goes)
  }
  /* Collapse all: back to the chart a first visit shows (four generations, big families folded) and to its
     opening view of the person in focus */
  function collapseAll() {
    S.gens = DEFAULT_GENS; S.sibs = true; S.groupsAll = false;
    S.openGroups.clear(); S.expanded.clear();
    store.set("hft.chart.gens", null); store.set("hft.chart.sibs", null); store.set("hft.chart.groups", null);
    S.atHome = true;
    relayout({ anchor: S.layout && S.layout.focusKey, refocus: true });
    syncTools();
  }
  // what each would change: Expand all, anything folded on screen (or the siblings switched off);
  // Collapse all, anything that isn't the first-visit chart
  function canExpand() {
    if (!S.sibs || !S.layout) return true;
    for (const n of S.layout.nodes.values()) if ((n.kind === "more" && !n.open) || n.expand === "more") return true;
    return false;
  }
  const canCollapse = () => S.gens !== DEFAULT_GENS || !S.sibs || S.groupsAll || S.openGroups.size > 0 || S.expanded.size > 0;
  function toggleLine(line) {
    if (S.lines.has(line)) S.lines.delete(line); else S.lines.add(line);
    updateLineClasses();
  }
  const zoomBy = f => { interacted(); zoomAt(f, S.size.w / 2, HEADER_H / 2 + S.size.h / 2, { animate: true }); };
  const fit = () => { interacted(); glide(fitCam()); };
  // back to the focus; from a zoomed-out view (after Fit, say) also back to a readable zoom
  const center = () => {
    const hz = homeZoom(S.layout);
    glide(homeCam(S.layout, S.cam.k < hz * 0.85 ? hz : S.cam.k));
    S.atHome = true;
  };

  function interacted() {
    S.atHome = false;         // the user moved the camera: resizes no longer re-home it
    if (S.interacted) return;
    S.interacted = true;
    if (S.hint) S.hint.classList.add("is-gone");
    clearTimeout(S.hintTimer);
  }
  let settleTimer = 0;
  function moving() {
    // promote the stage only while it moves, so text re-rasterizes crisply once it stops
    S.root.classList.add("is-moving");
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => S.root && S.root.classList.remove("is-moving"), 160);
  }

  /* ---------------------------------------------------------------- pointer input */
  const ptrs = new Map();
  let gesture = null;        // {type: "pan" | "pinch" | "maybe", ...}
  let suppressClick = false;
  let pendingTap = null;      // {key, timer}: a click waits briefly in case a second one makes it a double-click
  const local = (e, rect) => ({ x: e.clientX - rect.left, y: e.clientY - rect.top });

  function onPointerDown(e) {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if (e.target.closest(".ch-legend, .ch-hint")) return;
    suppressClick = false;
    stopGlide();
    const rect = S.viewport.getBoundingClientRect();
    ptrs.set(e.pointerId, { ...local(e, rect), type: e.pointerType });
    if (ptrs.size === 1) {
      const p = ptrs.get(e.pointerId);
      gesture = { type: "maybe", id: e.pointerId, sx: p.x, sy: p.y, lx: p.x, ly: p.y, rect, touch: e.pointerType !== "mouse" };
    } else if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      gesture = { type: "pinch", rect, d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, cam0: { ...S.cam } };
      suppressClick = true;
      try { S.viewport.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    }
  }
  function onPointerMove(e) {
    if (!ptrs.has(e.pointerId)) {
      // hover trace (mouse only, not while dragging)
      if (e.pointerType === "mouse" && !gesture) {
        const node = e.target.closest && e.target.closest(".ch-node");
        const key = node && !node.classList.contains("is-leaving") ? node.dataset.key : null;
        const n = key && S.layout && S.layout.nodes.get(key);
        setTrace(n && n.kind !== "ph" ? key : null);
      }
      return;
    }
    const rect = gesture ? gesture.rect : S.viewport.getBoundingClientRect();
    const p = local(e, rect);
    ptrs.set(e.pointerId, { ...p, type: e.pointerType });
    if (!gesture) return;
    if (gesture.type === "maybe") {
      const dist = Math.hypot(p.x - gesture.sx, p.y - gesture.sy);
      if (dist < (gesture.touch ? 8 : 4)) return;
      gesture.type = "pan";
      suppressClick = true;
      setTrace(null);
      S.root.classList.add("is-panning");
      try { S.viewport.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      interacted();
    }
    if (gesture.type === "pan" && e.pointerId === gesture.id) {
      const dx = p.x - gesture.lx, dy = p.y - gesture.ly;
      gesture.lx = p.x; gesture.ly = p.y;
      let y = S.cam.y + dy;
      if (gesture.touch) {
        // touch: vertical drags past the chart's edge scroll the page instead (there is no other way out)
        const [lo, hi] = camRange("y", S.cam.k, true);
        const cy = S.cam.y;
        const fits = (S.layout.bounds.y1 - S.layout.bounds.y0) * S.cam.k <= S.size.h - HEADER_H - 80;
        let ny = fits ? cy : clamp(y, Math.min(lo, cy), Math.max(hi, cy));
        const rest = dy - (ny - cy);
        if (Math.abs(rest) > 0.5) window.scrollBy(0, -rest);
        y = ny;
      }
      moving();
      setCam({ x: S.cam.x + dx, y, k: S.cam.k });
    } else if (gesture.type === "pinch" && ptrs.size >= 2) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1, m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const c0 = gesture.cam0, k = clamp(c0.k * d / gesture.d0, ZMIN, ZMAX);
      const lx = (gesture.m0.x - c0.x) / c0.k, ly = (gesture.m0.y - c0.y) / c0.k;
      moving();
      interacted();
      setCam({ k, x: m.x - lx * k, y: m.y - ly * k });
    }
  }
  function onPointerUp(e) {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    try { S.viewport.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    if (gesture && gesture.type === "pinch") {
      if (ptrs.size === 1) {
        // carry on panning with the finger that's left
        const [id, p] = [...ptrs.entries()][0];
        gesture = { type: "pan", id, sx: p.x, sy: p.y, lx: p.x, ly: p.y, rect: gesture.rect, touch: true };
        return;
      }
    }
    if (ptrs.size === 0) {
      const g = gesture;
      gesture = null;
      S.root.classList.remove("is-panning");
    }
  }
  function onWheel(e) {
    if (!S.layout) return;
    const rect = S.viewport.getBoundingClientRect();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? S.size.h : 1;
    let dx = e.deltaX * unit, dy = e.deltaY * unit;
    if (e.ctrlKey || e.metaKey) {
      // pinch on a trackpad arrives as ctrl+wheel; a mouse wheel notch is ~100
      e.preventDefault();
      stopGlide();
      interacted();
      moving();
      const f = Math.pow(2, -clamp(dy, -60, 60) / 160);
      zoomAt(f, e.clientX - rect.left, e.clientY - rect.top);
      return;
    }
    if (e.shiftKey && !dx) { dx = dy; dy = 0; }
    // pan; when the chart can't move any further that way, let the page scroll
    const c = S.cam;
    const [xlo, xhi] = camRange("x", c.k, true), [ylo, yhi] = camRange("y", c.k, true);
    const fitsY = (S.layout.bounds.y1 - S.layout.bounds.y0) * c.k <= S.size.h - HEADER_H - 80;
    const nx = clamp(c.x - dx, Math.min(xlo, c.x), Math.max(xhi, c.x));
    const ny = fitsY ? c.y : clamp(c.y - dy, Math.min(ylo, c.y), Math.max(yhi, c.y));
    const vertical = Math.abs(dy) >= Math.abs(dx);
    if (vertical && Math.abs(ny - c.y) < 0.5) return;            // the page scrolls
    if (!vertical && Math.abs(nx - c.x) < 0.5) { e.preventDefault(); return; }
    e.preventDefault();
    stopGlide();
    interacted();
    moving();
    setCam({ x: nx, y: ny, k: c.k });
  }
  // Safari trackpad pinch
  let gestureK = 1;
  function onGestureStart(e) { e.preventDefault(); gestureK = S.cam.k; }
  function onGestureChange(e) {
    e.preventDefault();
    const rect = S.viewport.getBoundingClientRect();
    const k = clamp(gestureK * e.scale, ZMIN, ZMAX);
    moving();
    zoomAt(k / S.cam.k, e.clientX - rect.left, e.clientY - rect.top);
  }

  /* ---------------------------------------------------------------- clicks */
  function nodeFromEvent(e) {
    const node = e.target.closest && e.target.closest(".ch-node");
    if (!node || node.classList.contains("is-leaving")) return null;
    return S.layout && S.layout.nodes.get(node.dataset.key);
  }
  /* A click selects (opens the person panel) after a short wait, so a second click can turn it into a
     double-click that centers the tree instead: the panel would otherwise slide over the card and catch the
     second click. Touch and mouse share this path. */
  const DOUBLE_MS = 250;
  function cancelPendingTap() {
    if (pendingTap) { clearTimeout(pendingTap.timer); pendingTap = null; }
  }
  function centerOn(pid) {
    cancelPendingTap();
    // on phones the person sheet would cover the tree that was just centered (as "Center tree here" does)
    if (isPhone()) { if (App.state.selected) App.select(null); App.go(pid, { select: false }); }
    else App.go(pid);
  }
  function onClick(e) {
    if (suppressClick) { suppressClick = false; e.stopPropagation(); e.preventDefault(); return; }
    const n = nodeFromEvent(e);
    if (!n) return;
    // (a tap on a row's enlarged touch area lands on the node itself)
    const act = e.target.closest("[data-act]") || (e.target.classList.contains("ch-node") && e.target.querySelector(":scope > [data-act]"));
    const what = act && act.dataset.act;
    if (what === "expand") { cancelPendingTap(); toggleExpand(n.key); return; }
    if (what === "group") { cancelPendingTap(); S.cursor = n.key; toggleGroup(n.key); return; }
    if (what === "person" && n.pid) {
      S.cursor = n.key;
      // keyboard-made clicks (no pointer) select at once
      if (e.detail === 0) { App.go(n.pid, { focus: false }); return; }
      if (pendingTap && pendingTap.key === n.key) { centerOn(n.pid); return; }
      cancelPendingTap();
      const pid = n.pid;
      updateRoving();
      pendingTap = { key: n.key, timer: setTimeout(() => { pendingTap = null; App.go(pid, { focus: false }); }, DOUBLE_MS) };
    }
  }
  function onDblClick(e) {
    // expand buttons and "+N more" rows: a fast second click is just another click, never a refocus
    if (e.target.closest("[data-act=expand], [data-act=group]")) { e.preventDefault(); return; }
    const n = nodeFromEvent(e);
    if (n && n.pid && e.target.closest("[data-act=person]")) {
      e.preventDefault();      // the pair of clicks has already centered the tree
      return;
    }
    if (n || e.target.closest(".ch-legend, .ch-hint, button")) return;
    const rect = S.viewport.getBoundingClientRect();
    interacted();
    zoomAt(1.6, e.clientX - rect.left, e.clientY - rect.top, { animate: true });
  }

  /* ---------------------------------------------------------------- keyboard */
  // the people and "+N more" rows in one column, top to bottom
  function columnOf(n) {
    return [...S.layout.nodes.values()].filter(m => m.depth === n.depth && m.kind !== "ph").sort((a, b) => a.y - b.y);
  }
  function parentKey(n, which) {
    const L = S.layout;
    const base = n.kind === "sib" || n.kind === "cousin" || n.kind === "more" ? L.nodes.get(n.owner) : n.kind === "spouse" ? null : n;
    if (!base || base.kind === "child") return null;
    const kids = [...L.nodes.values()].filter(m => m.down === base.key && (m.kind === "direct" || m.kind === "ph"));
    const pick = r => kids.find(m => m.role === r && m.kind !== "ph");
    return (which === "mother" ? pick("mother") || pick("father") : pick("father") || pick("mother")) || null;
  }
  function moveCursor(key) {
    const n = S.layout.nodes.get(key);
    if (!n) return;
    S.cursor = key;
    interacted();
    if (n.pid) App.go(n.pid, { focus: false, replace: true });
    updateRoving();
    updateSelectionClasses();
    const v = S.views.get(key);
    if (v && v.card && v.card.focus) v.card.focus({ preventScroll: true });
    ensureVisible(key);
    // the person panel may take focus when it opens; keep the keyboard in the chart
    requestAnimationFrame(() => {
      const cur = S.views.get(S.cursor);
      if (cur && cur.card && !S.root.contains(document.activeElement)) cur.card.focus({ preventScroll: true });
    });
  }
  function onKeyDown(e) {
    if (!S.layout || e.altKey || e.metaKey || e.ctrlKey) return;
    if (e.target.closest && e.target.closest(".ch-legend")) return;     // legend buttons keep their own keys
    const L = S.layout;
    const cur = L.nodes.get(rovingKey()) || L.nodes.get(L.focusKey);
    const k = e.key;
    let handled = true;
    if (k === "ArrowRight") {
      const p = parentKey(cur, e.shiftKey ? "mother" : "father");
      if (p) moveCursor(p.key);
      else if (cur.expand === "more") toggleExpand(cur.key);
    } else if (k === "ArrowLeft") {
      const base = cur.owner ? L.nodes.get(cur.owner) : cur;
      if (cur.kind === "spouse") moveCursor(cur.owner);
      else if (base && base.kind === "focus") {
        const kid = [...L.nodes.values()].filter(m => m.kind === "child").sort((a, b) => a.y - b.y);
        if (cur.kind !== "focus") moveCursor(base.key);
        else if (kid.length) moveCursor(kid[Math.floor((kid.length - 1) / 2)].key);
      } else if (base && base.down) moveCursor(base.down);    // a sibling row steps to its brother's or sister's child
    } else if (k === "ArrowUp" || k === "ArrowDown") {
      const col = columnOf(cur), i = col.findIndex(m => m.key === cur.key);
      const next = col[i + (k === "ArrowUp" ? -1 : 1)];
      if (next) moveCursor(next.key);
    } else if (k === "Enter" || k === " ") {
      if (cur.kind === "more") toggleGroup(cur.key);
      else if (cur.pid) {
        if (k === "Enter") App.go(cur.pid); else App.go(cur.pid, { focus: false });
      }
    } else if ((k === "e" || k === "E") && !e.shiftKey) {
      // show or hide the generations beyond an edge ancestor (the cursor stays on the card)
      if (cur.expand) { S.cursor = cur.key; toggleExpand(cur.key); } else handled = false;
    } else if (k === "Escape") {
      if (App.state.selected) App.select(null); else handled = false;
    } else if (k === "+" || k === "=") zoomBy(1.25);
    else if (k === "-" || k === "_") zoomBy(0.8);
    else if (k === "0") fit();
    else handled = false;
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  }

  /* ---------------------------------------------------------------- toolbar and legend */
  function buildTools() {
    const bar = App.toolbar("chart");
    if (!bar) return;
    const gens = el("div", { class: "seg seg-sm ch-gens", role: "group", "aria-label": "Generations to show" },
      GENS.map(g => el("button", {
        type: "button", dataset: { gens: g === Infinity ? "all" : String(g) }, "aria-pressed": "false",
        title: g === Infinity ? "Every generation we know" : `${g} generations of ancestors`,
        onclick: () => setGens(g),
      }, g === Infinity ? "All" : String(g))));
    const sibs = el("button", {
      class: "btn btn-sm ch-toggle", type: "button", "aria-pressed": "true", title: "Show brothers and sisters in the chart",
      onclick: () => setSibs(!S.sibs),
    }, icon("users", 16), el("span", { text: "Siblings" }));
    const zoomOut = el("button", { class: "btn btn-icon btn-sm", type: "button", "aria-label": "Zoom out", title: "Zoom out (−)", onclick: () => zoomBy(0.8) }, icon("zoom-out", 18));
    const zoomLabel = el("button", { class: "btn btn-sm btn-ghost ch-zoom-label", type: "button", title: "Actual size", "aria-label": "Zoom to 100%",
      onclick: () => { interacted(); zoomAt(1 / S.cam.k, S.size.w / 2, HEADER_H / 2 + S.size.h / 2, { animate: true }); } }, "100%");
    const zoomIn = el("button", { class: "btn btn-icon btn-sm", type: "button", "aria-label": "Zoom in", title: "Zoom in (+)", onclick: () => zoomBy(1.25) }, icon("zoom-in", 18));
    const fitB = el("button", { class: "btn btn-icon btn-sm", type: "button", "aria-label": "Fit the whole chart", title: "Fit the whole chart (0)", onclick: () => { interacted(); fit(); openTools(false); } }, icon("fit", 18));
    const centerB = el("button", { class: "btn btn-icon btn-sm", type: "button", "aria-label": "Center on the focus", title: "Center on the focus", onclick: () => { interacted(); center(); openTools(false); } }, icon("center", 18));
    const allB = (name, text, title, act) => el("button", {
      class: "btn btn-sm ch-all", type: "button", title,
      onclick: () => {
        act();
        // on phones the panel closes, so the chart can be seen opening up or folding away
        if (S.tools.pop.classList.contains("is-open")) { openTools(false); S.tools.viewB.focus({ preventScroll: true }); }
      },
    }, icon(name, 16), el("span", { class: "ch-all-text", text }));
    const expandB = allB("expand", "Expand all", "Expand all: every generation, with every brother and sister", expandAll);
    const collapseB = allB("collapse", "Collapse all", "Collapse all: back to four generations, with big families folded", collapseAll);
    const all = el("div", { class: "tool-group ch-all-group", role: "group", "aria-label": "Expand or collapse the chart" }, expandB, collapseB);
    // phones: one "View" button in the toolbar opens these controls in a small panel under it
    const pop = el("div", { class: "ch-tools-pop", id: "ch-tools-pop" },
      el("div", { class: "tool-group" }, el("span", { class: "label ch-tools-label", text: "Generations" }), gens),
      el("span", { class: "tool-sep", "aria-hidden": "true" }),
      sibs,
      el("span", { class: "tool-sep", "aria-hidden": "true" }),
      all,
      el("span", { class: "tool-sep", "aria-hidden": "true" }),
      el("div", { class: "tool-group ch-zoom", role: "group", "aria-label": "Zoom" }, zoomOut, zoomLabel, zoomIn, fitB, centerB));
    const viewB = el("button", {
      class: "btn btn-sm ch-view-btn", type: "button", "aria-expanded": "false", "aria-controls": "ch-tools-pop",
      onclick: () => openTools(!pop.classList.contains("is-open")),
    }, el("span", { text: "View" }), icon("chevron-down", 16));
    pop.addEventListener("keydown", e => { if (e.key === "Escape") { e.stopPropagation(); openTools(false); viewB.focus(); } });
    document.addEventListener("pointerdown", e => {
      if (pop.classList.contains("is-open") && !pop.contains(e.target) && !viewB.contains(e.target)) openTools(false);
    }, true);
    let winW = window.innerWidth;     // (phones resize the height as their browser bars come and go)
    window.addEventListener("resize", () => { if (window.innerWidth !== winW) { winW = window.innerWidth; openTools(false); } });
    bar.replaceChildren(viewB, pop);
    Object.assign(S.tools, { gens, sibs, zoomOut, zoomIn, zoomLabel, pop, viewB, all, expandB, collapseB });
    syncTools();
    // the tools slot keeps its width whatever it holds, so watching it can't feed back into fitTools
    const slot = bar.closest(".tree-tools");
    if (slot && window.ResizeObserver) new ResizeObserver(() => fitTools()).observe(slot);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => fitTools());
    App.on("view", name => { if (name === "chart") requestAnimationFrame(fitTools); });
  }
  /* when the tools would run off the toolbar they give up words, least needed first: the zoom percentage, then
     the words of Expand all and Collapse all (with a mouse their names still show as tooltips), the Generations
     label, the word Siblings and last the separators. Touch screens show no tooltips, so there the Generations
     label and the separators go before those words. What still doesn't fit scrolls sideways. On phones they
     live in the View panel instead (chart.css). */
  const TIGHTER = ["is-snug", "is-compact", "is-tight", "is-cramped", "is-bare"];
  const TIGHTER_TOUCH = ["is-snug", "is-tight", "is-bare", "is-compact", "is-cramped"];
  function fitTools() {
    const pop = S.tools.pop, slot = pop && pop.closest(".tree-tools");
    if (!slot || isPhone() || !S.tools.all.getClientRects().length) return;   // (hidden while the Family view shows)
    pop.classList.remove(...TIGHTER);
    for (const c of COARSE.matches ? TIGHTER_TOUCH : TIGHTER) {
      if (slot.scrollWidth <= slot.clientWidth + 1) break;
      pop.classList.add(c);
    }
  }
  function openTools(on) {
    const { pop, viewB } = S.tools;
    if (!pop || on === pop.classList.contains("is-open")) return;
    if (on) {
      // fixed, so the toolbar's own sideways scrolling can't clip it
      const r = viewB.getBoundingClientRect(), top = Math.round(r.bottom + 6);
      pop.style.top = `${top}px`;
      // and never past the bottom of the screen (it scrolls instead), as the browser's bars come and go
      pop.style.maxHeight = `calc(100dvh - ${top + 8}px)`;
      pop.classList.add("is-open");
      pop.style.left = `${Math.round(Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8)))}px`;
    }
    pop.classList.toggle("is-open", on);
    viewB.setAttribute("aria-expanded", String(on));
  }
  function syncTools() {
    const t = S.tools;
    if (t.gens) $$("button", t.gens).forEach(b => b.setAttribute("aria-pressed", String(b.dataset.gens === (S.gens === Infinity ? "all" : String(S.gens)))));
    if (t.sibs) t.sibs.setAttribute("aria-pressed", String(S.sibs));
    if (t.expandB) {
      const act = document.activeElement, noExpand = !canExpand(), noCollapse = !canCollapse();
      t.expandB.disabled = noExpand;
      t.collapseB.disabled = noCollapse;
      // the button that has just done its job hands keyboard focus to the other one, or, when that one has
      // nothing to do either, to the generations now shown
      const other = act === t.expandB && noExpand ? t.collapseB : act === t.collapseB && noCollapse ? t.expandB : null;
      const to = other && (other.disabled ? $("button[aria-pressed=true]", t.gens) : other);
      if (to) to.focus({ preventScroll: true });
    }
  }
  /* the line legend sits at the right end of the generation-label strip, out of the drawing area. Where the
     chart is narrow (phones, the docked or floating person panel) it folds into one "Lines" button that
     opens the four toggles below the strip. */
  function buildLegend() {
    const items = el("div", { class: "ch-legend-items", id: "ch-legend-items" },
      el("span", { class: "label ch-legend-label", text: "Lines" }),
      LINE_KEYS.map(k => el("button", {
        type: "button", class: "ch-legend-item", dataset: { line: k }, "aria-pressed": "false",
        style: { "--lc": `var(--${k})` }, title: `Highlight the ${LINE_NAMES[k]}`,
        onclick: () => toggleLine(k),
      }, el("span", { class: "marker" }), el("span", { text: LINE_NAMES[k].replace(/ line$/, "") }))));
    const toggle = el("button", {
      type: "button", class: "ch-legend-toggle", "aria-expanded": "false", "aria-controls": "ch-legend-items",
      title: "Highlight a family line", onclick: () => openLegend(!S.legend.classList.contains("is-open")),
    }, el("span", { class: "ch-legend-swatches", "aria-hidden": "true" },
      LINE_KEYS.map(k => el("span", { class: "marker", style: { "--lc": `var(--${k})` } }))),
    el("span", { class: "ch-legend-toggle-text", text: "Lines" }), icon("chevron-down", 14));
    const box = el("div", { class: "ch-legend", role: "group", "aria-label": "Highlight a family line" }, toggle, items);
    box.addEventListener("keydown", e => {
      if (e.key === "Escape" && box.classList.contains("is-open")) { e.stopPropagation(); openLegend(false); toggle.focus(); }
    });
    S.legendToggle = toggle;
    return box;
  }
  function openLegend(on) {
    if (!S.legend) return;
    S.legend.classList.toggle("is-open", on);
    S.legendToggle.setAttribute("aria-expanded", String(on));
  }
  /* fold or unfold the legend for the room the chart has, keep it clear of a floating panel, and remember
     where it starts so the generation labels stop short of it */
  function syncLegend() {
    if (!S.legend || !S.size.w) return;
    const cs = getComputedStyle(S.header);
    S.safe = { l: parseFloat(cs.paddingLeft) || 0, r: parseFloat(cs.paddingRight) || 0 };
    const R = visibleRect();
    const compact = isPhone() || R.x1 - R.x0 < 1180;
    if (compact !== S.legend.classList.contains("is-compact")) {
      S.legend.classList.toggle("is-compact", compact);
      if (!compact) openLegend(false);
    }
    const right = Math.max(0, S.size.w - R.x1);
    S.legend.style.right = right ? `${right}px` : "";
    S.legendL = S.size.w - right - S.legend.offsetWidth;
    const n = S.lines.size;
    S.legendToggle.classList.toggle("is-on", n > 0);
    S.legendToggle.lastElementChild.previousElementSibling.textContent = n ? `Lines · ${n}` : "Lines";
  }

  /* ---------------------------------------------------------------- mount */
  const touchFirst = () => window.matchMedia("(hover: none)").matches;
  function mount(host) {
    S.host = host;
    S.edgeLayer = document.createElementNS(SVGNS, "g");
    S.edgeLayer.setAttribute("class", "ch-edges");
    S.hlLayer = document.createElementNS(SVGNS, "g");
    S.hlLayer.setAttribute("class", "ch-traces");
    S.svg = document.createElementNS(SVGNS, "svg");
    S.svg.setAttribute("class", "ch-svg");
    S.svg.setAttribute("aria-hidden", "true");
    S.svg.setAttribute("width", "1");
    S.svg.setAttribute("height", "1");
    S.svg.append(S.edgeLayer, S.hlLayer);
    S.nodeLayer = el("div", { class: "ch-nodes" });
    S.stage = el("div", { class: "ch-stage" }, S.svg, S.nodeLayer);
    S.header = el("div", { class: "ch-header", "aria-hidden": "true" });
    S.hint = el("span", { class: "ch-hint", "aria-hidden": "true",
      text: touchFirst() ? "Drag to move · Pinch to zoom · Double-tap a person to center" : "Drag to move · Ctrl + scroll to zoom · Double-click a person to center" });
    S.legend = buildLegend();
    S.viewport = el("div", { class: "ch-viewport" }, S.stage);
    const help = el("p", { class: "sr-only", id: "ch-help",
      text: "Arrow keys move between people: Right goes to the father, Shift+Right to the mother, Left toward the person in focus, Up and Down within a generation. Enter centers the tree on the person, Space shows their details. E shows or hides the generations beyond a person at the edge of the chart. Plus and minus zoom, 0 fits the chart, Escape closes the details. With a mouse, drag to move, Ctrl and scroll to zoom, double-click a person to center." });
    S.root = el("div", { class: "ch-root", role: "group", "aria-roledescription": "pedigree chart", "aria-label": "Pedigree chart" },
      S.viewport, S.header, S.legend, S.hint, help);
    // the hint is for first-timers: it leaves at the first pan or zoom, or after a while
    S.hintTimer = setTimeout(() => S.hint && S.hint.classList.add("is-gone"), 12000);
    // a folded legend closes when you click or tap anywhere else
    document.addEventListener("pointerdown", e => {
      if (S.legend && S.legend.classList.contains("is-open") && !S.legend.contains(e.target)) openLegend(false);
    }, true);
    host.replaceChildren(S.root);

    const vp = S.viewport;
    // focusing a card that's partly outside scrolls clipped ancestors; the chart moves by its camera only
    for (const box of [host, S.root, vp]) {
      box.addEventListener("scroll", () => { if (box.scrollTop || box.scrollLeft) { box.scrollTop = 0; box.scrollLeft = 0; } });
    }
    vp.addEventListener("pointerdown", onPointerDown);
    vp.addEventListener("pointermove", onPointerMove);
    vp.addEventListener("pointerup", onPointerUp);
    vp.addEventListener("pointercancel", onPointerUp);
    vp.addEventListener("pointerleave", e => { if (e.pointerType === "mouse" && !gesture) setTrace(null); });
    // touch starts with implicit capture on the card; only losing the viewport's own capture ends a gesture
    vp.addEventListener("lostpointercapture", e => { if (e.target === vp && ptrs.has(e.pointerId) && gesture && gesture.type !== "maybe") onPointerUp(e); });
    vp.addEventListener("wheel", onWheel, { passive: false });
    vp.addEventListener("gesturestart", onGestureStart, { passive: false });
    vp.addEventListener("gesturechange", onGestureChange, { passive: false });
    vp.addEventListener("click", onClick, true);
    vp.addEventListener("dblclick", onDblClick);
    vp.addEventListener("contextmenu", e => { if (gesture && gesture.type === "pan") e.preventDefault(); });
    S.root.addEventListener("keydown", onKeyDown);
    S.root.addEventListener("focusin", e => {
      const node = e.target.closest && e.target.closest(".ch-node");
      if (node && S.layout && S.layout.nodes.has(node.dataset.key)) S.cursor = node.dataset.key;
    });

    buildTools();
    S.selected = App.state.selected;
    App.on("select", pid => {
      S.selected = pid || null;
      if (!pid) S.cursor = null;
      else if (S.cursor && S.layout && S.layout.nodes.get(S.cursor) && S.layout.nodes.get(S.cursor).pid !== pid) S.cursor = null;
      updateSelectionClasses();
      updateRoving();
      syncLegend();
      updateHeader();
      // keep the selected card clear of the panel that is opening (visibleRect knows the room it will leave).
      // A refocus places the camera itself; a hidden chart has nothing to show.
      clearTimeout(S.selTimer);
      if (pid && S.layout && !S.host.hidden && S.size.w) {
        const key = keyForPid(pid);
        if (key && key !== S.layout.focusKey && !S.glideTimer && !gesture) ensureVisible(key, { margin: 24 });
      }
    });

    // size: render the first time the view has room, keep the focus visible after resizes
    let resizeTimer = 0;
    new ResizeObserver(entries => {
      const r = entries[entries.length - 1].contentRect;
      const w = Math.round(r.width), h = Math.round(r.height);
      if (!w || !h) return;
      const was = S.size;
      S.size = { w, h };
      if (!S.layout) { firstRender(); return; }
      syncLegend();
      updateHeader();
      if (was.w === w && was.h === h) return;
      // shrinking from the right (the panel docking) keeps the left edge; height changes keep the vertical center
      setCam({ x: S.cam.x, y: S.cam.y + (h - was.h) / 2, k: S.cam.k }, { now: true });
      clearTimeout(resizeTimer);
      // a chart still at its home view re-homes in the new room (the panel docking on a deep link);
      // one the user has moved only keeps the focus card visible
      resizeTimer = setTimeout(() => {
        if (!S.layout || gesture) return;
        syncLegend();
        updateHeader();
        // (at the zoom a running glide is heading for, so a glide already going home isn't restarted)
        const k = S.camTween && S.glideTarget ? S.glideTarget.k : S.cam.k;
        if (S.atHome && !S.tween && (!S.selected || S.selected === S.focus)) glide(homeCam(S.layout, k), 320);
        else ensureVisible(keyForPid(S.selected) || S.layout.focusKey, { margin: 16 });
      }, 200);
    }).observe(S.viewport);
    S.mounted = true;
  }
  function firstRender() {
    const pid = S.pending || App.state.focus || App.ROOT;
    S.pending = null;
    if (!P[pid]) return;
    S.focus = pid;
    const L = layoutChart(pid);
    syncLegend();
    S.cam.k = homeZoom(L);
    render(L, { animate: false });
    S.atHome = true;
    if (S.root) S.root.setAttribute("aria-label", `Pedigree chart centered on ${P[pid].name}`);
  }

  /* ---------------------------------------------------------------- API */
  App.chart = {
    mount(host) { mount(host); },
    /* re-center on pid (animated when the chart is on screen) */
    focus(pid) {
      const id = resolvePid(pid);
      if (!id) return;
      if (!S.mounted || !S.layout || !S.size.w) { S.pending = id; return; }
      refocus(id, { animate: !S.host.hidden });
    },
    /* photos or avatars changed: rebuild the card contents, keep the layout */
    refresh(pid) {
      if (!S.layout) return;
      // rebuilding a card drops keyboard focus with it: hand it back to the chart's tab stop afterwards
      const hadFocus = S.root.contains(document.activeElement) && document.activeElement !== S.root;
      for (const v of S.views.values()) {
        if (pid && v.data.pid !== pid) continue;
        v.sigv = "";
        fillView(v, v.data);
      }
      updateSelectionClasses();
      updateLineClasses();
      updateRoving();
      if (hadFocus && !S.root.contains(document.activeElement)) {
        const v = S.views.get(rovingKey());
        if (v && v.card && v.card.tagName === "BUTTON") v.card.focus({ preventScroll: true });
      }
    },
    /* for tests and tooling */
    get stats() { return { ...S.stats, zoom: S.cam.k, focus: S.focus }; },
    measure(gens = Infinity, sibs = true) {
      const keep = { gens: S.gens, sibs: S.sibs };
      S.gens = gens; S.sibs = sibs;
      const t0 = performance.now();
      const L = layoutChart(S.focus || App.ROOT);
      const ms = performance.now() - t0;
      S.gens = keep.gens; S.sibs = keep.sibs;
      return { ms: +ms.toFixed(2), nodes: L.nodes.size, edges: L.edges.length };
    },
  };
})();
