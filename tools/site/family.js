/* family.js: the Family view. A vertical mini-tree that fits the width of a phone with no sideways panning:
   grandparents as two couples, then the parents, the focus person large, a strip of brothers and sisters in
   birth order (the focus in its place), then each marriage with its children. Tap a card to move there;
   tap the focus card to open the person sheet. Moves are animated (FLIP): the tapped card travels into the
   focus position while the rest cross-fades. Swipe the focus card sideways to step through siblings.
   Registers App.family = {mount(el), focus(pid), refresh()}. Styles: family.css (prefix fv-). */
(() => {
  const MAX_TRAIL = 6;               // breadcrumbs: the last few people visited
  const MOVE_MS = 500, FADE_MS = 280, GHOST_MS = 220;
  const EASE = "cubic-bezier(.22, .68, .24, 1)";

  let rootEl = null;                 // .fv (position: relative; fills #family-view)
  let scroller = null;               // .fv-scroll (the vertical scroller)
  let overlay = null;                // .fv-overlay (holds the outgoing content while it fades)
  let crumbsEl = null;               // .fv-crumbs
  let content = null;                // .fv-content (rebuilt for each focus)
  let liveEl = null;                 // polite announcement for screen readers
  let current = null;                // pid on show
  let trail = [];                    // breadcrumb pids, oldest first
  let pending = null;                // {pid, rect, dir} recorded by a tap or swipe just before App.go
  let running = [];                  // animations to cancel if another move starts
  let resizeObs = null;
  let resizeFrame = 0;
  let inner = null;                  // .fv-inner: the centered column (max 720px)
  let skipNextMotion = false;        // set by a view switch: app.js fades the view in itself

  const noMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const person = pid => (pid && P[pid]) || null;

  /* ------------------------------------------------------------ family helpers */
  const birthYear = p => (p && !isHidden(p) && p.by) || null;

  /* the focus and their brothers and sisters in birth order. Ties and unknown years keep the order the
     parents' family lists them in (the GEDCOM order), so living people on the public page stay in place. */
  function siblingsInOrder(p) {
    const ids = [p.id, ...(p.sibs || [])].filter((id, i, a) => P[id] && a.indexOf(id) === i);
    let order = ids;
    for (const parent of [person(p.father), person(p.mother)]) {
      const fam = parent && (parent.fams || []).find(f => (f.kids || []).includes(p.id));
      if (fam) {
        const listed = fam.kids.filter(k => ids.includes(k));
        order = [...listed, ...ids.filter(k => !listed.includes(k))];
        break;
      }
    }
    const at = new Map(order.map((id, i) => [id, i]));
    return order.slice().sort((a, b) => {
      const ya = birthYear(P[a]), yb = birthYear(P[b]);
      if (ya && yb && ya !== yb) return ya - yb;
      return at.get(a) - at.get(b);
    });
  }

  const spouseWord = s => (s && s.sex === "F" ? "Wife" : s && s.sex === "M" ? "Husband" : "Spouse");
  const childWord = c => (c && c.sex === "F" ? "Daughter" : c && c.sex === "M" ? "Son" : "Child");
  const parentWord = (sex, fallback) => (sex === "F" ? "Mother" : sex === "M" ? "Father" : fallback);
  const ordinal = n => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

  /* "7 Sep 1946 · Philadelphia, Pennsylvania" (or just one of them). Never for a couple where either is
     living on the public page (the build already blanks it there; this keeps it so). */
  function marriageText(p, fam) {
    const spouse = person(fam.spouse);
    if (isHidden(p) || isHidden(spouse)) return "";
    const parts = String(fam.marr || "").split("·").map(s => s.trim()).filter(Boolean);
    if (!parts.length) return "";
    const [first, ...rest] = parts;
    if (!/\d/.test(first)) return shortPlace(parts.join(", "));
    return [first, shortPlace(rest.join(", "))].filter(Boolean).join(" · ");
  }

  function mediaCounts(pid) {
    const items = personMedia(pid);
    const photos = items.filter(m => m.kind === "photo" || m.kind === "headstone").length;
    return { photos, docs: items.length - photos };
  }

  /* ------------------------------------------------------------ cards */
  /* Every person card is a <button> keyed by pid (data-key), so a move can find where each person was.
     data-go is the pid to move to; data-open marks the focus (opens the person sheet instead). */
  function nameBlock(p, { full = false, surname = false } = {}) {
    const first = firstName(p);
    const sur = (p.surname || "").trim();
    return [
      el("span", { class: "fv-name", text: full ? p.name : first }),
      surname && sur && !full ? el("span", { class: "fv-surname", text: sur }) : null,
    ];
  }
  function yearsText(p) {
    return years(p) || "Dates unknown";
  }
  function ariaFor(p, role) {
    const y = years(p);
    return [p.name, y, role].filter(Boolean).join(", ");
  }

  /* small card: 40px avatar, first name (and surname for grandparents), years. Grandparents, siblings, children. */
  function smallCard(p, { role = "", surname = false, key = p.id, current = false, cls = "" } = {}) {
    return el("button", {
      type: "button",
      class: ["fv-card", "fv-sm", current && "is-current", isHidden(p) && "is-living", cls],
      style: { "--lc": lineColor(p) },
      dataset: { key, pid: p.id, ...(current ? { open: "1" } : { go: p.id }) },
      "aria-label": current ? `${ariaFor(p, role)}. Shown above. Open the profile` : `${ariaFor(p, role)}. Show their family`,
      "aria-current": current ? "true" : null,
      title: p.name,
    },
    avatar(p, { size: 40 }),
    el("span", { class: "fv-text" },
      nameBlock(p, { surname }),
      el("span", { class: "fv-years", text: years(p) || "No dates" })));
  }

  /* medium card: 48px avatar, role label, full name, years. Parents and spouses. */
  function mediumCard(p, { role = "", key = p.id, cls = "" } = {}) {
    return el("button", {
      type: "button",
      class: ["fv-card", "fv-md", isHidden(p) && "is-living", cls],
      style: { "--lc": lineColor(p) },
      dataset: { key, pid: p.id, go: p.id },
      "aria-label": `${ariaFor(p, role)}. Show their family`,
      title: p.name,
    },
    avatar(p, { size: 48 }),
    el("span", { class: "fv-text" },
      role ? el("span", { class: "fv-role label", text: role }) : null,
      nameBlock(p, { full: true }),
      el("span", { class: "fv-years", text: yearsText(p) })));
  }

  /* dashed placeholder for someone not recorded (not a button: there is nowhere to go) */
  function placeholder(text, { size = "sm", cls = "" } = {}) {
    return el("div", { class: ["fv-ph", `fv-ph-${size}`, "fv-x", cls], role: "note", "aria-label": text },
      el("span", { class: "fv-ph-box", "aria-hidden": "true", text: "?" }),
      el("span", { class: "fv-ph-text", text }));
  }

  /* the large focus card: 96px photo or monogram, full name, years and birthplace, relationship and line,
     photo and document counts. Tapping it opens the person sheet. Swipe it sideways to step through siblings. */
  function focusCard(p) {
    const hidden = isHidden(p);
    const place = hidden ? "" : shortPlace(p.bp);
    const lineName = LINE_KEYS.includes(p.line) ? LINE_NAMES[p.line] : "";   // not "Immediate family"
    let counts;
    if (hidden) counts = [el("span", { text: "Details of living people are private" })];
    else {
      const c = mediaCounts(p.id);
      counts = [
        c.photos ? el("span", { class: "fv-count" }, icon("image", 16), plural(c.photos, "photo")) : null,
        c.docs ? el("span", { class: "fv-count" }, icon("document", 16), plural(c.docs, "document")) : null,
      ].filter(Boolean);
      if (!counts.length) counts = [el("span", { text: "No photos or documents yet" })];
    }
    return el("button", {
      type: "button",
      class: ["fv-card", "fv-lg", hidden && "is-living"],
      style: { "--lc": lineColor(p) },
      dataset: { key: p.id, pid: p.id, open: "1" },
      "aria-label": `${ariaFor(p, p.rel)}. Open the profile`,
    },
    el("span", { class: "fv-lg-main" },
      avatar(p, { size: 96 }),
      el("span", { class: "fv-lg-text" },
        p.rel || lineName ? el("span", { class: "fv-kicker" },
          el("span", { class: "marker", "aria-hidden": "true" }),
          el("span", { class: "fv-kicker-text" },
            p.rel ? el("span", { class: "label fv-rel", text: p.rel }) : null,
            lineName ? el("span", { class: "label fv-line", text: lineName }) : null)) : null,
        el("span", { class: "fv-lg-name", text: p.name }),
        el("span", { class: "fv-lg-meta" },
          el("span", { class: "fv-lg-years", text: yearsText(p) }),
          place ? el("span", { class: "fv-lg-place", text: place }) : null))),
    el("span", { class: "fv-lg-foot" },
      el("span", { class: "fv-counts" }, counts),
      el("span", { class: "fv-open" }, el("span", { text: "Profile" }), icon("chevron-right", 16))));
  }

  const join = (cls = "") => el("div", { class: ["fv-join", "fv-x", cls], "aria-hidden": "true" });

  /* row 1: the four grandparents as two couples. Left out when neither parent is known. */
  function grandparentsRow(p) {
    const father = person(p.father), mother = person(p.mother);
    if (!father && !mother) return null;
    const couple = (parent, side) => {
      const label = el("span", { class: "fv-couple-label label fv-x", text: `${side}'s parents` });
      const gf = parent && person(parent.father), gm = parent && person(parent.mother);
      // an unknown parent, or a known parent whose own parents aren't recorded: one quiet box, not two
      if (!gf && !gm) {
        return el("div", { class: "fv-couple is-unknown" }, label,
          el("div", { class: "fv-couple-cards" }, placeholder("Not recorded", { size: "wide" })),
          join("is-dashed"));
      }
      const side2 = side.toLowerCase();
      return el("div", { class: "fv-couple" }, label,
        el("div", { class: "fv-couple-cards" },
          gf ? smallCard(gf, { surname: true, role: `grandfather, ${side2}'s side` }) : placeholder("Unknown"),
          gm ? smallCard(gm, { surname: true, role: `grandmother, ${side2}'s side` }) : placeholder("Unknown")),
        join(gf || gm ? "" : "is-dashed"));
    };
    return el("div", { class: "fv-row fv-gp" }, couple(father, "Father"), couple(mother, "Mother"));
  }

  /* row 2: father and mother, joined to the focus below */
  function parentsRow(p) {
    const father = person(p.father), mother = person(p.mother);
    return [
      el("div", { class: "fv-row fv-parents" },
        father ? mediumCard(father, { role: "Father" }) : placeholder("Father unknown", { size: "md" }),
        mother ? mediumCard(mother, { role: "Mother" }) : placeholder("Mother unknown", { size: "md" })),
      join(father || mother ? "fv-join-wide" : "fv-join-wide is-dashed"),
    ];
  }

  /* row 4: brothers and sisters in birth order, the focus in its place. Scroll-snap strip. */
  function siblingsSection(p) {
    const order = siblingsInOrder(p);
    if (order.length <= 1) {
      return el("section", { class: "fv-section fv-sibs is-empty fv-x", "aria-label": "Brothers and sisters" },
        el("p", { class: "fv-note", text: "No brothers or sisters recorded." }));
    }
    const at = order.indexOf(p.id);
    const step = (pid, dir, word, ic) => el("button", {
      type: "button", class: "btn btn-icon btn-sm btn-ghost fv-step",
      disabled: !pid,
      "aria-label": pid ? `${word}: ${P[pid].name}` : `No ${word.toLowerCase()} brother or sister`,
      title: pid ? `${word}: ${P[pid].name}` : null,
      dataset: pid ? { go: pid, step: String(dir) } : null,
    }, icon(ic, 18));
    const sibWord = s => (s.sex === "F" ? "sister" : s.sex === "M" ? "brother" : "sibling");
    return el("section", { class: "fv-section fv-sibs", "aria-label": "Brothers and sisters" },
      el("div", { class: "fv-head fv-x" },
        el("h3", { class: "label fv-head-title", text: "Brothers and sisters" }),
        el("span", { class: "fv-head-meta", text: `${ordinal(at + 1)} of ${order.length}` }),
        el("span", { class: "fv-steps" },
          step(order[at - 1], -1, "Older", "chevron-left"),
          step(order[at + 1], 1, "Younger", "chevron-right"))),
      el("div", { class: "fv-strip", role: "list", onscroll: e => stripEdges(e.currentTarget) },
        order.map(id => el("div", { class: "fv-strip-item", role: "listitem" },
          id === p.id
            ? smallCard(P[id], { current: true, key: `sib:${id}`, role: "this person" })
            : smallCard(P[id], { role: sibWord(P[id]) })))));
  }

  /* row 5: each marriage (or partnership) with the spouse, the marriage date and place, and the children */
  function familiesSection(p) {
    const fams = (p.fams || []).filter(f => person(f.spouse) || (f.kids || []).some(k => P[k]));
    if (!fams.length) {
      return el("section", { class: "fv-section fv-fams is-empty fv-x", "aria-label": "Spouse and children" },
        el("p", { class: "fv-note", text: "No spouse or children recorded." }));
    }
    return el("section", { class: "fv-section fv-fams", "aria-label": "Spouse and children" },
      fams.map((fam, i) => {
        const spouse = person(fam.spouse);
        const kids = (fam.kids || []).map(person).filter(Boolean);
        const at = new Map(kids.map((k, j) => [k.id, j]));
        kids.sort((a, b) => {
          const ya = birthYear(a), yb = birthYear(b);
          return ya && yb && ya !== yb ? ya - yb : at.get(a.id) - at.get(b.id);
        });
        const title = (spouse ? "Marriage" : "Family") + (fams.length > 1 ? ` ${i + 1} of ${fams.length}` : "");
        const marr = marriageText(p, fam);
        return el("div", { class: "fv-fam" },
          el("div", { class: "fv-head fv-x" }, el("h3", { class: "label fv-head-title", text: title })),
          el("div", { class: "fv-row fv-spouse" },
            spouse ? mediumCard(spouse, { role: spouseWord(spouse) }) : placeholder("Spouse not recorded", { size: "md" }),
            marr ? el("div", { class: "fv-marr fv-x" },
              el("span", { class: "label", text: "Married" }),
              marr.split(" · ").map((part, j) => el("span", { class: j ? "fv-marr-place" : "fv-marr-date", text: part }))) : null),
          kids.length
            ? [el("div", { class: "fv-subhead fv-x" },
                el("span", { class: "label", text: "Children" }),
                el("span", { class: "fv-head-meta", text: String(kids.length) })),
              el("div", { class: "fv-kids", role: "list" },
                kids.map(k => el("div", { class: "fv-kid", role: "listitem" }, smallCard(k, { role: childWord(k).toLowerCase() }))))]
            : el("p", { class: "fv-note fv-x", text: "No children recorded." }));
      }));
  }

  /* the end of the view: the rest of the page is below the tree, and on a phone this view fills the screen */
  function moreRow() {
    const go = id => e => {
      e.preventDefault();
      // App.goSection renders the section first (Research and Everyone render lazily), then scrolls to it
      if (typeof App.goSection === "function") { App.goSection(id); return; }
      const nav = document.querySelector(`a[data-section="${id}"]`);
      if (nav) nav.click();
      else { const t = document.getElementById(id); if (t) t.scrollIntoView({ block: "start" }); }
    };
    const link = (id, text) => el("a", { class: "fv-more-link", href: `#${id}`, onclick: go(id) }, text, icon("arrow-right", 16));
    return el("nav", { class: "fv-more fv-x", "aria-label": "More on this page" },
      el("span", { class: "label", text: "More" }),
      link("lines", "The four lines"), link("research", "Research"), link("everyone", "Everyone"));
  }

  function build(p) {
    return el("div", { class: "fv-content" },
      grandparentsRow(p),
      parentsRow(p),
      el("div", { class: "fv-focus" }, focusCard(p)),
      siblingsSection(p),
      familiesSection(p),
      moreRow());
  }

  /* ------------------------------------------------------------ breadcrumbs */
  function updateTrail(pid) {
    const i = trail.indexOf(pid);
    if (i >= 0) trail = trail.slice(0, i + 1);   // going back to someone on the trail trims it there
    else trail.push(pid);
    if (trail.length > MAX_TRAIL) trail = trail.slice(-MAX_TRAIL);
  }
  function renderCrumbs() {
    const items = trail.filter(id => P[id]);
    crumbsEl.hidden = items.length < 2;
    if (crumbsEl.hidden) { crumbsEl.replaceChildren(); return; }
    crumbsEl.replaceChildren(el("ol", { class: "fv-crumbs-list" }, items.map((id, i) => {
      const p = P[id], last = i === items.length - 1;
      return el("li", { class: "fv-crumb" },
        last
          ? el("span", { class: "fv-crumb-here", "aria-current": "location", title: p.name }, avatar(p, { size: 22 }), el("span", { text: firstName(p) }))
          : el("button", { type: "button", class: "fv-crumb-btn", dataset: { go: id }, title: p.name, "aria-label": `Back to ${p.name}` },
              avatar(p, { size: 22 }), el("span", { text: firstName(p) })),
        last ? null : el("span", { class: "fv-crumb-sep", "aria-hidden": "true" }, icon("chevron-right", 14)));
    })));
    requestAnimationFrame(() => {
      crumbsEl.classList.toggle("is-overflow", crumbsEl.scrollWidth > crumbsEl.clientWidth + 1);
      crumbsEl.scrollLeft = crumbsEl.scrollWidth;
    });
  }

  /* ------------------------------------------------------------ rendering and the move animation */
  function stopAnimations() {
    for (const a of running) { try { a.cancel(); } catch (e) { /* already gone */ } }
    running = [];
    if (overlay) overlay.replaceChildren();
    if (content) for (const n of content.querySelectorAll(".is-moving")) n.classList.remove("is-moving");
  }
  function play(node, frames, opts) {
    const a = node.animate(frames, { fill: "backwards", ...opts });
    running.push(a);
    a.finished.then(() => { running = running.filter(x => x !== a); }, () => {});
    return a;
  }

  /* fade the strip's edges only on the sides that have more to scroll */
  function stripEdges(strip) {
    const max = strip.scrollWidth - strip.clientWidth;
    strip.classList.toggle("more-left", max > 1 && strip.scrollLeft > 1);
    strip.classList.toggle("more-right", max > 1 && strip.scrollLeft < max - 1);
  }
  /* keep the current sibling in the middle of the strip (no animation) */
  function centerStrip(root) {
    const strip = root && root.querySelector(".fv-strip");
    const here = strip && strip.querySelector(".is-current");
    if (!here) return;
    const item = here.parentElement;
    strip.scrollLeft = Math.max(0, item.offsetLeft - strip.offsetLeft - (strip.clientWidth - item.offsetWidth) / 2);
    stripEdges(strip);
  }

  /* where to scroll after a move: as little as possible (keeping the grandparents and parents) while the
     focus card and the first row of brothers and sisters are on screen; at most until the focus card's top
     sits just under the breadcrumbs, which stick to the top of the view on phones */
  function targetScroll(root) {
    const card = root.querySelector(".fv-lg");
    if (!card) return 0;
    const box = scroller.getBoundingClientRect(), y = n => n.getBoundingClientRect();
    const at = r => r - box.top + scroller.scrollTop;
    const top = at(y(card).top);
    const strip = root.querySelector(".fv-strip .fv-card") || root.querySelector(".fv-sibs .fv-note");
    const bottom = at(y(strip || card).bottom);
    const view = scroller.clientHeight;
    const stuck = crumbsEl && !crumbsEl.hidden && getComputedStyle(crumbsEl).position === "sticky" ? crumbsEl.offsetHeight : 0;
    // and clear of the "more below" cue at the bottom, when it shows
    const cue = cueEl && getComputedStyle(cueEl).display !== "none" ? cueEl.offsetHeight - 8 : 16;
    if (bottom + cue <= view) return 0;
    return Math.max(0, Math.min(bottom + cue - view, top - stuck - 8));
  }

  /* the bottom cue: a fade and a "Brothers and sisters ↓" / "Children ↓" button while those sections are
     below the fold (tapping it scrolls them up under the breadcrumbs) */
  let cueEl = null, cueTarget = null, cueFrame = 0;
  function updateCue() {
    cueFrame = 0;
    if (!cueEl || !content) return;
    const box = scroller.getBoundingClientRect(), fold = box.bottom - 56;
    let target = null, label = "";
    const sibs = content.querySelector(".fv-sibs:not(.is-empty)");
    const fams = content.querySelector(".fv-fams");
    if (sibs && sibs.getBoundingClientRect().top + 60 > fold) { target = sibs; label = "Brothers and sisters"; }
    else if (fams && fams.getBoundingClientRect().top + 60 > fold) {
      const kids = fams.querySelector(".fv-kids"), spouse = fams.querySelector(".fv-spouse [data-go]");
      // "No spouse or children recorded" isn't worth a button
      if (kids || spouse) { target = fams; label = kids ? "Children" : "Spouse"; }
    }
    cueTarget = target;
    cueEl.classList.toggle("is-on", !!target);
    if (target) cueEl.querySelector(".fv-cue-text").textContent = label;
  }
  const queueCue = () => { if (!cueFrame) cueFrame = requestAnimationFrame(updateCue); };
  function scrollToCue() {
    if (!cueTarget) return;
    const box = scroller.getBoundingClientRect();
    const stuck = crumbsEl && !crumbsEl.hidden && getComputedStyle(crumbsEl).position === "sticky" ? crumbsEl.offsetHeight : 0;
    const top = cueTarget.getBoundingClientRect().top - box.top + scroller.scrollTop - stuck - 8;
    scroller.scrollTo({ top: Math.max(0, top), behavior: noMotion() ? "auto" : "smooth" });
  }

  function render(pid, { animate = false, keepScroll = false } = {}) {
    const p = person(pid) || person(App.ROOT);
    if (!p || !scroller) return;
    const move = pending && pending.pid === p.id ? pending : null;
    pending = null;
    stopAnimations();
    // keyboard users keep their place: the new focus card takes focus (a tap leaves focus alone)
    const active = document.activeElement;
    let hadKeyboard = false;
    try { hadKeyboard = rootEl.contains(active) && active.matches(":focus-visible"); } catch (e) { /* old browser */ }
    const old = content;
    const motion = animate && old && !noMotion() && rootEl.getClientRects().length > 0 && rootEl.offsetWidth > 0;
    let snap = null;
    if (motion) {
      snap = { keys: new Map(), strip: new Map(), box: old.getBoundingClientRect(), root: rootEl.getBoundingClientRect() };
      for (const n of old.querySelectorAll("[data-key]")) {
        const rec = { rect: n.getBoundingClientRect(), node: n };
        if (!snap.keys.has(n.dataset.key)) snap.keys.set(n.dataset.key, rec);
        if (n.closest(".fv-strip")) snap.strip.set(n.dataset.pid, rec);
      }
      snap.extras = [...old.querySelectorAll(".fv-x")].filter(n => !n.closest("[data-key]"));
      snap.rects = new Map(snap.extras.map(n => [n, n.getBoundingClientRect()]));
    }
    const prevScroll = scroller.scrollTop;
    const prevFocus = current;
    current = p.id;
    renderCrumbs();
    const next = build(p);
    if (old) old.replaceWith(next); else inner.append(next);
    content = next;
    centerStrip(next);
    scroller.scrollTop = keepScroll ? prevScroll : targetScroll(next);
    if (prevFocus && prevFocus !== p.id) liveEl.textContent = `Showing the family of ${p.name}`;
    if (hadKeyboard) {
      const card = next.querySelector(".fv-lg");
      if (card) card.focus({ preventScroll: true });
    }
    if (motion) animateMove(old, next, snap, move);
    queueCue();
  }

  /* identity of a label, connector or placeholder: what it is, what it says and where it sits */
  const extraSig = (node, r) => `${node.className}|${node.textContent}|${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`;

  /* move a card from its old box to its new one. The scale is uniform (around the centers) so names never
     stretch; a card that changes size a lot also fades up a little on the way. */
  function flip(node, from, hero = false) {
    const to = node.getBoundingClientRect();
    if (!to.width || !to.height) return;
    const dx = (from.left + from.width / 2) - (to.left + to.width / 2);
    const dy = (from.top + from.height / 2) - (to.top + to.height / 2);
    const s = Math.min(3, Math.max(.3, Math.sqrt((from.width / to.width) * (from.height / to.height))));
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(s - 1) < .01) return;
    node.classList.add("is-moving");
    const big = !hero && Math.abs(Math.log(s)) > .45;
    const a = play(node, [
      { transform: `translate(${dx}px, ${dy}px) scale(${s})`, opacity: big ? .35 : 1 },
      { transform: "none", opacity: 1 },
    ], { duration: MOVE_MS, easing: EASE });
    const done = () => node.classList.remove("is-moving");
    a.finished.then(done, done);
  }
  function fadeIn(node, delay = 110) {
    play(node, [{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }],
      { duration: FADE_MS, delay, easing: "ease-out" });
  }

  /* FLIP: everyone who was on screen before moves from where they were to where they are now; the tapped
     card travels into the focus position; new people and the labels and connectors fade in, while the
     outgoing content (in the overlay, exactly where it was) fades out. A swipe slides the focus instead. */
  function animateMove(old, next, snap, move) {
    const swipe = move && move.dir ? move : null;
    const used = new Set();
    const take = rec => (rec && !used.has(rec.node) ? (used.add(rec.node), rec.rect) : null);

    for (const node of next.querySelectorAll("[data-key]")) {
      const key = node.dataset.key;
      let from = null;
      if (node.classList.contains("fv-lg")) {
        if (swipe) {
          play(node, [{ opacity: 0, transform: `translateX(${swipe.dir * 38}%)` }, { opacity: 1, transform: "none" }],
            { duration: MOVE_MS - 60, easing: EASE });
          continue;
        }
        from = move && move.node ? take({ rect: move.rect, node: move.node }) : take(snap.keys.get(key));
      } else if (node.closest(".fv-strip")) {
        // strip cards slide within the strip, even if their old card also became the focus card
        const rec = snap.strip.get(node.dataset.pid);
        if (rec) { used.add(rec.node); from = rec.rect; }
        else if (!swipe) from = take(snap.keys.get(key));
      } else {
        from = take(snap.keys.get(key));
      }
      if (from) flip(node, from, node.classList.contains("fv-lg"));
      else fadeIn(node);
    }
    // labels, connectors, notes and placeholders: the ones that didn't change or move stay put
    const still = new Map();
    for (const node of snap.extras) {
      const sig = extraSig(node, snap.rects.get(node));
      still.set(sig, node);
    }
    for (const node of next.querySelectorAll(".fv-x")) {
      if (node.closest("[data-key]")) continue;
      const twin = still.get(extraSig(node, node.getBoundingClientRect()));
      if (twin) used.add(twin);
      else fadeIn(node, 90);
    }

    // the outgoing content: pinned where it was, people who moved hidden, the rest fading out
    old.classList.add("fv-ghost");
    Object.assign(old.style, {
      left: `${snap.box.left - snap.root.left}px`, top: `${snap.box.top - snap.root.top}px`, width: `${snap.box.width}px`,
    });
    for (const n of used) if (old.contains(n)) n.style.visibility = "hidden";
    const oldStrip = old.querySelector(".fv-strip"), stripScroll = oldStrip ? oldStrip.scrollLeft : 0;
    overlay.append(old);
    if (oldStrip) oldStrip.scrollLeft = stripScroll;   // re-parenting resets it
    if (swipe) {
      const card = old.querySelector(".fv-lg");
      if (card) {
        play(card, [{ transform: card.style.transform || "none", opacity: 1 }, { transform: `translateX(${-swipe.dir * 105}%)`, opacity: 0 }],
          { duration: MOVE_MS - 80, easing: EASE, fill: "forwards" });
      }
    }
    const out = play(old, [{ opacity: 1 }, { opacity: 0 }], { duration: swipe ? MOVE_MS - 80 : GHOST_MS, easing: "ease-out", fill: "forwards" });
    out.finished.then(() => old.remove(), () => {});
  }

  /* ------------------------------------------------------------ input */
  let swallowClick = false;          // a swipe ends with a click on the card; ignore that one

  /* move to pid. From a tap the card's rect is the start of the move; from a swipe or step, dir = ±1 */
  function goTo(pid, how = {}) {
    if (!P[pid] || pid === current) return;
    pending = { pid, ...how };
    // browsing doesn't pop the sheet open; if it is already open it follows along
    App.go(pid, { select: !!App.state.selected });
  }

  function onClick(e) {
    if (swallowClick) { swallowClick = false; e.preventDefault(); return; }
    const t = e.target.closest("[data-go], [data-open]");
    if (!t || !rootEl.contains(t)) return;
    if (t.dataset.open) { App.select(current); return; }
    const pid = t.dataset.go;
    if (t.dataset.step) goTo(pid, { dir: Number(t.dataset.step) });
    else goTo(pid, { rect: t.getBoundingClientRect(), node: t });
  }

  function siblingStep(dir) {
    const p = person(current);
    if (!p) return null;
    const order = siblingsInOrder(p);
    return order[order.indexOf(current) + dir] || null;
  }

  /* arrows: ←/→ older/younger sibling, ↑ father (Shift+↑ mother), ↓ first child. Only while a card has focus. */
  function onKey(e) {
    if (e.altKey || e.ctrlKey || e.metaKey || !e.target.closest || !e.target.closest(".fv-card, .fv-crumb-btn, .fv-step")) return;
    const p = person(current);
    if (!p) return;
    let pid = null, how = {};
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const dir = e.key === "ArrowLeft" ? -1 : 1;
      pid = siblingStep(dir);
      how = { dir };
    } else if (e.key === "ArrowUp") {
      pid = e.shiftKey ? p.mother || p.father : p.father || p.mother;
    } else if (e.key === "ArrowDown") {
      // back down to the child we came from, else the eldest child
      const kids = (p.fams || []).flatMap(f => f.kids || []).filter(k => P[k]);
      const cameFrom = trail[trail.length - 2];
      pid = kids.includes(cameFrom) ? cameFrom
        : kids.slice().sort((a, b) => (birthYear(P[a]) || 9999) - (birthYear(P[b]) || 9999))[0] || null;
    } else return;
    e.preventDefault();
    if (!pid || !P[pid]) return;
    if (!how.dir && content) {
      const node = content.querySelector(`[data-key="${CSS.escape(pid)}"]`);
      if (node) how = { rect: node.getBoundingClientRect(), node };
    }
    goTo(pid, how);
  }

  /* swipe the focus card left (younger) or right (older); it follows the finger and springs back if the
     swipe is too short or there is nobody that way. touch-action: pan-y keeps vertical scrolling native. */
  function wireSwipe() {
    let drag = null;
    scroller.addEventListener("pointerdown", e => {
      const card = e.target.closest(".fv-lg");
      if (!card || (e.pointerType === "mouse" && e.button !== 0)) return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, card, dx: 0, active: false, vx: 0, lastX: e.clientX, lastT: e.timeStamp };
    });
    scroller.addEventListener("pointermove", e => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.active) {
        if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { drag = null; return; }
        if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
        drag.active = true;
        drag.prev = siblingStep(-1);
        drag.next = siblingStep(1);
        drag.card.classList.add("is-dragging");
        try { drag.card.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
      }
      const toward = dx < 0 ? drag.next : drag.prev;
      drag.dx = toward ? dx : dx * .22;      // rubber-band when there's nobody that way
      drag.card.style.transform = `translateX(${drag.dx}px)`;
      const dt = Math.max(1, e.timeStamp - drag.lastT);
      drag.vx = (e.clientX - drag.lastX) / dt;
      drag.lastX = e.clientX;
      drag.lastT = e.timeStamp;
    });
    const end = e => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag;
      drag = null;
      if (!d.active) return;
      d.card.classList.remove("is-dragging");
      swallowClick = true;
      setTimeout(() => { swallowClick = false; }, 400);
      const toward = d.dx < 0 ? d.next : d.prev;
      const far = Math.abs(d.dx) > Math.min(90, d.card.offsetWidth * .22);
      const flick = Math.abs(d.vx) > .45 && Math.abs(d.dx) > 24 && Math.sign(d.vx) === Math.sign(d.dx);
      if (e.type !== "pointercancel" && toward && (far || flick)) {
        goTo(toward, { dir: d.dx < 0 ? 1 : -1 });
      } else {
        const from = d.card.style.transform;
        d.card.style.transform = "";
        if (from && !noMotion()) d.card.animate([{ transform: from }, { transform: "none" }], { duration: 260, easing: EASE });
      }
    };
    scroller.addEventListener("touchstart", () => {}, { passive: true });   // lets iOS show :active on cards
    scroller.addEventListener("pointerup", end);
    scroller.addEventListener("pointercancel", end);
  }

  /* ------------------------------------------------------------ module */
  function mount(host) {
    scroller = el("div", { class: "fv-scroll" });
    inner = el("div", { class: "fv-inner" });
    crumbsEl = el("nav", { class: "fv-crumbs", "aria-label": "Recently viewed", hidden: true });
    overlay = el("div", { class: "fv-overlay", "aria-hidden": "true" });
    liveEl = el("p", { class: "sr-only", "aria-live": "polite" });
    cueEl = el("div", { class: "fv-cue", "aria-hidden": "true" },
      el("button", { type: "button", class: "fv-cue-btn", tabindex: "-1", onclick: scrollToCue },
        el("span", { class: "fv-cue-text" }), icon("chevron-down", 16)));
    inner.append(crumbsEl);
    scroller.append(inner);
    scroller.addEventListener("scroll", queueCue, { passive: true });
    rootEl = el("div", { class: "fv", onclick: onClick, onkeydown: onKey }, scroller, overlay, cueEl, liveEl);
    host.replaceChildren(rootEl);
    wireSwipe();
    if (window.ResizeObserver) {
      resizeObs = new ResizeObserver(() => {
        cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(() => { centerStrip(content); updateCue(); });
      });
      resizeObs.observe(rootEl);
    }
    // a view switch shows this view with app.js's own fade, so the next focus() shouldn't also animate
    App.on("view", name => { if (name === "family") skipNextMotion = true; });
    const start = resolvePid(App.state.focus) || App.ROOT;
    trail = [start];
    render(start);
  }
  function focus(pid) {
    if (!rootEl) return;
    const id = resolvePid(pid) || App.ROOT;
    const animate = !skipNextMotion;
    skipNextMotion = false;
    if (id === current) { pending = null; return; }
    updateTrail(id);
    render(id, { animate });
  }

  function refresh() {
    if (rootEl && current) render(current, { keepScroll: true });
  }

  App.family = { mount, focus, refresh };
})();
