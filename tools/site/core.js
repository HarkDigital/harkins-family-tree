/* core.js: the shared foundation every module uses.
   Loads first. Declares top-level helpers (el, years, avatar, icon, ...) and the App namespace.
   See tools/site/README.md for the module contract. */

const App = {
  P: D.people || {},
  ROOT: D.root,
  state: { focus: D.root, selected: null, view: "chart", media: null },
};
const P = App.P;

const LINE_NAMES = {
  harkins: "Harkins line", perret: "Perret line", dymond: "Dymond line", henwood: "Henwood line",
  self: "Immediate family", none: "",
};
const LINE_KEYS = ["harkins", "perret", "dymond", "henwood"];
const KIND_LABELS = { photo: "Photo", headstone: "Headstone", document: "Document", story: "Story", record: "Record" };

/* ------------------------------------------------------------------ storage (never throws) */
const store = {
  get(key, fallback = null) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : v; } catch (e) { return fallback; }
  },
  set(key, value) {
    try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, String(value)); } catch (e) { /* private mode */ }
  },
};

/* ------------------------------------------------------------------ events */
const listeners = {};
App.on = (evt, fn) => {
  (listeners[evt] ||= []).push(fn);
  return () => App.off(evt, fn);
};
App.off = (evt, fn) => {
  const list = listeners[evt];
  if (list) listeners[evt] = list.filter(f => f !== fn);
};
// each listener runs in its own try/catch, so one module's bug can't break another
App.emit = (evt, payload) => {
  for (const fn of (listeners[evt] || []).slice()) {
    try { fn(payload); } catch (err) { console.error(`[App] "${evt}" listener failed:`, err); }
  }
};

/* ------------------------------------------------------------------ DOM builder */
/* el(tag, props, ...children)
   props: class, text, html (trusted strings only), style (cssText string or object), on<event> (function),
   dataset (object), anything else becomes an attribute (true -> "", false/null -> skipped).
   children: nodes, strings, numbers, arrays (flattened); null/false/"" are skipped. */
function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = Array.isArray(v) ? v.filter(Boolean).join(" ") : v;
    else if (k === "text") n.textContent = v;
    else if (k === "html") n.innerHTML = v;
    else if (k === "style") {
      if (typeof v === "string") n.style.cssText = v;
      else for (const [sk, sv] of Object.entries(v)) if (sv != null) sk.startsWith("--") ? n.style.setProperty(sk, sv) : (n.style[sk] = sv);
    } else if (k === "dataset") Object.assign(n.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2).toLowerCase(), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false || c === "") continue;
    n.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return n;
}
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* ------------------------------------------------------------------ people */
const isHidden = p => !!(D.public && p && p.living);
const lineColor = p => `var(--${(p && p.line) || "none"})`;
const SUFFIX = /^(sr|jr|junior|senior|ii|iii|iv|v)\.?$/i;
function nameWords(p) {
  return String((p && p.name) || "").replace(/\(.*?\)/g, " ").split(/\s+/).filter(w => w && !SUFFIX.test(w.replace(/,$/, "")));
}
function firstName(p) {
  return nameWords(p)[0] || (p && p.name) || "";
}
function initials(p) {
  const words = nameWords(p);
  if (!words.length) return "?";
  const surname = String((p && p.surname) || "").trim();
  const last = surname && words.some(w => w === surname.split(/\s+/)[0]) ? surname : words[words.length - 1];
  const first = words[0];
  const a = first.charAt(0), b = words.length > 1 || surname ? last.charAt(0) : "";
  return (a + (first === last ? "" : b)).toUpperCase();
}
/* "1888–1943", "b. 1926", "d. 1901", "1850–?", "Living" (or "" when nothing is known) */
function years(p) {
  if (!p) return "";
  if (isHidden(p)) return "Living";
  const by = p.by || null, dy = p.dy || null;
  if (p.living) return by ? `b. ${by}` : "Living";
  if (by && dy) return `${by}–${dy}`;
  if (dy) return `d. ${dy}`;
  if (by) return by < 1925 ? `${by}–?` : `b. ${by}`;
  return "";
}
/* shorten "Philadelphia, Philadelphia, Pennsylvania, USA" to "Philadelphia, Pennsylvania" */
function shortPlace(place) {
  if (!place) return "";
  const parts = String(place).split(",").map(s => s.trim()).filter(Boolean)
    .filter(s => !/^(usa|united states( of america)?|u\.s\.a\.?)$/i.test(s));
  const out = [];
  for (const s of parts) if (!out.includes(s)) out.push(s);
  return out.slice(0, 2).join(", ");
}
const findEvent = (p, ...tags) => {
  for (const t of tags) { const e = (p.ev || []).find(x => x.tag === t && (x.date || x.place)); if (e) return e; }
  return null;
};
/* "Born 26 Nov 1888, Philadelphia, Pennsylvania · Died 23 Jun 1943, Philadelphia, Pennsylvania"
   Falls back to baptism/burial. Returns "" when nothing is recorded; "Living" for hidden people. */
function lifeLine(p) {
  if (!p) return "";
  if (isHidden(p)) return "Living";
  const fmt = (label, e) => e ? `${label} ${[e.date, shortPlace(e.place)].filter(Boolean).join(", ")}` : null;
  const b = findEvent(p, "BIRT") ? fmt("Born", findEvent(p, "BIRT")) : fmt("Baptized", findEvent(p, "CHR", "BAPM"));
  const d = p.living ? null : findEvent(p, "DEAT") ? fmt("Died", findEvent(p, "DEAT")) : fmt("Buried", findEvent(p, "BURI"));
  return [b, d].filter(Boolean).join(" · ");
}

/* ------------------------------------------------------------------ media */
const hasOwn = (obj, key) => !!obj && Object.prototype.hasOwnProperty.call(obj, key);
/* own keys only, so "constructor" or "__proto__" in a URL never resolve to Object.prototype members */
const media = mid => (mid && D.media && hasOwn(D.media, mid) ? D.media[mid] : undefined);
/* the person's media, in their order; kinds = "photo" or ["photo", "headstone"] to filter. [] for hidden people. */
function personMedia(pid, kinds) {
  const p = P[pid];
  if (!p || isHidden(p)) return [];
  const want = kinds == null ? null : new Set([].concat(kinds));
  return (p.media || []).map(media).filter(m => m && (!want || want.has(m.kind)));
}
const mediaUrl = path => path || "";
function kindLabel(m) {
  if (!m) return "";
  if (m.kind === "record") return m.type || "Record";
  if (m.file === "pdf") return "PDF document";
  return KIND_LABELS[m.kind] || "Item";
}
/* the image to show in a small square for a person, or null */
function photoOf(p) {
  if (!p || isHidden(p) || !p.photo) return null;
  const m = media(p.photo);
  const url = m && (m.thumb || (m.file !== "pdf" && m.src));
  return url ? { m, url: mediaUrl(url) } : null;
}

/* ------------------------------------------------------------------ avatar */
/* avatar(p, {size = 40, cls = "", decorative = false}) -> <span class="avatar is-photo|is-mono ..."> square, framed
   with a 1px rule. Photo: <img> (object-fit: cover, object-position: p.photoPos, lazy, alt = name); a broken image
   falls back to the monogram. Monogram: the initials in the line color on a low-opacity tint. Hidden people get a
   monogram. decorative: true when the name is printed right beside it (inside the same button or link), so screen
   readers don't hear it twice: the img gets alt="" and the monogram aria-hidden, with no role or label. */
function avatar(p, { size = 40, cls = "", decorative = false } = {}) {
  const box = el("span", {
    class: ["avatar", cls, isHidden(p) && "is-living"],
    style: { "--av": `${size}px`, "--lc": lineColor(p) },
    dataset: decorative ? { pid: (p && p.id) || "", decorative: "true" } : { pid: (p && p.id) || "" },
  });
  const mono = () => {
    box.classList.remove("is-photo");
    box.classList.add("is-mono");
    box.replaceChildren(el("span", { class: "avatar-initials", "aria-hidden": "true", text: initials(p) }));
    if (decorative) box.setAttribute("aria-hidden", "true");
    else {
      box.setAttribute("role", "img");
      box.setAttribute("aria-label", (p && p.name) || "Unknown");
    }
  };
  const photo = photoOf(p);
  if (photo) {
    box.classList.add("is-photo");
    const img = el("img", {
      src: photo.url, alt: decorative ? "" : p.name, loading: "lazy", decoding: "async", draggable: "false",
      style: p.photoPos ? { objectPosition: p.photoPos } : null,
    });
    img.addEventListener("error", mono, { once: true });
    box.append(img);
  } else mono();
  return box;
}

/* ------------------------------------------------------------------ icons */
/* 24px grid, 1.75 stroke, square caps and miter joins, currentColor. Shapes are rects and straight
   paths wherever possible, to match the square look. */
const ICONS = {
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 20 20"/>',
  close: '<path d="M6 6 18 18M18 6 6 18"/>',
  "chevron-left": '<path d="M14.5 5.5 8 12l6.5 6.5"/>',
  "chevron-right": '<path d="M9.5 5.5 16 12l-6.5 6.5"/>',
  "chevron-up": '<path d="M5.5 14.5 12 8l6.5 6.5"/>',
  "chevron-down": '<path d="M5.5 9.5 12 16l6.5-6.5"/>',
  "arrow-left": '<path d="M20 12H5M11 6l-6 6 6 6"/>',
  "arrow-right": '<path d="M4 12h15M13 6l6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  fit: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  center: '<rect x="9" y="9" width="6" height="6"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>',
  tree: '<rect x="3" y="9.5" width="5" height="5"/><rect x="16" y="3.5" width="5" height="5"/><rect x="16" y="15.5" width="5" height="5"/><path d="M8 12h4M12 6v12M12 6h4M12 18h4"/>',
  family: '<rect x="3.5" y="3" width="6" height="5"/><rect x="14.5" y="3" width="6" height="5"/><rect x="9" y="16" width="6" height="5"/><path d="M6.5 8v4h11V8M12 12v4"/>',
  image: '<rect x="3" y="4" width="18" height="16"/><path d="m3 17 5.5-5.5 4.5 4.5 3-3 5 5"/><rect x="14.5" y="7.5" width="2.5" height="2.5"/>',
  document: '<path d="M6 3h8.5L19 7.5V21H6z"/><path d="M14 3v5h5M9 12.5h7M9 16.5h7"/>',
  upload: '<path d="M12 15V4M7 9l5-5 5 5M4 15v5h16v-5"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M4 15v5h16v-5"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/>',
  sun: '<rect x="8.5" y="8.5" width="7" height="7"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  moon: '<path d="M19.5 14.6A8 8 0 0 1 9.4 4.5a8 8 0 1 0 10.1 10.1z"/>',
  auto: '<rect x="4" y="4" width="16" height="16"/><path d="M20 4 4 20h16z" fill="currentColor" stroke="none"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13 7 4 4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6"/>',
  star: '<path d="m12 3.5 2.6 5.6 6.1.6-4.6 4.1 1.3 6-5.4-3.1-5.4 3.1 1.3-6-4.6-4.1 6.1-.6z"/>',
  users: '<rect x="5.5" y="4" width="6" height="6"/><path d="M2.5 20v-6h12v6"/><path d="M14.5 4.5H19v5h-4.5M17 13.5h4.5V20"/>',
  link: '<path d="M10 7.5H4.5v9H10M14 7.5h5.5v9H14M8 12h8"/>',
  "zoom-in": '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 20 20M7.5 10.5h6M10.5 7.5v6"/>',
  "zoom-out": '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 20 20M7.5 10.5h6"/>',
  home: '<path d="M4 10.5 12 4l8 6.5V20H4z"/><path d="M10 20v-6h4v6"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  info: '<rect x="4" y="4" width="16" height="16"/><path d="M12 11v5.5M12 7.5v1"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
};
/* icon(name, size = 20) -> <svg class="icon icon-NAME"> (aria-hidden). Unknown names give an empty square. */
function icon(name, size = 20) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.75");
  svg.setAttribute("stroke-linecap", "square");
  svg.setAttribute("stroke-linejoin", "miter");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", `icon icon-${name}`);
  svg.style.setProperty("--icon-size", `${size}px`);
  svg.innerHTML = ICONS[name] || '<rect x="5" y="5" width="14" height="14"/>';
  return svg;
}

/* ------------------------------------------------------------------ search */
const fold = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
let searchIndex = null;
function buildSearchIndex() {
  searchIndex = Object.values(P).map(p => {
    const name = fold(p.name);
    return {
      id: p.id, name, words: name.split(" "),
      surname: fold(p.surname),
      place: isHidden(p) ? "" : fold(p.bp),
      yrs: isHidden(p) ? "" : [p.by, p.dy].filter(Boolean).join(" "),
      // tie-breaks: direct ancestors and close relatives first, unconnected people last
      boost: (p.id === App.ROOT ? 6 : 0) + (p.ahn ? 4 - Math.min(3, (p.gen || 0) / 3) : 0) + (p.line === "none" ? -3 : 0),
    };
  });
}
/* search(q, limit = 8) -> [pid], ranked: full-name prefix, word prefixes, name substring, then birthplace and years.
   Ignores accents and case. Every query word must match somewhere. */
function search(q, limit = 8) {
  const query = fold(q);
  if (!query) return [];
  if (!searchIndex) buildSearchIndex();
  const terms = query.split(" ");
  const scored = [];
  for (const it of searchIndex) {
    let score = 0, ok = true;
    if (it.name.startsWith(query)) score += 120;
    else if (it.words.some(w => w.startsWith(query))) score += 90;
    for (const t of terms) {
      let s = 0;
      const wi = it.words.findIndex(w => w.startsWith(t));
      if (wi === 0) s = 40;
      else if (wi > 0) s = it.surname && it.surname.startsWith(t) ? 40 : 30;
      else if (it.name.includes(t)) s = 18;
      else if (it.place && it.place.split(" ").some(w => w.startsWith(t))) s = 10;
      else if (it.yrs && it.yrs.split(" ").some(y => y.startsWith(t))) s = 8;
      if (!s) { ok = false; break; }
      score += s;
    }
    if (ok) scored.push([score + it.boost, it]);
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name));
  return scored.slice(0, limit).map(([, it]) => it.id);
}
App.on("media", () => { searchIndex = null; });

/* ------------------------------------------------------------------ misc */
const PHONE_QUERY = window.matchMedia("(max-width: 699px)");
const isPhone = () => PHONE_QUERY.matches;
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const bareId = pid => String(pid || "").replace(/^@|@$/g, "");
/* accepts "@I123@", "I123" or "R-name" and returns the pid in D.people, or null */
const PID_RE = /^@[A-Za-z0-9-]+@$/;
function resolvePid(id) {
  if (!id) return null;
  const s = String(id);
  if (PID_RE.test(s) && hasOwn(P, s)) return s;
  const wrapped = `@${bareId(s)}@`;
  return PID_RE.test(wrapped) && hasOwn(P, wrapped) ? wrapped : null;
}

/* toast(msg, {kind = "info" | "ok" | "error", timeout = 4500}) */
function toast(msg, { kind = "info", timeout } = {}) {
  let stack = document.getElementById("toasts");
  if (!stack) { stack = el("div", { class: "toast-stack", id: "toasts", "aria-live": "polite" }); document.body.append(stack); }
  const t = el("div", { class: `toast is-${kind}`, role: kind === "error" ? "alert" : "status" },
    kind === "ok" ? icon("check", 18) : kind === "error" ? icon("info", 18) : null,
    el("span", { text: msg }),
    el("button", { class: "toast-close", type: "button", "aria-label": "Dismiss", onclick: () => leave() }, icon("close", 16)));
  let gone = false;
  const leave = () => {
    if (gone) return;
    gone = true;
    t.classList.add("is-leaving");
    setTimeout(() => t.remove(), 260);
  };
  stack.append(t);
  while (stack.children.length > 3) stack.firstElementChild.remove();
  setTimeout(leave, timeout || (kind === "error" ? 7000 : 4500));
  return t;
}

/* ------------------------------------------------------------------ router */
/* The hash is "#/<id>" (the pid without its @s) or "#/<id>/m/<mid>" while the viewer is open.
   Each history entry also carries {focus, selected} so back/forward restore exactly what was shown. */
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const hashFor = (pid, mid) => `#/${encodeURIComponent(bareId(pid))}${mid ? `/m/${encodeURIComponent(mid)}` : ""}`;
const historyEntry = extra => ({ hft: 1, focus: App.state.focus, selected: App.state.selected, ...extra });
function writeHistory(hash, entry, replace) {
  try {
    if (replace) history.replaceState(entry, "", hash);
    else history.pushState(entry, "", hash);
  } catch (e) { /* some sandboxed frames refuse history writes */ }
}
function parseHash(h = location.hash) {
  if (!h || !h.startsWith("#/")) return null;
  const parts = h.slice(2).split("/").map(s => { try { return decodeURIComponent(s); } catch (e) { return s; } });
  return { pid: resolvePid(parts[0]), mid: parts[1] === "m" && parts[2] ? parts[2] : null };
}

/* App.go(pid, {focus = true, select = true, replace = false, scroll = false})
   focus: re-center the tree on pid ("focus" event). select: open the person panel on pid ("select" event).
   replace: don't add a history entry. scroll: bring the tree section into view.
   Closes the viewer if it is open. Returns false for an unknown pid. */
App.go = (id, { focus = true, select = true, replace = false, scroll = false } = {}) => {
  const pid = resolvePid(id);
  if (!pid) { console.warn("[App.go] unknown person:", id); return false; }
  if (App.state.media) {
    App.state.media = null;
    try { App.viewer && App.viewer.close && App.viewer.close(); } catch (err) { console.error("[App.go] viewer.close failed:", err); }
  }
  const before = { focus: App.state.focus, selected: App.state.selected };
  if (focus) App.state.focus = pid;
  if (select) App.state.selected = pid;
  const hash = hashFor(pid);
  const unchanged = before.focus === App.state.focus && before.selected === App.state.selected && location.hash === hash;
  writeHistory(hash, historyEntry(), replace || unchanged);
  // scroll first: the phone sheet's scroll lock (added on "select") would otherwise freeze a long glide halfway
  if (scroll) App.scrollToTree();
  if (focus) App.emit("focus", pid);
  if (select) App.emit("select", pid);
  return true;
};

/* App.select(pid|null): change the selection without moving the tree. App.select(null) closes the person panel. */
App.select = id => {
  const pid = id == null ? null : resolvePid(id);
  if (id != null && !pid) return false;
  if (pid) return App.go(pid, { focus: false });
  App.state.selected = null;
  writeHistory(hashFor(App.state.focus), historyEntry(), true);
  App.emit("select", null);
  return true;
};

/* the tree section sits directly under the sticky bar, so "scroll to the tree" is "scroll to the top".
   It glides only for short distances on wider screens; from deep in the page (or on a phone) it jumps, since a
   long smooth scroll runs behind the person sheet that opens right after. html has scroll-behavior: smooth,
   so a jump has to switch that off for the moment ("auto" alone would still glide). */
App.scrollToTree = () => {
  const y = window.scrollY || document.documentElement.scrollTop || 0;
  if (!y) return;
  if (!reducedMotion() && !isPhone() && y <= window.innerHeight) { window.scrollTo({ top: 0, behavior: "smooth" }); return; }
  jumpScroll(() => window.scrollTo({ top: 0, behavior: "instant" }));
};
/* jumpScroll(fn): run fn's scrolling with no glide, whatever html's scroll-behavior says. The style is flushed
   before fn runs, since a scroll reads the computed value (and "instant" isn't known to every browser). */
function jumpScroll(fn) {
  const html = document.documentElement, was = html.style.scrollBehavior;
  html.style.scrollBehavior = "auto";
  void getComputedStyle(html).scrollBehavior;
  try { fn(); } finally { html.style.scrollBehavior = was; }
}

/* App.openMedia(mid, list?): open the viewer on mid. list = [mid, ...] for prev/next; it defaults to the media
   of the selected person (if they're in the item) or the item's first person. Without a viewer module it opens
   the file in a new tab, or shows a toast. */
App.openMedia = (mid, list) => {
  const m = media(mid);
  if (!m) { toast("That photo or document isn't available.", { kind: "error" }); return false; }
  const people = (m.people || []).filter(pid => hasOwn(P, pid));
  // whose media to step through: the selected person when the item is theirs, else the item's first person
  const owner = people.includes(App.state.selected) ? App.state.selected : people[0] || App.state.focus;
  if (!Array.isArray(list) || !list.length) {
    list = personMedia(owner).map(x => x.id);
    if (!list.includes(mid)) list = [mid];
  }
  if (App.viewer && typeof App.viewer.open === "function") {
    const wasOpen = !!App.state.media;
    App.state.media = mid;
    // the hash keeps naming the person on screen (the panel), so a reload or a shared link shows the same thing
    const shown = App.state.selected || App.state.focus;
    writeHistory(hashFor(shown, mid), historyEntry({ media: mid, pushed: !wasOpen || !!(history.state && history.state.pushed) }), wasOpen);
    try { App.viewer.open(mid, list); return true; } catch (err) {
      console.error("[App.openMedia] viewer.open failed:", err);
      App.state.media = null;
    }
  }
  const url = m.src || m.link || m.external;
  if (url) { window.open(mediaUrl(url), "_blank", "noopener"); return true; }
  toast("The viewer isn't available on this page.");
  return false;
};
/* for the viewer: call when prev/next changes the shown item (updates the hash in place) */
App.mediaShown = mid => {
  if (!media(mid)) return;
  App.state.media = mid;
  const parsed = parseHash();
  const owner = (parsed && parsed.pid) || App.state.selected || App.state.focus;
  writeHistory(hashFor(owner, mid), historyEntry({ media: mid, pushed: !!(history.state && history.state.pushed) }), true);
};
/* for the viewer: call when it closes itself (× or Escape). Pops the viewer's history entry. */
App.mediaClosed = () => {
  if (!App.state.media) return;
  App.state.media = null;
  if (history.state && history.state.media && history.state.pushed) history.back();
  else writeHistory(hashFor(App.state.selected || App.state.focus), historyEntry(), true);
};

/* "#/I999" (or a local-only person on the public page): say so, and put back the hash of what is on screen */
const NOT_HERE = "That person isn't on this page.";
function rejectHash() {
  toast(NOT_HERE);
  writeHistory(hashFor(App.state.selected || App.state.focus, App.state.media), historyEntry(App.state.media ? { media: App.state.media } : {}), true);
}
/* back/forward and hand-edited hashes run through here */
function route() {
  const parsed = parseHash() || { pid: null, mid: null };
  const st = history.state && history.state.hft ? history.state : null;
  if (!st && !parsed.pid && location.hash.startsWith("#/")) { rejectHash(); return; }
  if (!parsed.pid && !st) return;             // "#lines" and other section anchors
  const focus = resolvePid(st && st.focus) || parsed.pid || App.state.focus;
  const selected = st ? resolvePid(st.selected) : parsed.pid;
  if (!st) writeHistory(location.hash, { hft: 1, focus, selected, media: parsed.mid || undefined }, true);
  if (focus !== App.state.focus) { App.state.focus = focus; App.emit("focus", focus); }
  if (selected !== App.state.selected) { App.state.selected = selected; App.emit("select", selected); }
  const mid = parsed.mid && media(parsed.mid) ? parsed.mid : null;
  if (parsed.mid && !mid) {
    toast("That photo or document isn't on this page.");
    writeHistory(hashFor(selected || focus), { hft: 1, focus, selected }, true);
  }
  if (mid && App.viewer && App.viewer.open) {
    if (App.state.media !== mid) {
      App.state.media = mid;
      const owner = parsed.pid || focus;
      const list = personMedia(owner).map(x => x.id);
      try { App.viewer.open(mid, list.includes(mid) ? list : [mid]); } catch (err) { console.error("[router] viewer.open failed:", err); }
    }
  } else if (App.state.media) {
    App.state.media = null;
    try { App.viewer && App.viewer.close && App.viewer.close(); } catch (err) { console.error("[router] viewer.close failed:", err); }
  }
}
window.addEventListener("popstate", route);
window.addEventListener("hashchange", route);

/* called once by app.js after the modules are mounted: applies the hash the page was opened with */
App.startRouter = () => {
  const parsed = parseHash();
  if (parsed && parsed.pid) {
    App.state.focus = parsed.pid;
    App.state.selected = parsed.pid;
    writeHistory(hashFor(parsed.pid), historyEntry(), true);
    App.emit("focus", parsed.pid);
    App.emit("select", parsed.pid);
    if (parsed.mid && !media(parsed.mid)) toast("That photo or document isn't on this page.");
    // only with a viewer: without one, openMedia would try to open a new tab on page load
    else if (parsed.mid && App.viewer && App.viewer.open) App.openMedia(parsed.mid);
  } else {
    App.state.focus = App.ROOT;
    App.state.selected = null;
    // a person link that names nobody here (a typo, or someone only on the local copy): say so and drop it
    const bad = !!parsed;
    try { history.replaceState(historyEntry(), "", bad ? location.pathname + location.search : undefined); } catch (e) { /* ignore */ }
    App.emit("focus", App.ROOT);
    if (bad) toast(NOT_HERE);
  }
};

/* the element where a view puts its toolbar controls: App.toolbar("chart") -> #chart-tools */
App.toolbar = view => document.getElementById(`${view}-tools`);
