/* person.js: the person panel. Docked on the right of the tree on desktop, floating over the stage on
   tablets, and a bottom sheet with two snap points on phones. Registers App.person = {mount, show, close}.
   app.js calls show(pid) / close() from the "select" event and toggles .is-open on #person-panel. */
(() => {
  const GALLERY_KINDS = ["photo", "headstone", "document", "story"];
  const GALLERY_LIMIT = 9;        // thumbnails before "Show all"
  const RECORD_LIMIT = 6;         // record rows before "Show all"
  const CITE_LIMIT = 2;           // sources per fact before "N more sources"
  const HALF = 0.45;              // phone half snap: visible share of the viewport
  const LEVEL_LABELS = { error: "Error", duplicate: "Duplicate", check: "To check" };

  let panel = null;               // #person-panel
  let shell = null;               // .pp, the one child of the panel
  let scroller = null;            // .pp-scroll
  let body = null;                // .pp-body (re-rendered per person)
  let barName = null;             // compact name in the top bar (shown once the hero scrolls away)
  let barKicker = null;           // relationship + line in the top bar
  let scrim = null;               // phone scrim
  let current = null;             // pid on show
  let isOpen = false;
  let returnTo = null;            // element to refocus on close
  let snap = "half";              // phone snap: "half" | "full"
  let heroWatch = null;           // IntersectionObserver for the compact bar name
  const expanded = new Set();     // "gallery", "records", "ev:<i>" sections opened by the user (per person)

  const safely = (what, fn) => {
    try { return fn(); } catch (err) { console.error(`[person] ${what} failed:`, err); return undefined; }
  };

  /* ---------------------------------------------------------------- small helpers */
  const editor = () => (App.editor && typeof App.editor === "object" ? App.editor : null);
  const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const firstEvent = (p, ...tags) => {
    for (const t of tags) {
      const e = (p.ev || []).find(x => x.tag === t && (x.date || x.place));
      if (e) return e;
    }
    return null;
  };
  const YEAR = /\b(1[5-9]\d\d|20\d\d)\b/;
  /* the year a record or item is from. A record's own event date wins over m.year, which is sometimes the
     person's birth year (a death certificate indexed by birth year), then m.year, then a year in the title. */
  const EVENT_FIELD = /^(death|burial|marriage|residence|event|registration|arrival|departure|immigration|enlistment|military|obituary|publication|issue|claim|enumerat(ed|ion)|record) (date|year)$/i;
  const yearOf = m => {
    if (!m) return null;
    for (const [label, value] of m.fields || []) {
      if (EVENT_FIELD.test(String(label).trim()) && YEAR.test(value || "")) return +YEAR.exec(value)[1];
    }
    if (m.year) return +m.year;
    const y = YEAR.exec(m.date || "") || YEAR.exec(m.kind === "record" ? m.title || m.coll || "" : "");
    return y ? +y[1] : null;
  };
  const sortByYear = list => list
    .map((m, i) => ({ m, i, y: yearOf(m) }))
    .sort((a, b) => (a.y == null) - (b.y == null) || (a.y || 0) - (b.y || 0) || a.i - b.i)
    .map(x => x.m);
  const byBirth = birthOrder;
  /* places without the country and repeats: "Exeter, Luzerne, Pennsylvania" (full) and "Exeter, Pennsylvania" (brief) */
  const placeParts = place => {
    const out = [];
    for (const s of String(place || "").split(",").map(x => x.trim()).filter(Boolean)) {
      if (/^(usa|united states( of america)?|u\.s\.a\.?)$/i.test(s)) continue;
      if (!out.includes(s)) out.push(s);
    }
    return out;
  };
  const fullPlace = place => placeParts(place).join(", ");
  const briefPlace = place => {
    const parts = placeParts(place);
    return parts.length > 2 ? `${parts[0]}, ${parts[parts.length - 1]}` : parts.join(", ");
  };
  const imageOf = m => (m && m.file !== "pdf" ? m.thumb || m.src || "" : "");
  /* an avatar beside the visible name is decorative: the button already says the name once */
  const decorative = node => { if (node) { node.setAttribute("aria-hidden", "true"); node.removeAttribute("role"); node.removeAttribute("aria-label"); } return node; };

  /* a section: hairline-topped, a tracked-caps label with an optional count, then the content */
  const section = (id, title, count, ...content) => el("section", { class: "pp-section", id: `pp-${id}`, "aria-labelledby": `pp-${id}-title` },
    el("h3", { class: "pp-section-head", id: `pp-${id}-title` },
      el("span", { class: "label label-lg", text: title }),
      count != null && el("span", { class: "pp-count", text: count })),
    content);
  /* "Show all 14" / "Show fewer" under a clipped list */
  const moreButton = (key, total, shown, noun) => total > shown || expanded.has(key)
    ? el("button", {
      class: "pp-more", type: "button", "aria-expanded": String(expanded.has(key)), dataset: { ppKey: `more:${key}` },
      onclick: () => { expanded.has(key) ? expanded.delete(key) : expanded.add(key); rerender(); },
    }, expanded.has(key) ? "Show fewer" : `Show all ${total} ${noun}`, icon(expanded.has(key) ? "chevron-up" : "chevron-down", 16))
    : null;

  /* ---------------------------------------------------------------- the shell */
  function buildShell() {
    barName = el("span", { class: "pp-bar-name", "aria-hidden": "true" });
    barKicker = el("div", { class: "pp-bar-kicker" });
    const handle = el("button", {
      class: "pp-handle", type: "button", "aria-label": "Expand the details",
      onclick: () => setSnap(snap === "full" ? "half" : "full"),
    }, el("span", { class: "pp-handle-bar", "aria-hidden": "true" }));
    const bar = el("div", { class: "pp-bar" },
      el("div", { class: "pp-bar-lead" }, barKicker, barName),
      el("button", {
        class: "btn btn-ghost btn-icon pp-close", type: "button", "aria-label": "Close the details",
        onclick: () => App.select(null),
      }, icon("close", 20)));
    body = el("div", { class: "pp-body" });
    scroller = el("div", { class: "pp-scroll", tabindex: "-1" }, body);
    shell = el("div", { class: "pp" }, el("div", { class: "pp-grab" }, handle, bar), scroller);
    return shell;
  }

  /* ---------------------------------------------------------------- hero */
  function portrait(p, gallery) {
    const photo = photoOf(p);
    const mono = () => el("span", { class: "pp-portrait-initials", "aria-hidden": "true", text: initials(p) });
    if (!photo) {
      return el("div", { class: "pp-portrait is-mono", role: "img", "aria-label": `${p.name} (no photo)` }, mono());
    }
    const img = el("img", {
      src: mediaUrl(photo.url), alt: `Photo of ${p.name}`, decoding: "async", draggable: "false",
      style: p.photoPos ? { objectPosition: p.photoPos } : null,
    });
    const box = el("button", {
      class: "pp-portrait is-photo", type: "button", "aria-label": `Open the photo of ${p.name}`,
      onclick: () => App.openMedia(photo.m.id, gallery.includes(photo.m.id) ? gallery : [photo.m.id]),
    }, img);
    img.addEventListener("error", () => {
      box.replaceWith(el("div", { class: "pp-portrait is-mono", role: "img", "aria-label": p.name }, mono()));
    }, { once: true });
    return box;
  }

  function vitals(p) {
    const rows = [];
    const add = (label, e) => {
      if (!e) return;
      const place = briefPlace(e.place);
      rows.push(el("div", { class: "pp-vital" },
        el("dt", { class: "label", text: label }),
        el("dd", {}, e.date && el("span", { class: "pp-vital-date", text: e.date }), place && el("span", { class: "pp-vital-place", text: place }))));
    };
    const birth = firstEvent(p, "BIRT");
    add(birth ? "Born" : "Baptized", birth || firstEvent(p, "CHR", "BAPM"));
    if (!p.living) {
      const death = firstEvent(p, "DEAT");
      add(death ? "Died" : "Buried", death || firstEvent(p, "BURI"));
    }
    return rows.length ? el("dl", { class: "pp-vitals" }, rows) : null;
  }

  function kicker(p) {
    const line = LINE_NAMES[p.line] || "";
    return el("p", { class: "pp-kicker" },
      el("span", { class: "marker marker-lg", "aria-hidden": "true" }),
      el("span", { class: "pp-kicker-rel", text: p.rel || "Relative" }),
      line && line !== p.rel && el("span", { class: "pp-kicker-line" }, el("span", { text: line })));
  }

  function heroMeta(p) {
    const bits = [];
    if (p.ahn && p.gen) bits.push(p.gen === 0 ? "Direct line" : `Direct ancestor, ${plural(p.gen, "generation")} back`);
    if (p.nsrc) bits.push(plural(p.nsrc, "source"));
    else if (!p.living) bits.push("No sources yet");
    return bits.length ? el("p", { class: "pp-meta", text: bits.join(" · ") }) : null;
  }

  function issueChip(p) {
    const list = issuesOf(p);
    if (!list.length) return null;
    const order = ["error", "duplicate", "check"];
    const worst = order.find(l => list.some(it => it.level === l)) || "check";
    return el("button", {
      class: `pp-issue-chip is-${worst}`, type: "button",
      onclick: () => {
        // scroll only the panel (scrollIntoView would move the page too)
        const target = document.getElementById("pp-issues");
        if (target && scroller) scroller.scrollTo({ top: Math.max(0, target.offsetTop - 8), behavior: reducedMotion() ? "auto" : "smooth" });
      },
    }, el("span", { class: "marker", "aria-hidden": "true" }),
      plural(list.length, "thing to fix", "things to fix"), icon("chevron-down", 14));
  }

  function hero(p, gallery) {
    const yrs = years(p);
    return el("header", { class: "pp-hero", style: { "--lc": lineColor(p) } },
      el("div", { class: ["pp-hero-grid", !firstEvent(p, "BIRT", "CHR", "BAPM", "DEAT", "BURI") && !photoOf(p) && "is-compact"] },
        portrait(p, gallery),
        el("div", { class: "pp-hero-text" },
          el("h2", { class: "pp-name", id: "pp-name", tabindex: "-1", text: p.name }),
          yrs && el("p", { class: "pp-years", text: yrs }),
          vitals(p))),
      heroMeta(p),
      issueChip(p));
  }

  /* ---------------------------------------------------------------- actions */
  /* What the editor says about uploads for pid: {ok: true} or {ok: false, reason: "..."}, or null with no editor.
     canUpload may return a boolean or {ok, reason}. A refusal's text comes from editor.uploadReason(pid) when
     the editor has it. openUpload handles connecting, so a refusal that is only "not connected yet" (no
     reason given and uploadReason says "") still shows the button. */
  function uploadVerdict(pid) {
    const ed = editor();
    if (!ed || typeof ed.openUpload !== "function") return null;
    const p = P[pid];
    let verdict = true;
    if (typeof ed.canUpload === "function") verdict = safely("editor.canUpload", () => ed.canUpload(pid));
    if (verdict && typeof verdict === "object") {
      return verdict.ok ? { ok: true } : { ok: false, reason: verdict.reason || defaultReason() };
    }
    if (verdict) return { ok: true };
    // not connected yet: offer the button only in an editor's browser (openUpload connects first)
    if (typeof ed.offer === "function") {
      if (safely("editor.offer", () => ed.offer(pid))) return { ok: true };
      const said = typeof ed.uploadReason === "function" ? safely("editor.uploadReason", () => ed.uploadReason(pid)) : "";
      // ordinary visitors get neither a button nor an explanation
      return said ? { ok: false, reason: said } : null;
    }
    const said = typeof ed.uploadReason === "function" ? safely("editor.uploadReason", () => ed.uploadReason(pid)) : null;
    if (typeof said === "string" && said) return { ok: false, reason: said };
    if (!p) return { ok: false, reason: defaultReason() };
    return { ok: true };
  }
  const defaultReason = () => "Photos can't be added for this person.";

  function actions(p) {
    const pid = p.id;
    const centered = App.state.focus === pid;
    const buttons = [
      el("button", {
        class: "btn btn-sm btn-primary", type: "button", dataset: { ppKey: "center" },
        title: centered ? "The tree is centered on this person" : null,
        onclick: () => centerHere(pid),
      }, icon("center", 18), el("span", { text: "Center tree here" })),
    ];
    if (App.state.view !== "family" && typeof App.setView === "function") {
      buttons.push(el("button", {
        class: "btn btn-sm", type: "button", dataset: { ppKey: "family" },
        onclick: () => { App.go(pid, { replace: App.state.focus === pid }); App.setView("family"); },
      }, icon("family", 18), el("span", { text: "Show in Family view" })));
    }
    const verdict = uploadVerdict(pid);
    if (verdict && verdict.ok) {
      buttons.push(el("button", {
        class: "btn btn-sm", type: "button", dataset: { ppKey: "upload" },
        onclick: () => safely("editor.openUpload", () => editor().openUpload(pid)),
      }, icon("upload", 18), el("span", { text: "Add photo or document" })));
    }
    return el("div", { class: "pp-actions" },
      el("div", { class: "pp-actions-row" }, buttons),
      verdict && !verdict.ok && el("p", { class: "pp-note" }, icon("info", 16), el("span", { text: verdict.reason })));
  }

  function centerHere(pid) {
    App.go(pid, { replace: App.state.focus === pid && App.state.selected === pid });
    // on a phone the sheet hides the tree, so get out of the way
    if (isPhone()) App.select(null);
  }

  /* ---------------------------------------------------------------- photos */
  function galleryTile(m, list) {
    const label = `${kindLabel(m)}: ${m.title || "untitled"}`;
    const open = () => App.openMedia(m.id, list);
    const url = imageOf(m);
    const badge = m.kind !== "photo" && m.kind !== "story" && el("span", { class: "pp-tile-kind", text: kindLabel(m) });
    if (m.kind === "story") {
      const excerpt = String(m.text || m.desc || "").replace(/\s+/g, " ").trim();
      return el("button", { class: "pp-tile is-story", type: "button", "aria-label": label, title: m.title || "Story", onclick: open },
        el("span", { class: "label", text: "Story" }),
        el("span", { class: "pp-tile-title", text: m.title || "Story" }),
        excerpt && el("span", { class: "pp-tile-excerpt", text: excerpt }));
    }
    if (!url) {
      return el("button", { class: "pp-tile is-file", type: "button", "aria-label": label, title: m.title || "", onclick: open },
        icon("document", 26), el("span", { class: "pp-tile-title", text: m.title || kindLabel(m) }));
    }
    const tile = el("button", { class: "pp-tile is-image", type: "button", "aria-label": label, title: m.title || "", onclick: open });
    const img = el("img", { src: mediaUrl(url), alt: m.title || kindLabel(m), loading: "lazy", decoding: "async", draggable: "false" });
    img.addEventListener("error", () => {
      tile.classList.replace("is-image", "is-file");
      tile.replaceChildren(icon("image", 26), el("span", { class: "pp-tile-title", text: m.title || kindLabel(m) }));
    }, { once: true });
    tile.append(img, badge || "");
    return tile;
  }

  function gallerySection(items) {
    if (!items.length) return null;
    const list = items.map(m => m.id);
    const open = expanded.has("gallery");
    const shown = open ? items : items.slice(0, GALLERY_LIMIT);
    // "Photos" only when that's all it holds; with papers and stories mixed in it's the gallery
    const allPhotos = items.every(m => (m.kind === "photo" || m.kind === "headstone") && m.file !== "pdf");
    return section("photos", allPhotos ? "Photos" : "Gallery", items.length,
      el("div", { class: "pp-grid" }, shown.map(m => galleryTile(m, list))),
      moreButton("gallery", items.length, GALLERY_LIMIT, allPhotos ? "photos" : "items"));
  }

  /* ---------------------------------------------------------------- documents (records) */
  function recordRow(m, list) {
    const url = imageOf(m);
    const thumb = url
      ? el("span", { class: "pp-doc-thumb" }, el("img", { src: mediaUrl(url), alt: "", loading: "lazy", decoding: "async", draggable: "false" }))
      : el("span", { class: "pp-doc-thumb is-icon" }, icon("document", 22));
    const img = thumb.querySelector("img");
    if (img) img.addEventListener("error", () => { thumb.classList.add("is-icon"); thumb.replaceChildren(icon("document", 22)); }, { once: true });
    const year = yearOf(m);
    const coll = m.coll || m.title || kindLabel(m);
    const meta = [year, m.name && `as ${m.name}`].filter(Boolean).join(" · ");
    return el("li", {},
      el("button", { class: "pp-doc", type: "button", "aria-label": `${kindLabel(m)}: ${coll}${year ? `, ${year}` : ""}`, onclick: () => App.openMedia(m.id, list) },
        thumb,
        el("span", { class: "pp-doc-text" },
          el("span", { class: "label pp-doc-type", text: kindLabel(m) }),
          el("span", { class: "pp-doc-title", text: coll }),
          meta && el("span", { class: "pp-doc-meta", text: meta })),
        icon("chevron-right", 18)));
  }

  function recordsSection(records) {
    if (!records.length) return null;
    const list = records.map(m => m.id);
    const open = expanded.has("records");
    const shown = open ? records : records.slice(0, RECORD_LIMIT);
    return section("documents", "Documents", records.length,
      el("ul", { class: "pp-docs" }, shown.map(m => recordRow(m, list))),
      moreButton("records", records.length, RECORD_LIMIT, "documents"));
  }

  /* ---------------------------------------------------------------- life (facts timeline) */
  function cite(s, recordIds) {
    const title = s.t || "Source";
    const detail = s.p && s.p !== s.u ? s.p : null;
    if (s.m && media(s.m)) {
      return el("li", {}, el("button", {
        class: "pp-cite is-record", type: "button", title: detail,
        onclick: () => App.openMedia(s.m, recordIds.includes(s.m) ? recordIds : [s.m]),
      }, icon("document", 15), el("span", { text: title })));
    }
    if (s.u && /^https?:\/\//i.test(s.u)) {
      return el("li", {}, el("a", { class: "pp-cite is-link", href: s.u, target: "_blank", rel: "noopener noreferrer", title: detail },
        icon("external", 15), el("span", { text: title }), el("span", { class: "sr-only", text: " (opens in a new tab)" })));
    }
    return el("li", {}, el("span", { class: "pp-cite is-text", title: detail }, el("span", { class: "pp-cite-dot", "aria-hidden": "true" }), el("span", { text: title })));
  }

  function cites(e, i, recordIds) {
    const src = (e.src || []).filter(s => s && (s.t || s.u));
    if (!src.length) return null;
    const key = `ev:${i}`;
    const open = expanded.has(key);
    const shown = open || src.length <= CITE_LIMIT + 1 ? src : src.slice(0, CITE_LIMIT);
    const rest = src.length - shown.length;
    return el("div", { class: "pp-cites" },
      el("ul", {}, shown.map(s => cite(s, recordIds))),
      (rest > 0 || open) && src.length > CITE_LIMIT + 1 && el("button", {
        class: "pp-cites-more", type: "button", "aria-expanded": String(open), dataset: { ppKey: `cites:${i}` },
        onclick: () => { open ? expanded.delete(key) : expanded.add(key); rerender(); },
      }, open ? "Fewer sources" : `${plural(rest, "more source")}`));
  }

  /* Ancestry often has the same birth or death several times with different places. Consecutive facts with the
     same tag and date become one row: the first place, then "Also recorded" with the others, sources combined. */
  const MERGE_TAGS = new Set(["BIRT", "CHR", "BAPM", "DEAT", "BURI", "MARR"]);
  function mergedEvents(p) {
    const out = [];
    (p.ev || []).forEach((e, i) => {
      if (!(e.date || e.place || e.detail || (e.src || []).length)) return;
      const prev = out[out.length - 1];
      if (prev && MERGE_TAGS.has(e.tag) && prev.e.tag === e.tag && prev.e.date === e.date && !e.detail) {
        const place = fullPlace(e.place);
        if (place && place !== fullPlace(prev.e.place) && !prev.also.includes(place)) prev.also.push(place);
        const seen = new Set(prev.e.src.map(s => `${s.t}|${s.m || s.u || ""}`));
        for (const s of e.src || []) if (!seen.has(`${s.t}|${s.m || s.u || ""}`)) prev.e.src.push(s);
        prev.e.res = prev.e.res || e.res;
        return;
      }
      out.push({ e: { ...e, src: [...(e.src || [])] }, i, also: [] });
    });
    return out;
  }

  function lifeSection(p, recordIds) {
    const events = mergedEvents(p);
    if (!events.length) return null;
    return section("life", "Life", null,
      el("ol", { class: "pp-life" }, events.map(({ e, i, also }) => {
        const place = fullPlace(e.place);
        return el("li", { class: ["pp-fact", e.res && "is-research", !e.date && "is-undated", (e.tag === "BIRT" || e.tag === "DEAT") && "is-key"] },
          el("span", { class: "pp-fact-date", text: e.date || "" }),
          el("div", { class: "pp-fact-main" },
            el("p", { class: "pp-fact-head" },
              el("span", { class: "pp-fact-label", text: e.label || e.tag || "Fact" }),
              e.res && el("span", { class: "pp-badge", title: "From research beyond the Ancestry tree", text: "Research" })),
            place && el("p", { class: "pp-fact-place", title: e.place !== place ? e.place : null, text: place }),
            also.length > 0 && el("p", { class: "pp-fact-also" }, el("span", { class: "label", text: "Also recorded" }), also.join("; ")),
            e.detail && el("p", { class: "pp-fact-detail", text: e.detail }),
            cites(e, i, recordIds)));
      })));
  }

  /* ---------------------------------------------------------------- family */
  function relRow(pid, { note = "", key = "" } = {}) {
    const p = P[pid];
    if (!p) return null;
    const meta = [years(p), p.rel].filter(Boolean).join(" · ");
    return el("li", {},
      el("button", {
        class: "pp-rel", type: "button", style: { "--lc": lineColor(p) }, dataset: { ppKey: `rel:${key}${pid}` },
        onclick: () => App.go(pid, { focus: false }),
      },
        decorative(avatar(p, { size: 36, decorative: true })),
        el("span", { class: "pp-rel-text" },
          el("span", { class: "pp-rel-name", text: p.name }),
          meta && el("span", { class: "pp-rel-meta", text: meta }),
          note && el("span", { class: "pp-rel-note", text: note })),
        icon("chevron-right", 18)));
  }
  const unknownRow = text => el("li", {}, el("div", { class: "pp-rel is-unknown" },
    el("span", { class: "pp-rel-blank", "aria-hidden": "true" }),
    el("span", { class: "pp-rel-text" }, el("span", { class: "pp-rel-name", text }))));
  const group = (title, rows) => {
    const items = rows.filter(Boolean);
    return items.length ? el("div", { class: "pp-fam-group" },
      el("h4", { class: "label", text: title }),
      el("ul", { class: "pp-rels" }, items)) : null;
  };
  const marriageNote = (p, fam) => {
    const spouse = fam.spouse && P[fam.spouse];
    if (!fam.marr) return "";
    return `Married ${fam.marr}`;
  };

  function familySection(p) {
    const fams = p.fams || [];
    const father = p.father && P[p.father], mother = p.mother && P[p.mother];
    const parents = group("Parents", father || mother ? [
      father ? relRow(p.father, { key: "f" }) : unknownRow("Father not recorded"),
      mother ? relRow(p.mother, { key: "m" }) : unknownRow("Mother not recorded"),
    ] : [unknownRow("Parents not recorded")]);
    const spouseRows = fams.filter(f => f.spouse && P[f.spouse]).map(f => relRow(f.spouse, { note: marriageNote(p, f), key: "s" }));
    const withKids = fams.filter(f => (f.kids || []).some(k => P[k]));
    const childGroups = withKids.map(f => {
      const other = f.spouse && P[f.spouse];
      const title = withKids.length > 1 ? (other ? `Children with ${firstName(other)}` : "Children, other parent not recorded") : "Children";
      return group(title, byBirth(f.kids.filter(k => P[k])).map(k => relRow(k, { key: "c" })));
    });
    const sibs = byBirth((p.sibs || []).filter(s => P[s] && s !== p.id));
    const content = [
      parents,
      group(spouseRows.length > 1 ? "Spouses" : "Spouse", spouseRows),
      childGroups,
      group(sibs.length === 1 ? "Sibling" : "Siblings", sibs.map(s => relRow(s, { key: "b" }))),
    ].flat().filter(Boolean);
    return section("family", "Family", null, el("div", { class: "pp-family" }, content));
  }

  /* ---------------------------------------------------------------- local-only issues */
  function issuesOf(p) {
    if (D.public || !Array.isArray(D.issues)) return [];
    return (p.issues || []).map(i => D.issues[i]).filter(Boolean);
  }
  function issuesSection(p) {
    const list = issuesOf(p);
    if (!list.length) return null;
    return section("issues", "Things to fix", list.length, list.map(it => {
      const level = LEVEL_LABELS[it.level] ? it.level : "check";
      const others = (it.people || []).filter(x => x !== p.id && P[x]);
      return el("article", { class: `pp-issue is-${level}` },
        el("p", { class: "label pp-issue-level", text: LEVEL_LABELS[level] }),
        el("h4", { class: "pp-issue-title", text: it.title || "Something to check" }),
        it.body && el("p", { class: "pp-issue-body", text: it.body }),
        it.fix && el("p", { class: "pp-issue-fix" }, el("strong", { text: "Fix: " }), it.fix),
        others.length > 0 && el("p", { class: "pp-issue-people" },
          el("span", { class: "label", text: "Also involves" }),
          others.map(x => el("button", { class: "pp-issue-person", type: "button", onclick: () => App.go(x, { focus: false }) }, P[x].name))));
    }));
  }

  /* ---------------------------------------------------------------- render */
  function render(pid, { keepScroll = false } = {}) {
    const p = P[pid];
    if (!p || !body) return;
    const all = personMedia(pid);
    const gallery = all.filter(m => GALLERY_KINDS.includes(m.kind));
    const records = sortByYear(all.filter(m => m.kind === "record"));
    const recordIds = records.map(m => m.id);
    const galleryIds = gallery.map(m => m.id);

    // remember what had focus so a re-render doesn't drop it
    const active = document.activeElement;
    const hadFocus = !!(active && shell.contains(active));
    const focusKey = hadFocus && active.dataset ? active.dataset.ppKey : null;
    const top = scroller.scrollTop;

    body.replaceChildren(...[
      hero(p, galleryIds),
      actions(p),
      gallerySection(gallery),
      recordsSection(records),
      lifeSection(p, recordIds),
      familySection(p),
      issuesSection(p),
    ].filter(Boolean));
    barName.textContent = p.name;
    barKicker.replaceChildren(kicker(p));
    shell.style.setProperty("--lc", lineColor(p));
    shell.dataset.pid = pid;
    scroller.scrollTop = keepScroll ? top : 0;
    if (!keepScroll && !reducedMotion()) {
      body.classList.remove("is-entering");
      void body.offsetWidth;
      body.classList.add("is-entering");
    }
    onScroll();
    if (hadFocus) {
      const again = focusKey && body.querySelector(`[data-pp-key="${CSS.escape(focusKey)}"]`);
      (again || $("#pp-name", body) || scroller).focus({ preventScroll: true });
    }
  }
  function rerender() { if (current) safely("render", () => render(current, { keepScroll: true })); }

  function onScroll() {
    if (!scroller) return;
    const y = scroller.scrollTop;
    const name = body && $("#pp-name", body);
    shell.classList.toggle("is-scrolled", y > 2);
    shell.classList.toggle("show-name", !!name && y > name.offsetTop + name.offsetHeight - 12);
  }

  /* ---------------------------------------------------------------- phone sheet: snaps, drag, scrim, lock */
  const sheetHeight = () => panel.getBoundingClientRect().height || window.innerHeight * 0.92;
  const offsetFor = name => (name === "full" ? 0 : Math.max(0, Math.round(sheetHeight() - window.innerHeight * HALF)));

  function setSnap(name) {
    snap = name === "full" ? "full" : "half";
    if (!panel) return;
    panel.style.setProperty("--sheet-y", `${offsetFor(snap)}px`);
    panel.dataset.snap = snap;
    if (scrim) scrim.style.opacity = "";
    const handle = $(".pp-handle", shell);
    if (handle) {
      handle.setAttribute("aria-label", snap === "full" ? "Shrink the details" : "Expand the details");
      handle.setAttribute("aria-expanded", String(snap === "full"));
    }
  }

  /* sheet chrome follows the breakpoint: modal sheet on phones, plain panel elsewhere */
  function applyChrome() {
    const sheet = isOpen && isPhone();
    document.documentElement.classList.toggle("pp-sheet-open", sheet);
    if (scrim) scrim.hidden = !sheet;
    if (sheet) {
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-modal", "true");
    } else {
      panel.removeAttribute("role");
      panel.removeAttribute("aria-modal");
    }
  }

  let drag = null;
  function beginDrag(y) {
    const from = parseFloat(panel.style.getPropertyValue("--sheet-y"));
    const start = Number.isFinite(from) ? from : offsetFor(snap);
    drag = { startY: y, start, off: start, lastY: y, lastT: performance.now(), v: 0, moved: false };
    panel.classList.add("pp-dragging");
  }
  function moveDrag(y) {
    if (!drag) return;
    const now = performance.now();
    const dt = Math.max(1, now - drag.lastT);
    drag.v = 0.7 * ((y - drag.lastY) / dt) + 0.3 * drag.v;   // px per ms, positive = down
    drag.lastY = y;
    drag.lastT = now;
    let off = drag.start + (y - drag.startY);
    if (off < 0) off = off / 4;                                // resist past fully open
    drag.off = off;
    drag.moved = drag.moved || Math.abs(y - drag.startY) > 4;
    panel.style.setProperty("--sheet-y", `${off}px`);
    const half = offsetFor("half"), h = sheetHeight();
    if (scrim) scrim.style.opacity = String(Math.max(0, Math.min(1, (h - off) / Math.max(1, h - half))));
  }
  /* where a drag lands: a fling or a drag of more than 56px moves one snap in that direction (from full down
     to half, from half down to closed); a short slow drag returns to the nearest snap */
  function endDrag() {
    if (!drag) return false;
    const { off, v, moved, start } = drag;
    drag = null;
    panel.classList.remove("pp-dragging");
    if (!moved) { setSnap(snap); return false; }
    const half = offsetFor("half"), h = sheetHeight();
    const dist = off - start;
    let target;
    if (v > 0.5 || (dist > 56 && v > -0.1)) target = snap === "full" && off < half + 48 ? "half" : "close";
    else if (v < -0.5 || (dist < -56 && v < 0.1)) target = "full";
    else if (off > half + (h - half) * 0.4) target = "close";
    else target = off < half / 2 ? "full" : "half";
    if (target === "close") App.select(null);
    else setSnap(target);
    return true;
  }

  /* the grab strip (handle + bar) drags with any pointer. Moves are tracked on window, because the sheet
     only starts following after a few pixels and the pointer may already be over the scrim by then. */
  function wireGrab(grab) {
    let pointer = null, suppressClick = false;
    const onMove = e => {
      if (!pointer || e.pointerId !== pointer.id) return;
      if (!pointer.started) {
        if (Math.abs(e.clientY - pointer.y) < 6) return;
        pointer.started = true;
        beginDrag(pointer.y);
      }
      if (e.cancelable) e.preventDefault();
      moveDrag(e.clientY);
    };
    const onUp = e => {
      if (!pointer || e.pointerId !== pointer.id) return;
      if (pointer.started) suppressClick = endDrag();
      pointer = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    grab.addEventListener("pointerdown", e => {
      if (!isPhone() || !isOpen || pointer || (e.pointerType === "mouse" && e.button !== 0)) return;
      pointer = { id: e.pointerId, y: e.clientY, started: false };
      suppressClick = false;
      window.addEventListener("pointermove", onMove, { passive: false });
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    });
    // a drag that started on a button must not also click it
    grab.addEventListener("click", e => {
      if (suppressClick) { e.preventDefault(); e.stopPropagation(); suppressClick = false; }
    }, true);
  }

  /* on the content, touch drags move the sheet when the content can't scroll that way:
     pulling down at the top, or pushing up while the sheet is half open */
  function wireContentTouch() {
    let t = null;
    scroller.addEventListener("touchstart", e => {
      if (!isPhone() || !isOpen || e.touches.length !== 1) { t = null; return; }
      t = { x: e.touches[0].clientX, y: e.touches[0].clientY, mode: null };
    }, { passive: true });
    scroller.addEventListener("touchmove", e => {
      if (!t || e.touches.length !== 1) return;
      const x = e.touches[0].clientX, y = e.touches[0].clientY;
      if (!t.mode) {
        const dx = x - t.x, dy = y - t.y;
        if (Math.abs(dy) < 6 && Math.abs(dx) < 6) return;
        const vertical = Math.abs(dy) > Math.abs(dx);
        const sheetWins = vertical && ((dy > 0 && scroller.scrollTop <= 0) || (dy < 0 && snap === "half"));
        t.mode = sheetWins ? "sheet" : "scroll";
        if (sheetWins) beginDrag(t.y);
      }
      if (t.mode === "sheet") {
        if (e.cancelable) e.preventDefault();
        moveDrag(y);
      }
    }, { passive: false });
    const done = () => { if (t && t.mode === "sheet") endDrag(); t = null; };
    scroller.addEventListener("touchend", done);
    scroller.addEventListener("touchcancel", done);
  }

  /* ---------------------------------------------------------------- keyboard */
  function onKeydown(e) {
    if (!isOpen || e.defaultPrevented) return;
    if (e.key === "Escape") {
      if (App.state.media) return;                                    // the viewer closes first
      const t = e.target;
      if (t && t.closest && t.closest("#topbar, .search-sheet, .menu-panel, [role='dialog']:not(#person-panel), dialog")) return;
      if (document.querySelector("dialog[open], [aria-modal='true']:not(#person-panel):not([hidden])")) return;
      e.preventDefault();
      App.select(null);
      return;
    }
    // the phone sheet is modal: keep Tab inside it
    if (e.key === "Tab" && isPhone() && panel.contains(document.activeElement)) {
      const items = $$("button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])", shell).filter(n => n.offsetParent !== null);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || !items.includes(document.activeElement))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  /* ---------------------------------------------------------------- open / close */
  function show(pid) {
    const p = P[pid];
    if (!p || !shell) return;
    const wasOpen = isOpen;
    const active = document.activeElement;
    if (pid !== current) expanded.clear();
    if (!wasOpen) {
      returnTo = active && active !== document.body && !panel.contains(active) ? active : null;
      if (isPhone()) setSnap("half");
    }
    const switching = pid !== current || !wasOpen;
    current = pid;
    isOpen = true;
    panel.inert = false;
    panel.removeAttribute("aria-hidden");
    safely("render", () => render(pid, { keepScroll: !switching }));
    applyChrome();
    // take focus on open, except from the tree's own keyboard navigation (arrows keep moving the selection)
    const fromTree = active && active.closest && active.closest(".tree-views");
    if (!wasOpen && (isPhone() || !fromTree)) {
      const target = $("#pp-name", body) || scroller;
      requestAnimationFrame(() => { if (isOpen && current === pid) target.focus({ preventScroll: true }); });
    }
  }

  /* a sensible place for focus when the panel closes and nothing opened it: the active view's focus card
     (chart: the card in the tab order; family: the focus person's card), then the search box */
  function fallbackFocus() {
    const visible = n => !!n && !n.closest("[hidden], [inert]") && n.getClientRects().length > 0;
    const view = document.getElementById(App.state.view === "family" ? "family-view" : "chart-view");
    const candidates = view ? [$('.ch-card[tabindex="0"]', view), $(".fv-focus button", view)] : [];
    // never a text field on touch screens: focusing it would pop up the keyboard
    if (!window.matchMedia("(pointer: coarse)").matches) candidates.push(document.getElementById("site-search"));
    candidates.push($("#topbar button"));
    return candidates.find(visible) || null;
  }

  function close() {
    if (!shell || !isOpen) return;
    isOpen = false;
    applyChrome();
    const active = document.activeElement;
    const focusInside = active && (panel.contains(active) || active === document.body);
    panel.inert = true;
    panel.setAttribute("aria-hidden", "true");
    if (focusInside) {
      // back where the panel was opened from; opened from search (the typeahead blurs itself) or a shared link,
      // there's nothing to go back to, so focus the tree's card for the focused person, else the search box
      const back = returnTo && returnTo.isConnected && !panel.contains(returnTo) && returnTo.getClientRects().length ? returnTo : fallbackFocus();
      if (back) { try { back.focus({ preventScroll: true }); } catch (err) { /* went away */ } }
    }
    returnTo = null;
    current = null;
    drag = null;
    panel.classList.remove("pp-dragging");
  }

  /* ---------------------------------------------------------------- mount */
  function mount(target) {
    panel = target;
    panel.replaceChildren(buildShell());
    panel.inert = true;
    panel.setAttribute("aria-hidden", "true");
    scrim = el("div", { class: "pp-scrim", hidden: true, "aria-hidden": "true", onclick: () => App.select(null) });
    document.body.append(scrim);
    // the scrim never scrolls the page underneath
    scrim.addEventListener("touchmove", e => { if (e.cancelable) e.preventDefault(); }, { passive: false });
    scroller.addEventListener("scroll", onScroll, { passive: true });
    // a wheel or trackpad scroll on the half-open sheet opens it fully first
    scroller.addEventListener("wheel", e => { if (isOpen && isPhone() && snap === "half" && e.deltaY > 0) setSnap("full"); }, { passive: true });
    wireGrab($(".pp-grab", shell));
    wireContentTouch();
    document.addEventListener("keydown", onKeydown);
    window.addEventListener("resize", () => { if (isOpen && isPhone() && !drag) setSnap(snap); });
    PHONE_QUERY.addEventListener("change", () => { applyChrome(); if (isOpen && isPhone()) setSnap(snap); });
    App.on("media", () => { if (isOpen) rerender(); });
    App.on("view", () => { if (isOpen) rerender(); });
  }

  App.person = { mount, show, close };
})();
