/* app.js: loads last. Renders the page shell and sections, mounts the modules, wires the events
   and applies the initial hash. Every module mount runs in its own try/catch. */
(() => {
  const root = P[App.ROOT] || { name: "Michael", id: App.ROOT };
  const LOCAL = !D.public;
  const ISSUES = (LOCAL && Array.isArray(D.issues)) ? D.issues : [];
  const LEVELS = { error: "Error", duplicate: "Duplicate", check: "Check" };
  const LEVEL_PLURAL = { error: "Errors", duplicate: "Duplicates", check: "To check" };
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const PHOTO_KINDS = ["photo", "headstone"];
  const DOC_KINDS = ["record", "document", "story"];

  const safely = (what, fn) => {
    try { return fn(); } catch (err) { console.error(`[app] ${what} failed:`, err); return undefined; }
  };
  /* the export date comes from the GEDCOM in UTC and can read a day after the (local) build date, so the page
     names only its month: "7 Nov 2026" -> "November 2026" */
  const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const monthYear = d => {
    const m = /(?:^|\s)([A-Za-z]{3})[a-z]*\.?\s+(\d{4})\s*$/.exec(String(d || ""));
    const i = m ? MONTHS.indexOf(m[1].charAt(0).toUpperCase() + m[1].slice(1, 3).toLowerCase()) : -1;
    return i >= 0 ? `${MONTH_NAMES[i]} ${m[2]}` : (d || "–");
  };
  const formatDate = iso => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
    return m ? `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}` : (iso || "");
  };
  const mark = () => el("span", { class: "wordmark-mark", "aria-hidden": "true" },
    LINE_KEYS.map(k => el("span", { style: { "--lc": `var(--${k})` } })));
  const wordmark = (tag = "a") => el(tag, { class: "wordmark", href: tag === "a" ? "#tree" : null, "aria-label": "Harkins Family, back to the tree",
    onclick: tag === "a" ? e => { e.preventDefault(); App.scrollToTree(); } : null },
    mark(), el("span", { class: "wordmark-text" },
      el("span", { class: "wordmark-name", text: "Harkins Family" }),
      el("span", { class: "wordmark-sub", text: "Family tree" })));
  /* a person link: tiny avatar, name, years -> App.go */
  const plink = (pid, { years: showYears = true, size = 22 } = {}) => {
    const p = P[pid];
    if (!p) return null;
    const y = showYears ? years(p) : "";
    return el("button", { class: "plink", type: "button", onclick: () => App.go(pid, { scroll: true }) },
      avatar(p, { size, decorative: true }), el("span", { class: "plink-name", text: p.name }), y && el("span", { class: "plink-years", text: y }));
  };
  const counts = pid => ({
    photos: personMedia(pid, PHOTO_KINDS).length,
    docs: personMedia(pid, DOC_KINDS).length,
  });

  /* ================================================================ top bar */
  const NAV = [
    { id: "tree", label: "Tree" },
    { id: "lines", label: "Lines" },
    { id: "research", label: "Research" },
    ...(ISSUES.length ? [{ id: "fix", label: "To fix", count: ISSUES.length }] : []),
    { id: "everyone", label: "Everyone" },
  ];
  const goSection = id => {
    if (id === "tree") { App.scrollToTree(); return; }
    renderRest();
    const target = document.getElementById(id);
    if (target) target.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  };
  App.goSection = goSection;
  const navLinks = () => NAV.map(n => el("a", {
    href: `#${n.id}`, dataset: { section: n.id },
    onclick: e => { e.preventDefault(); closeMenu(); goSection(n.id); },
  }, n.label, n.count ? el("span", { class: "nav-count", "aria-label": `${n.count} items`, text: n.count }) : null));

  /* theme: auto / light / dark, remembered in localStorage */
  const THEMES = [
    { id: "auto", label: "Match system", icon: "auto" },
    { id: "light", label: "Light", icon: "sun" },
    { id: "dark", label: "Dark", icon: "moon" },
  ];
  const THEME_COLORS = { light: "#f3f0e9", dark: "#11100e" };
  let themeMode = ["light", "dark"].includes(store.get("hft.theme")) ? store.get("hft.theme") : "auto";
  const themeToggles = [];
  function applyTheme(mode, { save = true } = {}) {
    themeMode = mode;
    const html = document.documentElement;
    if (mode === "auto") html.removeAttribute("data-theme"); else html.setAttribute("data-theme", mode);
    $$('meta[name="theme-color"]').forEach(m => {
      const scheme = /dark/.test(m.media) ? "dark" : "light";
      m.setAttribute("content", THEME_COLORS[mode === "auto" ? scheme : mode]);
    });
    if (save) store.set("hft.theme", mode === "auto" ? null : mode);
    themeToggles.forEach(group => $$("button", group).forEach(b => b.setAttribute("aria-pressed", String(b.dataset.theme === mode))));
    if (save) App.emit("theme", mode);
  }
  const themeToggle = (extra = "") => {
    const group = el("div", { class: `seg seg-sm seg-icons theme-toggle ${extra}`, role: "group", "aria-label": "Color theme" },
      THEMES.map(t => el("button", {
        type: "button", dataset: { theme: t.id }, title: t.label, "aria-label": t.id === "auto" ? "Theme: match system" : `Theme: ${t.label.toLowerCase()}`,
        "aria-pressed": String(t.id === themeMode), onclick: () => applyTheme(t.id),
      }, icon(t.icon, 16))));
    themeToggles.push(group);
    return group;
  };

  /* search typeahead, used by the bar search and the phone search sheet */
  let taCount = 0;
  /* typeahead(input, list, {limit, onPick, onMore}): onMore(q) adds a last row "Show all N in Everyone" when
     more people match than the list shows. Escape clears the text first; with nothing to clear it lets the
     key through, so the sheet or page around it can close. */
  const MORE = "__more";
  function typeahead(input, list, { limit = 8, onPick, onMore } = {}) {
    const id = `ta-${++taCount}`;
    list.id = id;
    list.classList.add("typeahead");
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-label", "People");
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-controls", id);
    input.setAttribute("aria-expanded", "false");
    let results = [], active = -1;
    const keepOpen = list.dataset.static === "true";
    const highlight = (name, q) => {
      const terms = fold(q).split(" ").filter(Boolean);
      const out = [];
      for (const word of name.split(/(\s+)/)) {
        const f = fold(word);
        const t = terms.find(t => f.startsWith(t));
        if (t && /\S/.test(word)) out.push(el("mark", { text: word.slice(0, t.length) }), word.slice(t.length));
        else out.push(word);
      }
      return out;
    };
    const setActive = i => {
      active = i;
      $$(".typeahead-item", list).forEach((li, j) => li.setAttribute("aria-selected", String(j === i)));
      const cur = list.children[i + (list.querySelector(".typeahead-head") ? 1 : 0)];
      if (i >= 0 && cur) { input.setAttribute("aria-activedescendant", cur.id); cur.scrollIntoView({ block: "nearest" }); }
      else input.removeAttribute("aria-activedescendant");
    };
    const close = () => {
      if (!keepOpen) list.hidden = true;
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
      active = -1;
    };
    const pick = pid => {
      if (!pid) return;
      if (pid === MORE) {
        const q = input.value;
        input.value = "";
        results = [];
        render();
        close();
        if (onMore) onMore(q);
        return;
      }
      input.value = "";
      results = [];
      render();
      close();
      if (onPick) onPick(pid);
    };
    function render() {
      const q = input.value;
      const all = onMore ? search(q, Infinity) : search(q, limit);
      results = all.slice(0, limit);
      if (all.length > limit) results.push(MORE);
      if (!q.trim()) { list.replaceChildren(); close(); return; }
      list.replaceChildren(
        ...(results.length ? results.map((pid, i) => {
          if (pid === MORE) return el("li", {
            class: "typeahead-item typeahead-more", role: "option", id: `${id}-${i}`, "aria-selected": "false",
            onmousedown: e => e.preventDefault(), onclick: () => pick(MORE),
            onmousemove: () => { if (active !== i) setActive(i); },
          }, el("span", { class: "ta-more-icon", "aria-hidden": "true" }, icon("users", 18)),
            el("span", { class: "ta-name", text: `Show all ${all.length} in Everyone` }),
            icon("arrow-right", 16));
          const p = P[pid];
          return el("li", {
            class: "typeahead-item", role: "option", id: `${id}-${i}`, "aria-selected": "false", dataset: { pid },
            onmousedown: e => e.preventDefault(),   // keep focus in the input so blur doesn't close first
            onclick: () => pick(pid),
            onmousemove: () => { if (active !== i) setActive(i); },
          },
            avatar(p, { size: 36, decorative: true }),
            el("span", { style: "min-width:0;display:grid;gap:2px" },
              el("span", { class: "ta-name" }, highlight(p.name, q)),
              el("span", { class: "ta-rel", text: [p.rel, LINE_NAMES[p.line]].filter(Boolean).join(" · ") })),
            el("span", { class: "ta-years", text: years(p) }));
        }) : [el("li", { class: "typeahead-empty", role: "presentation", text: `Nobody in the tree matches “${q.trim()}”.` })]));
      list.hidden = false;
      input.setAttribute("aria-expanded", "true");
      setActive(results.length ? 0 : -1);
    }
    input.addEventListener("input", render);
    input.addEventListener("focus", () => { if (input.value.trim()) render(); });
    input.addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== input) close(); }, 120));
    input.addEventListener("keydown", e => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (list.hidden || !results.length) { if (input.value.trim()) render(); return; }
        e.preventDefault();
        const n = results.length;
        setActive(e.key === "ArrowDown" ? (active + 1) % n : (active - 1 + n) % n);
      } else if (e.key === "Enter") {
        if (results.length) { e.preventDefault(); pick(results[Math.max(0, active)]); }
      } else if (e.key === "Escape") {
        // handled here only when there was something to clear or close; otherwise the key goes on to the
        // search sheet (which closes) or the page
        if (input.value) { e.preventDefault(); e.stopPropagation(); input.value = ""; render(); }
        else if (!keepOpen && !list.hidden) { e.preventDefault(); e.stopPropagation(); close(); }
        else if (!keepOpen) input.blur();
      }
    });
    if (!keepOpen) list.hidden = true;
    return { render, close };
  }

  /* modal(parts, onClose): while a menu or sheet is open, Escape closes it and Tab / Shift+Tab wrap around
     the focusable controls in parts (elements, in tab order); focus that lands anywhere else is pulled back.
     Returns the function that removes the listeners. */
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  function modal(parts, onClose) {
    const inside = n => parts.some(p => p && p.contains(n));
    const stops = () => parts.flatMap(p => p ? [...(p.matches(FOCUSABLE) ? [p] : []), ...$$(FOCUSABLE, p)] : [])
      .filter(n => n.getClientRects().length && !n.closest("[hidden]"));
    const onKey = e => {
      if (e.key === "Escape") {
        if (e.defaultPrevented) return;
        e.preventDefault();
        onClose();
      } else if (e.key === "Tab") {
        const f = stops();
        if (!f.length) return;
        // the parts needn't be neighbours in the DOM (the menu button sits in the bar), so step through the list
        const i = f.indexOf(document.activeElement);
        e.preventDefault();
        const n = f.length;
        f[i < 0 ? (e.shiftKey ? n - 1 : 0) : (i + (e.shiftKey ? n - 1 : 1)) % n].focus();
      }
    };
    const onFocusIn = e => {
      if (inside(e.target)) return;
      const f = stops();
      if (f.length) f[0].focus();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocusIn);
    };
  }

  /* phone menu and phone search sheet */
  let menuEl = null, scrimEl = null, sheetEl = null, lastFocus = null, menuToggle = null, releaseMenu = null, releaseSheet = null;
  const menuButton = () => $('[data-action="menu"]');
  function closeMenu({ restore = false } = {}) {
    if (!menuEl) return;
    if (releaseMenu) { releaseMenu(); releaseMenu = null; }
    menuEl.remove(); scrimEl && scrimEl.remove();
    menuEl = scrimEl = null;
    // the menu's theme toggle goes with it
    const i = themeToggles.indexOf(menuToggle);
    if (i >= 0) themeToggles.splice(i, 1);
    menuToggle = null;
    const b = menuButton();
    if (b) {
      b.setAttribute("aria-expanded", "false"); b.setAttribute("aria-label", "Menu"); b.replaceChildren(icon("menu", 22));
      if (restore && b.getClientRects().length) b.focus();
    }
  }
  function openMenu() {
    closeSearchSheet();
    if (menuEl) { closeMenu({ restore: true }); return; }
    scrimEl = el("div", { class: "scrim is-under-bar", onclick: () => closeMenu() });
    menuToggle = themeToggle();
    menuEl = el("div", { class: "menu-panel", id: "site-menu", role: "dialog", "aria-modal": "true", "aria-label": "Menu" },
      el("nav", { "aria-label": "Sections" }, navLinks().map(a => { a.append(icon("chevron-right", 18)); return a; })),
      el("div", { class: "menu-theme" }, el("span", { class: "label", text: "Theme" }), menuToggle));
    document.body.append(scrimEl, menuEl);
    const b = menuButton();
    if (b) { b.setAttribute("aria-expanded", "true"); b.setAttribute("aria-label", "Close menu"); b.replaceChildren(icon("close", 22)); }
    // the menu button (now "Close menu") stays in the loop, ahead of the panel, as it is on screen
    releaseMenu = modal([b, menuEl], () => closeMenu({ restore: true }));
    const first = $("a", menuEl);
    if (first) first.focus();
  }
  function closeSearchSheet() {
    if (!sheetEl) return;
    if (releaseSheet) { releaseSheet(); releaseSheet = null; }
    sheetEl.remove();
    sheetEl = null;
    document.documentElement.style.overflow = "";
    if (lastFocus && lastFocus.isConnected && lastFocus !== document.body) lastFocus.focus();
  }
  function openSearchSheet() {
    closeMenu();
    if (sheetEl) return;
    lastFocus = document.activeElement;
    const input = el("input", { class: "input", type: "search", placeholder: "Search everyone by name or place", autocomplete: "off", spellcheck: "false", enterkeyhint: "go", "aria-label": "Search people" });
    const list = el("ul", { dataset: { static: "true" } });
    sheetEl = el("div", { class: "search-sheet", role: "dialog", "aria-modal": "true", "aria-label": "Search people" },
      el("div", { class: "search-sheet-bar" },
        el("label", { class: "input-icon" }, icon("search", 18), input),
        el("button", { class: "btn btn-ghost btn-icon", type: "button", "aria-label": "Close search", onclick: closeSearchSheet }, icon("close", 22))),
      list);
    document.body.append(sheetEl);
    document.documentElement.style.overflow = "hidden";
    releaseSheet = modal([sheetEl], closeSearchSheet);
    typeahead(input, list, {
      limit: 30, onPick: pid => { closeSearchSheet(); App.go(pid, { scroll: true }); },
      onMore: q => { closeSearchSheet(); showInEveryone(q); },
    });
    requestAnimationFrame(() => input.focus());
  }

  function renderTopbar() {
    const input = el("input", {
      class: "input", id: "site-search", type: "search", placeholder: "Find a person", autocomplete: "off", spellcheck: "false",
      "aria-label": "Find a person in the tree",
    });
    const list = el("ul", { hidden: true });
    const bar = el("div", { class: "topbar-inner" },
      wordmark(),
      el("nav", { class: "topnav", "aria-label": "Sections" }, navLinks()),
      el("div", { class: "topbar-search", role: "search" },
        el("label", { class: "input-icon" }, icon("search", 18), input, el("span", { class: "kbd", "aria-hidden": "true", text: "/" })),
        list),
      el("div", { class: "topbar-actions" }, themeToggle()),
      el("div", { class: "topbar-phone" },
        el("button", { class: "btn btn-ghost btn-icon", type: "button", "aria-label": "Search people", dataset: { action: "search" }, onclick: openSearchSheet }, icon("search", 22)),
        el("button", { class: "btn btn-ghost btn-icon", type: "button", "aria-label": "Menu", "aria-expanded": "false", "aria-controls": "site-menu", dataset: { action: "menu" }, onclick: openMenu }, icon("menu", 22))));
    $("#topbar").replaceChildren(bar);
    typeahead(input, list, {
      limit: 8, onPick: pid => { input.blur(); App.go(pid, { scroll: true }); },
      onMore: q => { input.blur(); showInEveryone(q); },
    });

    // "/" focuses the search, Escape closes the phone menu
    document.addEventListener("keydown", e => {
      const t = e.target;
      const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (isPhone() || getComputedStyle($(".topbar-search")).display === "none") openSearchSheet();
        else input.focus();
        e.preventDefault();
      }
    });
    PHONE_QUERY.addEventListener("change", () => { closeMenu(); closeSearchSheet(); });

    // mark the section in view in the nav
    if ("IntersectionObserver" in window) {
      const seen = new Map();
      const io = new IntersectionObserver(entries => {
        entries.forEach(en => seen.set(en.target.id, en.isIntersecting));
        const current = NAV.map(n => n.id).filter(id => seen.get(id)).pop() || "tree";
        $$(".topnav a, .menu-panel a").forEach(a => a.setAttribute("aria-current", String(a.dataset.section === current)));
      }, { rootMargin: "-40% 0px -55% 0px" });
      NAV.forEach(n => { const s = document.getElementById(n.id); if (s) io.observe(s); });
    }
  }

  /* ================================================================ tree shell */
  const VIEWS = {
    chart: { label: "Chart", icon: "tree", title: "Pedigree chart" },
    family: { label: "Family", icon: "family", title: "Family view" },
  };
  const module = name => App[name];
  let viewChoice = ["chart", "family"].includes(store.get("hft.view")) ? store.get("hft.view") : null;

  function placeholder(view, text) {
    return el("div", { class: "tree-placeholder" },
      mark(),
      el("strong", { text: VIEWS[view] ? VIEWS[view].title : "The tree" }),
      el("p", { text }));
  }
  function setView(name, { remember = false, initial = false } = {}) {
    if (!VIEWS[name]) return;
    if (remember) { viewChoice = name; store.set("hft.view", name); }
    const changed = App.state.view !== name;
    App.state.view = name;
    Object.keys(VIEWS).forEach(v => {
      const on = v === name;
      const mount = document.getElementById(`${v}-view`);
      if (mount) {
        mount.hidden = !on;
        if (on && changed && !initial) { mount.classList.remove("is-entering"); void mount.offsetWidth; mount.classList.add("is-entering"); }
      }
      const tools = App.toolbar(v);
      if (tools) tools.hidden = !on;
    });
    $$("#view-switch button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.view === name)));
    $("#tree").dataset.view = name;
    if (initial || !changed) return;
    App.emit("view", name);
    const mod = module(name);
    if (mod && typeof mod.focus === "function") safely(`${name}.focus`, () => mod.focus(App.state.focus));
  }
  App.setView = (name, opts = {}) => setView(name, { remember: true, ...opts });

  function updateFocusUi() {
    const f = P[App.state.focus];
    const label = $("#tree-focus-label");
    if (label) {
      const on = f && App.state.focus !== App.ROOT;
      label.replaceChildren(...(on ? ["Centered on ", el("b", { text: f.name })] : []));
      if (on) label.title = `Centered on ${f.name}`; else label.removeAttribute("title");
    }
    const back = $("#back-to-root");
    if (back) back.disabled = App.state.focus === App.ROOT && !App.state.selected;
  }

  function renderTreeShell() {
    // the skip link moves focus to the tree's toolbar without touching the hash (#tree would replace #/<person>)
    const skip = $(".skip-link");
    if (skip) skip.addEventListener("click", e => {
      e.preventDefault();
      App.scrollToTree();
      const first = $$(FOCUSABLE, $("#tree-toolbar")).find(n => n.getClientRects().length);
      const tree = $("#tree");
      if (first) first.focus();
      else if (tree) { tree.setAttribute("tabindex", "-1"); tree.focus(); }
    });
    $("#view-switch").replaceChildren(...Object.entries(VIEWS).map(([id, v]) => el("button", {
      type: "button", dataset: { view: id }, "aria-pressed": "false", title: v.title,
      onclick: () => setView(id, { remember: true }),
    }, icon(v.icon, 18), el("span", { text: v.label }))));
    const first = firstName(root) || "Michael";
    $("#tree-toolbar-end").replaceChildren(
      el("span", { class: "tree-focus-label", id: "tree-focus-label", "aria-live": "polite" }),
      el("button", {
        class: "btn btn-sm btn-ghost", id: "back-to-root", type: "button", title: `Back to ${first}`,
        onclick: () => App.go(App.ROOT),
      }, icon("home", 18), el("span", { class: "back-label", text: `Back to ${first}` })));
    // the tools slot scrolls sideways when it overflows (phones): fade the edge that has more
    const slot = $("#tree-tools");
    if (slot) {
      const edges = () => {
        const max = slot.scrollWidth - slot.clientWidth;
        slot.classList.toggle("has-more-l", max > 1 && slot.scrollLeft > 1);
        slot.classList.toggle("has-more-r", max > 1 && slot.scrollLeft < max - 1);
      };
      slot.addEventListener("scroll", edges, { passive: true });
      if ("ResizeObserver" in window) {
        const ro = new ResizeObserver(edges);
        ro.observe(slot);
        $$(".tree-tools-view", slot).forEach(v => ro.observe(v));
      }
      App.on("view", () => requestAnimationFrame(edges));
    }
    // phones and touch screens: a swipe in the tree moves the tree rather than the page, so a bar under it leads
    // on down the page (a swipe on the bar itself scrolls the page too)
    const more = $("#tree-more");
    if (more) more.replaceChildren(el("a", {
      class: "tree-more-link", href: "#intro",
      onclick: e => { e.preventDefault(); goSection("intro"); },
    }, el("span", { text: "More below the tree" }), icon("chevron-down", 18)));
    // quiet placeholders until the view modules mount
    $("#chart-view").replaceChildren(placeholder("chart", module("chart") ? "Drawing the chart…" : "The chart isn't available right now. Try the Family view, or reload the page."));
    $("#family-view").replaceChildren(placeholder("family", module("family") ? "Laying out the family…" : "The family view isn't available right now. Try the Chart view, or reload the page."));
  }

  /* ================================================================ sections */
  // fixed numbers, so a section can be re-rendered (or rendered late) on its own
  const SECTIONS = ["lines", ...((D.leads || []).length ? ["research"] : []), ...(ISSUES.length ? ["fix"] : []), "everyone"];
  const sectionHead = (id, kicker, title, lede) => el("header", { class: "section-head" },
    el("div", { class: "section-kicker" },
      el("span", { class: "label section-num", text: String(SECTIONS.indexOf(id) + 1).padStart(2, "0") }),
      el("span", { class: "label", text: kicker })),
    el("h2", { class: "section-title", id: `${id}-title`, text: title }),
    lede ? el("p", { class: "section-lede", text: lede }) : el("span"));

  /* ---------------------------------------------------------------- Lines */
  const WHO = { harkins: "Your father’s father", perret: "Your father’s mother", dymond: "Your mother’s father", henwood: "Your mother’s mother" };
  function grandparentLabel(line, g) {
    const dad = P[root.father], mum = P[root.mother];
    if (dad && g.id === dad.father) return "Your father’s father";
    if (dad && g.id === dad.mother) return "Your father’s mother";
    if (mum && g.id === mum.father) return "Your mother’s father";
    if (mum && g.id === mum.mother) return "Your mother’s mother";
    return WHO[line.key] || g.rel || "";
  }
  function lineStats(key) {
    const people = Object.values(P).filter(p => p.line === key);
    const ancestors = people.filter(p => p.ahn);
    const born = ancestors.map(p => p.by).filter(Boolean);
    const seen = new Set();
    let photos = 0, docs = 0;
    for (const p of people) for (const m of personMedia(p.id)) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      if (PHOTO_KINDS.includes(m.kind)) photos++; else docs++;
    }
    return {
      people: people.length, ancestors: ancestors.length,
      generations: ancestors.length ? Math.max(...ancestors.map(p => p.gen || 0)) : 0,
      earliest: born.length ? Math.min(...born) : null,
      photos, docs,
    };
  }
  function lineColumn(line) {
    const g = P[line.who];
    const s = lineStats(line.key);
    const parents = g ? [g.father, g.mother].filter(pid => P[pid]) : [];
    const childOf = g && g.sex === "F" ? "Daughter of" : g && g.sex === "M" ? "Son of" : "Child of";
    const story = line.story || "";
    const long = story.length > 560;
    const storyEl = el("p", { class: ["line-story", long && "is-clamped"], text: story });
    const more = long && el("button", {
      class: "link line-more", type: "button", "aria-expanded": "false",
      onclick: e => {
        const open = storyEl.classList.toggle("is-clamped") === false;
        e.currentTarget.setAttribute("aria-expanded", String(open));
        e.currentTarget.firstChild.textContent = open ? "Show less" : "Read the whole story";
      },
    }, "Read the whole story");
    const stat = (n, label) => el("div", { class: "line-stat" }, el("b", { text: n == null ? "–" : n }), el("span", { class: "label", text: label }));
    const slot = (cls, ...kids) => el("div", { class: cls }, ...kids);   // every column has the same 9 rows, so they align
    return el("article", { class: "line-col", style: { "--lc": `var(--${line.key})` }, dataset: { line: line.key } },
      slot("line-kicker",
        el("span", { class: "label", text: LINE_NAMES[line.key] || line.title }),
        el("span", { class: "label line-who", text: g ? grandparentLabel(line, g) : "" })),
      slot("line-head", g && [
        avatar(g, { size: 64, decorative: true }),
        el("div", {},
          el("h3", { class: "line-name" }, el("button", { type: "button", onclick: () => App.go(g.id, { scroll: true }), text: g.name })),
          years(g) && el("p", { class: "line-years", text: years(g) }))]),
      slot("line-parents", parents.length > 0 && [el("span", { class: "label", text: childOf }), parents.map(pid => plink(pid))]),
      slot("line-stats",
        stat(s.people, "People"),
        stat(s.generations, "Generations"),
        stat(s.earliest, "Earliest birth"),
        stat(s.photos + s.docs, "Photos & records")),
      slot("line-origins", (line.origins || []).map(o => el("span", { class: "tag", text: o }))),
      story ? storyEl : slot("line-story"),
      more || slot("line-more-slot"),
      slot("line-people", (line.people || []).length > 0 && [
        el("span", { class: "label", text: "Key people" }),
        el("div", { class: "plinks-col" }, line.people.map(pid => plink(pid)))]),
      slot("line-foot", g && el("button", { class: "btn btn-sm", type: "button", onclick: () => App.go(g.id, { scroll: true }) },
        icon("tree", 16), el("span", { text: "Show in tree" }))));
  }
  /* the page intro and the headline numbers: their own section above Lines, so "Lines" in the nav lands on the lines */
  function renderIntro() {
    const s = D.stats || {};
    const lines = Array.isArray(D.lines) ? D.lines : [];
    const sec = $("#intro");
    if (!sec) return;
    const surnames = lines.map(l => l.title).filter(Boolean);
    const stat = (n, label) => el("div", { class: "stat" }, el("span", { class: "stat-num", text: n == null ? "–" : n }), el("span", { class: "label", text: label }));
    sec.replaceChildren(el("div", { class: "container" },
      el("div", { class: "intro" },
        el("div", {},
          el("p", { class: "label label-lg", style: "margin-bottom:var(--space-4)", text: "The family of " + root.name }),
          el("h2", { class: "intro-title", id: "intro-title" },
            surnames.length ? surnames.slice(0, -1).join(", ") : "The Harkins family",
            surnames.length > 1 ? el("span", { text: " and " }) : null,
            surnames.length > 1 ? surnames[surnames.length - 1] : null)),
        el("p", { class: "intro-sub", text:
          `${root.name} and ${s.direct ?? "his"} direct ancestors, ${s.generations ?? "many"} generations back. ` +
          `Built from the Ancestry export of ${monthYear(s.export_date)} and research of ${monthYear(s.research_date)}.` }),
        el("div", { class: "stats" },
          stat(s.people, "People in the tree"),
          stat(s.direct, "Direct ancestors"),
          stat(s.generations, "Generations back"),
          stat(s.earliest, "Earliest ancestor born"),
          stat(s.unsourced, `Ancestors with no sources (of ${s.direct ?? "–"})`)))));
  }
  function renderLines() {
    const lines = Array.isArray(D.lines) ? D.lines : [];
    const sec = $("#lines");
    sec.replaceChildren(el("div", { class: "container" },
      sectionHead("lines", "The four lines", "Your four grandparent lines",
        "Every ancestor in the tree descends through one of your four grandparents. The colors match the tree."),
      el("div", { class: "lines-grid" }, lines.map(l => safely(`line ${l.key}`, () => lineColumn(l))))));
  }

  /* ---------------------------------------------------------------- Research next */
  function renderResearch() {
    const leads = Array.isArray(D.leads) ? D.leads : [];
    const sec = $("#research");
    if (!leads.length) { sec.hidden = true; return; }
    sec.replaceChildren(el("div", { class: "container" },
      sectionHead("research", "Research next", "Where to look next",
        "Where a few records would add the most to the tree."),
      el("ol", { class: "leads" }, leads.map((l, i) => el("li", { class: "lead" },
        el("span", { class: "lead-num", "aria-hidden": "true", text: String(i + 1).padStart(2, "0") }),
        el("div", {},
          el("h3", { class: "lead-title" }, el("span", { class: "sr-only", text: `${i + 1}. ` }), l.title),
          el("p", { class: "lead-body", text: l.body })),
        (l.people || []).length > 0 && el("div", { class: "lead-people" },
          el("span", { class: "label", text: "People" }),
          l.people.map(pid => plink(pid))))))));
  }

  /* ---------------------------------------------------------------- Things to fix (local only) */
  let fixFilter = "all";
  function renderFix() {
    const sec = $("#fix");
    if (!ISSUES.length) { sec.hidden = true; return; }
    sec.hidden = false;
    const tally = {};
    ISSUES.forEach(i => { tally[i.level] = (tally[i.level] || 0) + 1; });
    const levels = Object.keys(LEVELS).filter(l => tally[l]);
    const list = el("div", { class: "issues" });
    const chips = el("div", { class: "chips fix-filters", role: "group", "aria-label": "Filter by kind" });
    const draw = () => {
      const shown = ISSUES.filter(i => fixFilter === "all" || i.level === fixFilter);
      list.replaceChildren(...(shown.length ? shown.map(i => el("article", { class: `issue level level-${i.level}` },
        el("span", { class: "issue-level" }, el("span", { class: "marker" }), el("span", { class: "label", text: LEVELS[i.level] || i.level })),
        el("h3", { class: "issue-title", text: i.title }),
        el("p", { class: "issue-body", text: i.body }),
        i.fix && el("div", { class: "issue-fix" }, el("span", { class: "label", text: "Fix" }), i.fix),
        (i.people || []).length > 0 && el("div", { class: "plinks" }, i.people.map(pid => plink(pid))))) :
        [el("p", { class: "fix-empty", text: "Nothing of that kind to fix." })]));
      $$("button", chips).forEach(b => b.setAttribute("aria-pressed", String(b.dataset.level === fixFilter)));
    };
    chips.append(
      el("button", { class: "chip", type: "button", dataset: { level: "all" }, onclick: () => { fixFilter = "all"; draw(); } },
        "All", el("span", { class: "chip-count", text: ISSUES.length })),
      ...levels.map(l => el("button", { class: `chip level level-${l}`, type: "button", dataset: { level: l }, onclick: () => { fixFilter = l; draw(); } },
        el("span", { class: "marker" }), LEVEL_PLURAL[l], el("span", { class: "chip-count", text: tally[l] }))));
    sec.replaceChildren(el("div", { class: "container" },
      sectionHead("fix", "Local only", "Things to fix in Ancestry",
        "Found by checking every date and relationship in the export. Fixing these on Ancestry first keeps new hints and records from attaching to the wrong people."),
      chips, list));
    draw();
  }

  /* ---------------------------------------------------------------- Everyone */
  const everyone = { q: "", lines: new Set(), photos: false, docs: false, rows: new Map() };
  const surnameOf = p => String(p.surname || "").trim() || "Unknown surname";
  function personRow(p) {
    const c = counts(p.id);
    const y = years(p);
    return el("button", {
      class: ["prow", p.ahn && "is-direct"], type: "button", style: { "--lc": lineColor(p) }, dataset: { pid: p.id },
      title: p.ahn ? `${p.name}, direct ancestor` : p.name,
      onclick: () => App.go(p.id, { scroll: true }),
    },
      avatar(p, { size: 36, decorative: true }),
      el("span", { class: "prow-main" },
        el("span", { class: "prow-name", text: p.name }),
        el("span", { class: "prow-rel", text: p.rel || "" })),
      // always two lines (years, then counts), so the right edge lines up from row to row
      el("span", { class: "prow-meta" },
        el("span", { class: "prow-years", text: y || "" }),
        el("span", { class: "prow-media" },
          c.photos ? el("span", { title: plural(c.photos, "photo") }, icon("image", 13), el("span", { class: "sr-only", text: plural(c.photos, "photo") }), el("span", { "aria-hidden": "true", text: c.photos })) : null,
          c.docs ? el("span", { title: plural(c.docs, "record or document", "records and documents") }, icon("document", 13), el("span", { class: "sr-only", text: plural(c.docs, "record or document", "records and documents") }), el("span", { "aria-hidden": "true", text: c.docs })) : null)));
  }
  const rowFor = p => {
    let r = everyone.rows.get(p.id);
    if (!r) { r = personRow(p); everyone.rows.set(p.id, r); }
    return r;
  };
  function filteredPeople() {
    const matches = everyone.q.trim() ? new Set(search(everyone.q, 100000)) : null;
    return Object.values(P).filter(p => {
      if (matches && !matches.has(p.id)) return false;
      if (everyone.lines.size && !everyone.lines.has(p.line)) return false;
      if (everyone.photos && !personMedia(p.id, PHOTO_KINDS).length) return false;
      if (everyone.docs && !personMedia(p.id, DOC_KINDS).length) return false;
      return true;
    });
  }
  function drawEveryone() {
    const list = filteredPeople();
    const groups = new Map();
    for (const p of list) {
      const s = surnameOf(p);
      if (!groups.has(s)) groups.set(s, []);
      groups.get(s).push(p);
    }
    const names = [...groups.keys()].sort((a, b) => (a === "Unknown surname") - (b === "Unknown surname") || a.localeCompare(b));
    const letters = new Map();
    const box = $("#people-groups");
    box.replaceChildren(...(names.length ? names.map(s => {
      const people = groups.get(s).sort((a, b) => (a.by || 9999) - (b.by || 9999) || a.name.localeCompare(b.name));
      const letter = s === "Unknown surname" ? "?" : fold(s).charAt(0).toUpperCase();
      const gid = `sg-${fold(s).replace(/[^a-z0-9]+/g, "-")}`;
      if (!letters.has(letter)) letters.set(letter, gid);
      return el("div", { class: "sgroup", id: gid },
        el("div", { class: "sgroup-head" },
          el("h3", { class: "sgroup-name", text: s }),
          el("span", { class: "sgroup-count", text: plural(people.length, "person", "people") })),
        people.map(rowFor));
    }) : [el("div", { class: "people-empty" },
      el("p", { text: "Nobody matches those filters." }),
      el("button", { class: "btn btn-sm", type: "button", onclick: clearEveryone }, icon("close", 16), el("span", { text: "Clear filters" })))]));
    const total = Object.keys(P).length;
    $("#everyone-count").textContent = list.length === total ? `${total} people` : `${list.length} of ${total} people`;
    const alpha = $("#alpha");
    alpha.replaceChildren(..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map(L => letters.has(L)
      ? el("a", { href: `#${letters.get(L)}`, text: L, onclick: e => {
          e.preventDefault();
          const g = document.getElementById(letters.get(L));
          if (g) g.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
        } })
      : el("span", { "aria-hidden": "true", text: L })));
    alpha.hidden = !names.length;
  }
  function renderEveryone() {
    const all = Object.values(P);
    const sec = $("#everyone");
    const input = el("input", {
      class: "input", type: "search", id: "everyone-search", placeholder: "Filter by name or place",
      autocomplete: "off", spellcheck: "false", "aria-label": "Filter everyone",
    });
    let timer = 0;
    input.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => { everyone.q = input.value; drawEveryone(); }, 60);
    });
    input.addEventListener("keydown", e => { if (e.key === "Escape" && input.value) { input.value = ""; everyone.q = ""; drawEveryone(); } });
    const lineKeys = [...LINE_KEYS, "self", "none"].filter(k => all.some(p => p.line === k));
    const tally = k => all.filter(p => p.line === k).length;
    const lineChip = k => el("button", {
      class: "chip", type: "button", "aria-pressed": "false", style: { "--lc": `var(--${k})` },
      onclick: e => {
        everyone.lines.has(k) ? everyone.lines.delete(k) : everyone.lines.add(k);
        e.currentTarget.setAttribute("aria-pressed", String(everyone.lines.has(k)));
        drawEveryone();
      },
    }, el("span", { class: "marker" }), LINE_NAMES[k] || "Not connected", el("span", { class: "chip-count", text: tally(k) }));
    const toggle = (key, label, ico) => el("button", {
      class: "chip", type: "button", "aria-pressed": "false",
      onclick: e => { everyone[key] = !everyone[key]; e.currentTarget.setAttribute("aria-pressed", String(everyone[key])); drawEveryone(); },
    }, icon(ico, 15), label);
    const direct = (D.stats && D.stats.direct) || all.filter(p => p.ahn && p.id !== App.ROOT).length;
    sec.replaceChildren(el("div", { class: "container" },
      sectionHead("everyone", "Index", "Everyone",
        D.public
          ? `All ${all.length} people connected to ${firstName(root)}, by surname. ${direct} are direct ancestors. People who may still be living are shown by name only.`
          : `All ${all.length} people in the export, by surname, including the ones not connected to ${firstName(root)}.`),
      // on phones the filter, the chips and A-Z stick under the top bar together (site.css)
      el("div", { class: "everyone-bar", id: "everyone-bar" },
        el("div", { class: "everyone-controls" },
          el("label", { class: "input-icon" }, icon("search", 18), input),
          el("span", { class: "everyone-count", id: "everyone-count", "aria-live": "polite" })),
        el("div", { class: "everyone-chips" },
          el("div", { class: "chips", role: "group", "aria-label": "Filter by line" }, lineKeys.map(lineChip)),
          el("div", { class: "chips", role: "group", "aria-label": "Filter by photos and documents" },
            toggle("photos", "Has photos", "image"),
            toggle("docs", "Has documents", "document"))),
        el("nav", { class: "alpha", id: "alpha", "aria-label": "Jump to surname" })),
      el("div", { class: "people-groups", id: "people-groups" })));
    everyoneReady = true;
    drawEveryone();
    // the sticky filter bar's height, for the surname groups' scroll margin
    const bar = $("#everyone-bar");
    if (bar && "ResizeObserver" in window) new ResizeObserver(() => sec.style.setProperty("--everyone-bar-h", `${Math.round(bar.offsetHeight)}px`)).observe(bar);
  }
  let everyoneReady = false;
  const ensureEveryone = () => { if (!everyoneReady) safely("everyone", renderEveryone); };
  function clearEveryone() {
    everyone.q = ""; everyone.lines.clear(); everyone.photos = everyone.docs = false;
    const input = $("#everyone-search");
    if (input) input.value = "";
    $$('#everyone-bar .chip[aria-pressed="true"]').forEach(b => b.setAttribute("aria-pressed", "false"));
    drawEveryone();
    if (input) input.focus({ preventScroll: true });
  }
  /* "Show all 35 in Everyone" from the search: filter the index by q and scroll to it */
  function showInEveryone(q) {
    ensureEveryone();
    const input = $("#everyone-search");
    if (!input) return;
    everyone.q = q; everyone.lines.clear(); everyone.photos = everyone.docs = false;
    $$('#everyone-bar .chip[aria-pressed="true"]').forEach(b => b.setAttribute("aria-pressed", "false"));
    input.value = q;
    drawEveryone();
    // the bar is display: contents on wider screens (only A-Z sticks there), so aim at its first row then
    const bar = $("#everyone-bar");
    const target = getComputedStyle(bar).display === "contents" ? bar.firstElementChild : bar;
    jumpScroll(() => target.scrollIntoView({ block: "start", behavior: "instant" }));
    // on phones focusing the field would bring the keyboard back over the results
    if (!isPhone()) input.focus({ preventScroll: true });
  }

  /* ---------------------------------------------------------------- footer */
  function renderFooter() {
    const s = D.stats || {};
    const editor = module("editor");
    const canEdit = editor && typeof editor.openSettings === "function";
    $("#footer").replaceChildren(el("div", { class: "container" },
      el("div", { class: "footer-grid" },
        el("div", { class: "footer-brand" },
          wordmark("div"),
          el("p", { text: `${root.name}'s family: the Harkins, Perret, Dymond and Henwood lines, ${s.generations || ""} generations back.`.replace(" ,", ",") })),
        el("div", {},
          el("h2", { class: "label", text: "Sources" }),
          el("p", { text: `Built from the “Michael Harkins Family Tree” Ancestry export of ${monthYear(s.export_date)}, plus research of ${monthYear(s.research_date)}. Facts marked “Research” come from Pennsylvania death certificates, censuses, Find a Grave, old newspapers, city directories and published genealogies, each with its source; everything else is as recorded on Ancestry.` }),
          D.public
            ? el("p", { text: "Privacy: people who may still be living are shown by name and relationship only, without dates, places, photos or records." })
            : el("p", {}, "After fixing things on Ancestry, export a new GEDCOM into ", el("code", { text: "ancestry-export/" }), " and rebuild with ", el("code", { text: "python3 -I tools/build_tree.py" }), ".")),
        el("div", { class: "footer-meta" },
          el("h2", { class: "label", text: D.public ? "This page" : "Local copy" }),
          el("p", { text: `Built ${formatDate(D.built)}.` }),
          el("p", { text: D.public ? `${s.people || Object.keys(P).length} people shown.` : "This copy includes everything, plus the list of things to fix." }),
          canEdit && el("button", { class: "link", type: "button", onclick: () => safely("editor.openSettings", () => editor.openSettings()) },
            icon("upload", 16), el("span", { text: "Add photos and documents" })))),
      el("div", { class: "footer-base" },
        el("span", { text: "Harkins Family Tree" }),
        el("span", { text: D.public ? "Shared with the family" : "Private, on this computer" }))));
  }

  /* ================================================================ modules and wiring */
  function mountModules() {
    const mountView = (name, sel) => {
      const mod = module(name), target = $(sel);
      if (!mod || typeof mod.mount !== "function" || !target) return;
      try { mod.mount(target); } catch (err) {
        console.error(`[app] ${name}.mount failed:`, err);
        target.replaceChildren(placeholder(name, "Something went wrong drawing this view. Try the other view, or reload the page."));
      }
    };
    mountView("chart", "#chart-view");
    mountView("family", "#family-view");
    mountView("person", "#person-panel");
    for (const name of ["viewer", "editor"]) {
      const mod = module(name);
      if (mod && typeof mod.mount === "function") safely(`${name}.mount`, () => mod.mount(document.body));
    }
  }

  function wireEvents() {
    const panel = $("#person-panel"), tree = $("#tree");
    App.on("select", pid => {
      const person = module("person");
      App.state.selected = pid || null;
      if (pid && person && typeof person.show === "function") {
        safely("person.show", () => person.show(pid));
        panel.classList.add("is-open");
        tree.classList.add("has-panel");
      } else {
        if (person && typeof person.close === "function") safely("person.close", () => person.close());
        panel.classList.remove("is-open");
        tree.classList.remove("has-panel");
      }
      updateFocusUi();
    });
    App.on("focus", pid => {
      const mod = module(App.state.view);
      if (mod && typeof mod.focus === "function") safely(`${App.state.view}.focus`, () => mod.focus(pid));
      updateFocusUi();
    });
    App.on("media", pid => {
      if (pid) everyone.rows.delete(pid); else everyone.rows.clear();
      if (everyoneReady) safely("everyone refresh", drawEveryone);
      safely("lines refresh", renderLinesKeepingStory);
      safely("avatars refresh", () => refreshAvatars(pid, [$("#research"), $("#fix")]));
      for (const name of ["chart", "family"]) {
        const mod = module(name);
        if (mod && typeof mod.refresh === "function") safely(`${name}.refresh`, () => mod.refresh(pid || undefined));
      }
    });
    // follow the breakpoint unless the user picked a view
    PHONE_QUERY.addEventListener("change", () => { if (!viewChoice) setView(isPhone() ? "family" : "chart"); });
  }
  /* re-render Lines (its counts change with uploads) without collapsing opened stories or losing focus */
  function renderLinesKeepingStory() {
    const sec = $("#lines");
    const y = window.scrollY;
    const open = new Set($$('.line-col', sec).filter(c => $('.line-more[aria-expanded="true"]', c)).map(c => c.dataset.line));
    const a = document.activeElement;
    const col = a && sec.contains(a) ? a.closest(".line-col") : null;
    const at = col ? { line: col.dataset.line, i: $$(FOCUSABLE, col).indexOf(a) } : null;
    renderLines();
    for (const c of $$(".line-col", sec)) {
      const more = $(".line-more", c);
      if (more && open.has(c.dataset.line)) more.click();
    }
    if (at) {
      const c = $$(".line-col", sec).find(x => x.dataset.line === at.line);
      const target = c && ($$(FOCUSABLE, c)[at.i] || $$(FOCUSABLE, c)[0]);
      if (target) target.focus({ preventScroll: true });
    }
    jumpScroll(() => window.scrollTo({ top: y, behavior: "instant" }));
  }
  /* swap the avatars of pid (or everyone, for null) in place, keeping their size and decorative flag */
  function refreshAvatars(pid, roots) {
    for (const r of roots) {
      if (!r) continue;
      for (const old of $$(".avatar[data-pid]", r)) {
        const id = old.dataset.pid;
        if ((pid && id !== pid) || !P[id]) continue;
        const size = parseFloat(old.style.getPropertyValue("--av")) || 40;
        old.replaceWith(avatar(P[id], { size, decorative: old.dataset.decorative === "true" }));
      }
    }
  }

  /* ================================================================ boot */
  safely("theme", () => applyTheme(themeMode, { save: false }));
  safely("top bar", renderTopbar);
  safely("tree shell", renderTreeShell);
  setView(viewChoice || (isPhone() ? "family" : "chart"), { initial: true });
  safely("intro", renderIntro);
  safely("lines", renderLines);
  safely("footer", renderFooter);
  wireEvents();
  mountModules();
  if (D.public) {
    const editor = module("editor");
    if (editor && typeof editor.loadRemote === "function") {
      try {
        const done = editor.loadRemote();
        if (done && typeof done.catch === "function") done.catch(err => console.error("[app] editor.loadRemote failed:", err));
      } catch (err) { console.error("[app] editor.loadRemote failed:", err); }
    }
  }
  safely("router", App.startRouter);
  updateFocusUi();
  /* the sections below Lines (Research, Things to fix and the long Everyone index) render once the tree is up and
     the browser is idle, so on slower phones the tree responds sooner */
  let restDone = false;
  const renderRest = () => {
    if (restDone) return;
    restDone = true;
    safely("research", renderResearch);
    safely("fix", renderFix);
    ensureEveryone();
    // a section anchor in the opening URL ("#everyone") still scrolls there
    const id = /^#[a-z][\w-]*$/i.test(location.hash) ? location.hash.slice(1) : "";
    if (id && document.getElementById(id)) requestAnimationFrame(() => document.getElementById(id).scrollIntoView());
  };
  if (/^#[a-z]/i.test(location.hash)) renderRest();
  else if ("requestIdleCallback" in window) requestIdleCallback(renderRest, { timeout: 900 });
  else setTimeout(renderRest, 120);
  // scrolling or jumping down before then renders them at once
  window.addEventListener("scroll", renderRest, { once: true, passive: true });
})();
