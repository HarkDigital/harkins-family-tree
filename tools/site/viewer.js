/* viewer.js: the full-screen media viewer (lightbox).
   App.viewer = {mount(body), open(mid, list), close()}. Opened only through App.openMedia (core.js owns the
   hash and history); prev/next report back with App.mediaShown(mid), closing itself with App.mediaClosed().

   Two layouts:
   - "image": a zoomable stage (photos, headstones, documents, record scans, PDFs as a tile) with an info
     column on the right (tablet/desktop) or a collapsible bottom drawer (phone).
   - "read": one scrolling reading column for stories and records without a scan. */
(() => {
  const ZOOM_MIN = 1, ZOOM_MAX = 6, ZOOM_STEP = 2.5;   // relative to the fitted size
  const UPSCALE_MAX = 2.5;    // small originals (100-300px scans) may be drawn up to 2.5x their pixel size when fitted
  const SWIPE_MIN = 56;       // px of horizontal travel that turns a swipe into prev/next
  const TAP_SLOP = 8;         // px a press can move and still count as a tap/click
  const DOUBLE_TAP_MS = 300;

  let root = null;            // .vw
  let ui = {};                // named child elements
  let list = [];              // mids for prev/next
  let index = 0;
  let current = null;         // the media object shown
  let isOpen = false;
  let returnFocus = null;     // element to focus again on close
  let loadToken = 0;          // guards against a slow image arriving after the user moved on
  let drawerOpen = false;     // phone: is the info drawer expanded
  let removeArmed = null;     // timer while "Remove" waits for its second click

  // zoom/pan state of the stage: the fitted image is bw x bh; it's drawn at translate(tx, ty) scale(z)
  const view = { z: 1, tx: 0, ty: 0, bw: 0, bh: 0, sw: 0, sh: 0, nw: 0, nh: 0 };

  const editorOn = () => {
    try { return !!(App.editor && typeof App.editor.enabled === "function" && App.editor.enabled()); }
    catch (err) { return false; }
  };
  const editorHas = name => !!(App.editor && typeof App.editor[name] === "function");
  // the info panel is a bottom drawer on phones and on tablets held upright (viewer.css uses the same query)
  const DRAWER_QUERY = window.matchMedia("(max-width: 699px), (max-width: 1099px) and (orientation: portrait)");
  const drawerLayout = () => DRAWER_QUERY.matches;
  // only http(s) links become hrefs (never javascript:, data: or anything else a manifest could carry)
  const safeHref = url => (typeof url === "string" && /^https?:\/\//i.test(url.trim()) ? url.trim() : "");
  // avatars next to a visible name are decorative: the button already says the name
  const decorative = node => { if (node) { node.setAttribute("aria-hidden", "true"); node.removeAttribute("role"); node.removeAttribute("aria-label"); } return node; };
  // how the viewer was opened: by keyboard (focus the close button, ring shown) or by pointer / link (focus the dialog)
  let lastInput = null;
  const isPdf = m => !!m && (m.file === "pdf" || /\.pdf(\?|#|$)/i.test(m.src || ""));
  const hasImage = m => !!m && !isPdf(m) && !!(m.src || m.thumb);
  const isReadMode = m => !!m && (m.kind === "story" || (!m.src && !m.thumb));
  // whose media this is: the selected person when they're in it, else its first known person
  const ownerOf = m => {
    const people = ((m && m.people) || []).filter(pid => P[pid]);
    return people.includes(App.state.selected) ? App.state.selected : people[0] || null;
  };

  /* ---------------------------------------------------------------- text helpers */
  // "Mary Polly Lawson - Mary Polly Lawson" -> "Mary Polly Lawson"
  function cleanTitle(m) {
    let t = String((m && m.title) || "").trim();
    const halves = t.split(/\s+[-–]\s+/);
    if (halves.length === 2 && halves[0].toLowerCase() === halves[1].toLowerCase()) t = halves[0];
    return t || kindLabel(m) || "Untitled";
  }
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  // Ancestry gallery dates are sometimes upload timestamps ("6/12/2013 6:07:40 PM"): show the day only
  function cleanDate(d) {
    const s = String(d || "").trim();
    const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(\s+\d{1,2}:\d{2}(:\d{2})?\s*(AM|PM)?)?$/i);
    if (us && +us[1] >= 1 && +us[1] <= 12) return `${+us[2]} ${MONTHS[+us[1] - 1]} ${us[3]}`;
    return s;
  }
  /* Ancestry gallery items often carry the upload's date and the uploader's town instead of when and where the
     photo was taken (a photo titled "1945" dated 9 May 2019). Treat the date as an upload date when it has a time
     of day, or (photos and documents) when its year is after everyone in it had died or after a year in the title. */
  const YEAR_RE = /\b(1[5-9]\d\d|20\d\d)\b/;
  function isUploadDate(m) {
    if (!m || m.kind === "record" || m.kind === "story" || String(m.id || "").startsWith("u-")) return false;
    const s = String(m.date || "").trim();
    if (!s) return false;
    if (/\d{1,2}:\d{2}/.test(s)) return true;
    if (m.kind === "headstone") return false;    // a headstone is photographed long after the death
    const y = YEAR_RE.exec(s);
    if (!y) return false;
    const year = +y[1];
    const deaths = (m.people || []).map(pid => P[pid]).filter(p => p && p.dy).map(p => +p.dy);
    if (deaths.length && deaths.length === (m.people || []).filter(pid => P[pid]).length && year > Math.max(...deaths)) return true;
    const t = YEAR_RE.exec(String(m.title || ""));
    return !!t && year > +t[1];
  }

  // text with http(s) URLs turned into links (built from text nodes, never innerHTML)
  function linkify(text) {
    const out = [];
    const re = /https?:\/\/[^\s<>"')]+/g;
    let last = 0, hit;
    const s = String(text || "");
    while ((hit = re.exec(s))) {
      if (hit.index > last) out.push(s.slice(last, hit.index));
      let url = hit[0].replace(/[.,;:]+$/, "");
      out.push(el("a", { class: "vw-inline-link", href: url, target: "_blank", rel: "noopener", text: shortUrl(url) }));
      last = hit.index + url.length;
    }
    if (last < s.length) out.push(s.slice(last));
    return out;
  }
  function shortUrl(url) {
    try {
      const u = new URL(url);
      const path = u.pathname.length > 24 ? u.pathname.slice(0, 22) + "…" : u.pathname;
      return u.host.replace(/^www\./, "") + (path === "/" ? "" : path);
    } catch (err) { return url; }
  }
  function hostLabel(url) {
    try {
      const host = new URL(url).host.replace(/^www\./, "");
      if (/findagrave/.test(host)) return "Find a Grave";
      if (/newspapers\.com/.test(host)) return "Newspapers.com";
      if (/familysearch/.test(host)) return "FamilySearch";
      if (/ancestry/.test(host)) return "Ancestry";
      return host;
    } catch (err) { return "the source"; }
  }
  // paragraphs from blank lines; single newlines kept as line breaks (CSS white-space: pre-line)
  const paragraphs = text => String(text || "").replace(/\r\n?/g, "\n").split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
  function downloadName(m) {
    const ext = ((m.src || "").match(/\.(jpe?g|png|gif|webp|pdf)(?:[?#]|$)/i) || [, isPdf(m) ? "pdf" : "jpg"])[1].toLowerCase();
    const base = cleanTitle(m).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70);
    return `${base || m.id}.${ext}`;
  }

  /* ---------------------------------------------------------------- DOM */
  function iconBtn(cls, label, name, onclick, size = 22) {
    return el("button", { class: ["vw-btn", cls], type: "button", "aria-label": label, title: label, onclick }, icon(name, size));
  }

  function build() {
    ui.count = el("div", { class: "vw-count", "aria-live": "polite" });
    ui.barPrev = iconBtn("vw-bar-prev", "Previous", "chevron-left", () => step(-1));
    ui.barNext = iconBtn("vw-bar-next", "Next", "chevron-right", () => step(1));
    ui.zoomOut = iconBtn("vw-zoom-out", "Zoom out", "zoom-out", () => zoomBy(1 / 1.5), 20);
    ui.zoomIn = iconBtn("vw-zoom-in", "Zoom in", "zoom-in", () => zoomBy(1.5), 20);
    ui.zoomLevel = el("button", { class: "vw-btn vw-zoom-level", type: "button", title: "Fit to screen", "aria-label": "Fit to screen", onclick: () => zoomTo(1) }, "100%");
    ui.zoom = el("div", { class: "vw-zoom", role: "group", "aria-label": "Zoom" }, ui.zoomOut, ui.zoomLevel, ui.zoomIn);
    ui.close = iconBtn("vw-close", "Close", "close", () => close(), 24);
    ui.bar = el("div", { class: "vw-bar" },
      el("div", { class: "vw-bar-start" }, ui.barPrev, ui.count, ui.barNext),
      el("div", { class: "vw-bar-end" }, ui.zoom, ui.close));

    // the image stage
    ui.img = el("img", { class: "vw-img", alt: "", draggable: "false", decoding: "async" });
    ui.frame = el("div", { class: "vw-frame" }, ui.img);
    ui.doc = el("div", { class: "vw-doc", hidden: true });
    ui.status = el("div", { class: "vw-status", hidden: true });
    ui.loader = el("div", { class: "vw-loader", hidden: true, "aria-hidden": "true" });
    ui.stage = el("div", { class: "vw-stage" }, ui.frame, ui.doc, ui.status, ui.loader);

    // the reading column (stories, records without a scan)
    ui.read = el("div", { class: "vw-read", tabindex: "-1", hidden: true });

    ui.prev = iconBtn("vw-nav vw-prev", "Previous", "chevron-left", () => step(-1), 28);
    ui.next = iconBtn("vw-nav vw-next", "Next", "chevron-right", () => step(1), 28);
    ui.main = el("div", { class: "vw-main" }, ui.bar, ui.stage, ui.read, ui.prev, ui.next);

    // info: right column (tablet/desktop) or bottom drawer (phone)
    ui.peekKind = el("span", { class: "label vw-peek-kind" });
    ui.peekTitle = el("span", { class: "vw-peek-title" });
    ui.peek = el("button", {
      class: "vw-peek", type: "button", "aria-expanded": "false", "aria-controls": "vw-panel-body",
      onclick: () => setDrawer(!drawerOpen),
    },
      el("span", { class: "vw-handle", "aria-hidden": "true" }),
      el("span", { class: "vw-peek-text" }, ui.peekKind, ui.peekTitle),
      el("span", { class: "vw-peek-icon" }, icon("chevron-up", 20)));
    ui.body = el("div", { class: "vw-panel-body", id: "vw-panel-body" });
    ui.panel = el("aside", { class: "vw-panel", "aria-label": "About this item" }, ui.peek, ui.body);

    root = el("div", {
      class: "vw", role: "dialog", "aria-modal": "true", "aria-label": "Photo and document viewer",
      tabindex: "-1", hidden: true,
    }, ui.main, ui.panel);

    ui.stage.addEventListener("wheel", onWheel, { passive: false });
    ui.stage.addEventListener("pointerdown", onPointerDown);
    ui.stage.addEventListener("dblclick", onDblClick);
    ui.peek.addEventListener("pointerdown", onPeekDown);
    ui.read.addEventListener("pointerdown", onReadDown);
    new ResizeObserver(() => { if (isOpen && !isReadMode(current)) fit(true); }).observe(ui.stage);
    App.on("media", onMediaChanged);
    return root;
  }

  /* ---------------------------------------------------------------- open, close, step */
  function open(mid, mids) {
    const m = media(mid);
    if (!m) return;
    if (!root) mount(document.body);
    list = (Array.isArray(mids) && mids.length ? mids : [mid]).filter(id => media(id));
    if (!list.includes(mid)) list = [mid];
    index = list.indexOf(mid);
    if (!isOpen) {
      const active = document.activeElement;
      returnFocus = active && active !== document.body && !root.contains(active) ? active : null;
      isOpen = true;
      root.hidden = false;
      document.documentElement.classList.add("vw-lock");
      root.classList.remove("is-leaving");
      root.classList.add("is-entering");
      setTimeout(() => root && root.classList.remove("is-entering"), 400);
      drawerOpen = false;
    }
    show(0);
    // focus inside the dialog so Escape and Tab start there. Opened from the keyboard, the close button takes
    // focus (and shows its ring); opened by a tap, click or shared link, the dialog itself does, so no focus
    // ring sits on × on a touch screen. Tab from the dialog goes to the first control.
    requestAnimationFrame(() => {
      if (!isOpen) return;
      const target = isReadMode(current) ? ui.read : lastInput === "key" ? ui.close : root;
      target.focus({ preventScroll: true });
    });
  }

  // called by us (×, Escape, backdrop) and by core (Back button, App.go): hide, then let core fix history
  function close() {
    if (!isOpen) return;
    isOpen = false;
    loadToken++;
    clearTimeout(removeArmed);
    removeArmed = null;
    document.documentElement.classList.remove("vw-lock");
    root.hidden = true;
    root.classList.remove("is-entering", "is-zoomed", "is-panning");
    ui.img.removeAttribute("src");
    current = null;
    try { App.mediaClosed(); } catch (err) { console.error("[viewer] mediaClosed failed:", err); }
    const target = returnFocus;
    returnFocus = null;
    if (target && target.isConnected && typeof target.focus === "function") {
      try { target.focus({ preventScroll: true }); } catch (err) { /* element went away */ }
    }
  }

  function step(delta, how = "fade") {
    if (list.length < 2) return;
    index = (index + delta + list.length) % list.length;
    show(delta, how);
    try { App.mediaShown(list[index]); } catch (err) { console.error("[viewer] mediaShown failed:", err); }
  }

  // render list[index]; dir = -1/0/1 for the entrance animation
  function show(dir, how = "fade") {
    const m = media(list[index]);
    if (!m) return;
    current = m;
    clearTimeout(removeArmed);
    removeArmed = null;
    const reading = isReadMode(m);
    root.classList.toggle("is-read", reading);
    root.classList.toggle("is-single", list.length < 2);
    root.setAttribute("aria-label", `${kindLabel(m)}: ${cleanTitle(m)}`);
    ui.count.textContent = list.length > 1 ? `${index + 1} / ${list.length}` : "";
    ui.count.setAttribute("aria-label", list.length > 1 ? `Item ${index + 1} of ${list.length}` : "");
    for (const b of [ui.prev, ui.next, ui.barPrev, ui.barNext]) b.hidden = list.length < 2;
    ui.zoom.hidden = reading || !hasImage(m);
    ui.peekKind.textContent = kindLabel(m);
    ui.peekTitle.textContent = cleanTitle(m);

    ui.stage.hidden = reading;
    ui.read.hidden = !reading;
    ui.panel.hidden = reading;
    if (reading) {
      ui.read.replaceChildren(buildRead(m));
      ui.read.scrollTop = 0;
      animateIn(ui.read, dir, how);
    } else {
      ui.body.replaceChildren(...buildInfo(m));
      ui.body.scrollTop = 0;
      showStage(m, dir, how);
    }
    preloadNeighbours();
  }

  function animateIn(node, dir, how) {
    node.classList.remove("vw-in-fade", "vw-in-left", "vw-in-right");
    void node.offsetWidth;   // restart the animation
    node.classList.add(how === "slide" && dir ? (dir > 0 ? "vw-in-right" : "vw-in-left") : "vw-in-fade");
  }

  /* warm the cache for prev/next. Full-size scans run up to ~900 KB, so phones, data-saver and slow connections
     get only the neighbours' thumbnails (the stage shows the thumb at once and blurs it up when the full copy lands). */
  function lightPreload() {
    const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (c && (c.saveData || (c.effectiveType && c.effectiveType !== "4g"))) return true;
    return isPhone() || window.matchMedia("(pointer: coarse) and (max-width: 1099px)").matches;
  }
  function preloadNeighbours() {
    if (list.length < 2) return;
    const light = lightPreload();
    for (const d of [1, -1]) {
      const m = media(list[(index + d + list.length) % list.length]);
      if (!m || !hasImage(m)) continue;
      const url = light ? m.thumb || "" : m.src || m.thumb || "";
      if (url) { const pre = new Image(); pre.decoding = "async"; pre.src = mediaUrl(url); }
    }
  }

  /* ---------------------------------------------------------------- the image stage */
  const loaded = new Set();   // full-size urls already decoded once (no blur-up needed again)

  function showStage(m, dir, how) {
    const token = ++loadToken;
    ui.status.hidden = true;
    ui.loader.hidden = true;
    ui.frame.style.transform = "";
    ui.frame.style.opacity = "";
    root.style.removeProperty("--vw-fade");
    if (isPdf(m)) {
      ui.frame.hidden = true;
      ui.doc.hidden = false;
      ui.doc.replaceChildren(buildPdfTile(m));
      animateIn(ui.doc, dir, how);
      return;
    }
    ui.doc.hidden = true;
    ui.frame.hidden = false;
    ui.img.alt = cleanTitle(m);
    view.nw = m.w || 0;
    view.nh = m.h || 0;
    const full = m.src ? mediaUrl(m.src) : "";
    const thumb = m.thumb ? mediaUrl(m.thumb) : "";
    const ready = full && loaded.has(full);
    ui.img.classList.toggle("is-blurred", !ready && !!thumb && thumb !== full);
    ui.img.src = ready ? full : thumb || full;
    fit(false);
    animateIn(ui.frame, dir, how);
    if (!full || ready || full === ui.img.getAttribute("src") && ui.img.complete && ui.img.naturalWidth) {
      if (!view.nw) whenSized();
      if (full) loaded.add(full);
      return;
    }
    const spin = setTimeout(() => { if (token === loadToken) ui.loader.hidden = false; }, 180);
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      clearTimeout(spin);
      if (token !== loadToken) return;
      loaded.add(full);
      ui.loader.hidden = true;
      if (!view.nw) { view.nw = img.naturalWidth; view.nh = img.naturalHeight; fit(false); }
      ui.img.src = full;
      ui.img.classList.remove("is-blurred");
    };
    img.onerror = () => {
      clearTimeout(spin);
      if (token !== loadToken) return;
      ui.loader.hidden = true;
      ui.img.classList.remove("is-blurred");
      if (thumb && thumb !== full) showStatus("Showing a small copy. The full-size image couldn't be loaded.", "note");
      else { ui.frame.hidden = true; showStatus("This image couldn't be loaded.", "error"); }
    };
    img.src = full;
    // size unknown (some uploads): fit when the thumb arrives
    if (!view.nw) whenSized();
  }

  function whenSized() {
    const done = () => {
      if (!view.nw && ui.img.naturalWidth) { view.nw = ui.img.naturalWidth; view.nh = ui.img.naturalHeight; fit(false); }
    };
    if (ui.img.complete) done(); else ui.img.addEventListener("load", done, { once: true });
  }

  function showStatus(msg, kind) {
    ui.status.className = `vw-status is-${kind}`;
    ui.status.replaceChildren(icon(kind === "error" ? "image" : "info", 20), el("span", { text: msg }));
    ui.status.hidden = false;
  }

  function buildPdfTile(m) {
    return el("div", { class: "vw-doc-tile" },
      el("span", { class: "vw-doc-icon" }, icon("document", 44)),
      el("span", { class: "label" }, "PDF document"),
      el("span", { class: "vw-doc-title", text: cleanTitle(m) }),
      el("a", { class: "btn btn-primary", href: mediaUrl(m.src), target: "_blank", rel: "noopener" }, icon("external", 18), "Open PDF"));
  }

  // fit the image into the stage. keep = true preserves the zoom across a resize
  function fit(keep) {
    const rect = ui.stage.getBoundingClientRect();
    view.sw = rect.width;
    view.sh = rect.height;
    if (!view.sw || !view.sh) return;
    const nw = view.nw || 4, nh = view.nh || 3;
    const narrow = view.sw < 700;
    // leave room for the side arrows only where they're shown (desktop)
    const padX = narrow ? 8 : ui.prev.offsetParent ? 84 : 32;
    const padY = narrow ? 8 : 28;
    const s = Math.min((view.sw - 2 * padX) / nw, (view.sh - 2 * padY) / nh, view.nw ? UPSCALE_MAX : Infinity);
    const prevZ = view.z, prevBw = view.bw;
    // keep the same point in the middle of the stage when refitting while zoomed
    const cx = keep && prevBw ? (view.sw / 2 - view.tx) / (prevBw * prevZ) : 0.5;
    const cy = keep && prevBw ? (view.sh / 2 - view.ty) / (view.bh * prevZ) : 0.5;
    view.bw = Math.max(1, nw * s);
    view.bh = Math.max(1, nh * s);
    ui.img.style.width = `${view.bw}px`;
    ui.img.style.height = `${view.bh}px`;
    view.z = keep ? prevZ : 1;
    view.tx = view.sw / 2 - cx * view.bw * view.z;
    view.ty = view.sh / 2 - cy * view.bh * view.z;
    apply();
  }

  function clampView() {
    const w = view.bw * view.z, h = view.bh * view.z;
    view.tx = w <= view.sw ? (view.sw - w) / 2 : Math.min(0, Math.max(view.sw - w, view.tx));
    view.ty = h <= view.sh ? (view.sh - h) / 2 : Math.min(0, Math.max(view.sh - h, view.ty));
  }

  function apply(animate) {
    clampView();
    if (animate) {
      ui.img.classList.add("is-animating");
      clearTimeout(apply.timer);
      apply.timer = setTimeout(() => ui.img.classList.remove("is-animating"), 260);
    }
    ui.img.style.transform = `translate3d(${view.tx}px, ${view.ty}px, 0) scale(${view.z})`;
    const zoomed = view.z > 1.01;
    root.classList.toggle("is-zoomed", zoomed);
    ui.zoomLevel.textContent = `${Math.round(view.z * 100)}%`;
    ui.zoomOut.disabled = !zoomed;
    ui.zoomIn.disabled = view.z >= ZOOM_MAX - 0.01;
  }

  // zoom to z around the stage point (px, py)
  function zoomAt(z, px, py, animate) {
    const nz = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
    const ix = (px - view.tx) / view.z, iy = (py - view.ty) / view.z;
    view.tx = px - ix * nz;
    view.ty = py - iy * nz;
    view.z = nz;
    apply(animate);
  }
  const zoomBy = f => { if (hasImage(current)) zoomAt(view.z * f, view.sw / 2, view.sh / 2, true); };
  const zoomTo = z => { if (hasImage(current)) zoomAt(z, view.sw / 2, view.sh / 2, true); };
  function toggleZoom(px, py) {
    if (view.z > 1.01) zoomAt(1, px, py, true);
    else zoomAt(ZOOM_STEP, px, py, true);
  }
  const onImageAt = pt => pt.x >= view.tx && pt.x <= view.tx + view.bw * view.z && pt.y >= view.ty && pt.y <= view.ty + view.bh * view.z;
  function stagePoint(e) {
    const r = ui.stage.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onWheel(e) {
    if (!hasImage(current) || ui.frame.hidden) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? view.sh : 1;
    const dy = Math.max(-120, Math.min(120, e.deltaY * unit));
    // ctrl+wheel is also what a trackpad pinch sends: it arrives in small steps, so it gets more weight
    const f = Math.exp(-dy * (e.ctrlKey ? 0.012 : 0.0025));
    const pt = stagePoint(e);
    zoomAt(view.z * f, pt.x, pt.y);
  }

  function onDblClick(e) {
    if (lastPointerType === "touch" || !hasImage(current) || ui.frame.hidden) return;
    // pointer capture retargets dblclick to the stage, so hit-test the image box
    const pt = stagePoint(e);
    if (!onImageAt(pt) && view.z <= 1.01) return;
    toggleZoom(pt.x, pt.y);
  }

  /* ---------------------------------------------------------------- pointer gestures */
  // one pointer: pan when zoomed, swipe (touch) when not. two pointers: pinch. a press that doesn't move is a
  // tap/click: outside the image it closes the viewer; two quick taps toggle the zoom.
  const pointers = new Map();
  let gesture = null;
  let lastPointerType = "mouse";
  let lastTap = null;
  let tapTimer = null;

  function startOnePointer(p, carryMoved) {
    gesture = {
      type: view.z > 1.01 ? "pan" : p.type === "mouse" ? "none" : "swipe",
      sx: p.x, sy: p.y, tx0: view.tx, ty0: view.ty,
      moved: !!carryMoved, onImage: p.onImage, dx: 0, dy: 0, axis: null,
    };
  }
  function startPinch() {
    const [a, b] = [...pointers.values()];
    gesture = {
      type: "pinch", moved: true,
      d0: Math.hypot(b.x - a.x, b.y - a.y) || 1,
      m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      z0: view.z, tx0: view.tx, ty0: view.ty,
    };
    resetFrame(false);
  }

  function onPointerDown(e) {
    if (!hasImage(current) || ui.frame.hidden) {
      // pdf tile / error message: only a click on the empty backdrop closes
      if (e.target === ui.stage && e.button === 0) {
        const up = ev => { ui.stage.removeEventListener("pointerup", up); if (ev.target === ui.stage) backdropTap(); };
        ui.stage.addEventListener("pointerup", up);
      }
      return;
    }
    if (e.pointerType === "mouse" && e.button !== 0) return;
    lastPointerType = e.pointerType;
    try { ui.stage.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events */ }
    const pt = stagePoint(e);
    pointers.set(e.pointerId, { x: pt.x, y: pt.y, type: e.pointerType, onImage: onImageAt(pt) });
    if (pointers.size === 1) {
      startOnePointer(pointers.get(e.pointerId));
      ui.stage.addEventListener("pointermove", onPointerMove);
      ui.stage.addEventListener("pointerup", onPointerUp);
      ui.stage.addEventListener("pointercancel", onPointerUp);
    } else if (pointers.size === 2) startPinch();
  }

  function onPointerMove(e) {
    const p = pointers.get(e.pointerId);
    if (!p || !gesture) return;
    const pt = stagePoint(e);
    p.x = pt.x;
    p.y = pt.y;
    if (gesture.type === "pinch" && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const nz = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, gesture.z0 * d / gesture.d0));
      const ix = (gesture.m0.x - gesture.tx0) / gesture.z0, iy = (gesture.m0.y - gesture.ty0) / gesture.z0;
      view.z = nz;
      view.tx = mid.x - ix * nz;
      view.ty = mid.y - iy * nz;
      apply();
      return;
    }
    const dx = pt.x - gesture.sx, dy = pt.y - gesture.sy;
    if (!gesture.moved && Math.hypot(dx, dy) > TAP_SLOP) gesture.moved = true;
    if (!gesture.moved) return;
    if (gesture.type === "pan") {
      root.classList.add("is-panning");
      view.tx = gesture.tx0 + dx;
      view.ty = gesture.ty0 + dy;
      apply();
    } else if (gesture.type === "swipe") {
      gesture.axis ||= Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
      gesture.dx = dx;
      gesture.dy = dy;
      if (gesture.axis === "x" && list.length > 1) {
        ui.frame.style.transform = `translate3d(${dx}px, 0, 0)`;
        ui.frame.style.opacity = String(Math.max(0.35, 1 - Math.abs(dx) / (view.sw * 1.2)));
      } else if (gesture.axis === "y" && dy > 0) {
        // pull down to close
        ui.frame.style.transform = `translate3d(0, ${dy}px, 0)`;
        root.style.setProperty("--vw-fade", String(Math.max(0.35, 1 - dy / 420)));
      }
    }
  }

  function onPointerUp(e) {
    if (!pointers.has(e.pointerId)) return;
    const p = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (gesture && gesture.type === "pinch") {
      if (pointers.size === 1) startOnePointer([...pointers.values()][0], true);
      else if (!pointers.size) gesture = null;
      return;
    }
    if (pointers.size) return;
    ui.stage.removeEventListener("pointermove", onPointerMove);
    ui.stage.removeEventListener("pointerup", onPointerUp);
    ui.stage.removeEventListener("pointercancel", onPointerUp);
    root.classList.remove("is-panning");
    const g = gesture;
    gesture = null;
    if (!g || e.type === "pointercancel") { resetFrame(true); return; }
    if (g.type === "swipe" && g.moved) {
      if (g.axis === "x" && Math.abs(g.dx) > SWIPE_MIN && list.length > 1) { resetFrame(false); step(g.dx < 0 ? 1 : -1, "slide"); }
      else if (g.axis === "y" && g.dy > 110) { resetFrame(false); close(); }
      else resetFrame(true);
      return;
    }
    if (g.moved) return;
    // a tap or click
    const pt = { x: p.x, y: p.y };
    // with the drawer open, a tap or click anywhere on the dimmed image collapses the drawer and nothing else
    if (drawerOpen && drawerLayout()) { lastTap = null; clearTimeout(tapTimer); setDrawer(false); return; }
    if (p.type === "mouse") { if (!p.onImage) close(); return; }
    const now = performance.now();
    if (lastTap && now - lastTap.t < DOUBLE_TAP_MS && Math.hypot(pt.x - lastTap.x, pt.y - lastTap.y) < 36) {
      clearTimeout(tapTimer);
      lastTap = null;
      toggleZoom(pt.x, pt.y);
      return;
    }
    lastTap = { t: now, x: pt.x, y: pt.y };
    if (!p.onImage && view.z <= 1.01) {
      // wait to see whether a second tap follows before closing
      clearTimeout(tapTimer);
      tapTimer = setTimeout(() => { if (lastTap && isOpen) backdropTap(); }, DOUBLE_TAP_MS);
    }
  }

  // a tap on the empty backdrop: closes the viewer, or only collapses the open info drawer
  function backdropTap() {
    if (drawerOpen && drawerLayout()) { setDrawer(false); return; }
    close();
  }

  function resetFrame(animate) {
    ui.frame.classList.toggle("is-returning", !!animate);
    ui.frame.style.transform = "";
    ui.frame.style.opacity = "";
    root.style.removeProperty("--vw-fade");
    if (animate) setTimeout(() => ui.frame.classList.remove("is-returning"), 240);
  }

  // reading layout (stories, image-less records): a horizontal touch swipe also moves prev/next.
  // .vw-read is touch-action: pan-y, so vertical scrolling stays native; tables that scroll sideways are left alone.
  function onReadDown(e) {
    if (e.pointerType !== "touch" || list.length < 2 || e.target.closest(".vw-table-wrap")) return;
    const sx = e.clientX, sy = e.clientY;
    const done = ev => {
      ui.read.removeEventListener("pointerup", done);
      ui.read.removeEventListener("pointercancel", done);
      if (ev.type !== "pointerup") return;
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (Math.abs(dx) > SWIPE_MIN + 14 && Math.abs(dx) > Math.abs(dy) * 1.6) step(dx < 0 ? 1 : -1, "slide");
    };
    ui.read.addEventListener("pointerup", done);
    ui.read.addEventListener("pointercancel", done);
  }

  /* ---------------------------------------------------------------- keyboard, focus trap, drawer */
  function focusables() {
    return $$('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])', root)
      .filter(n => !n.disabled && !n.closest("[hidden]") && n.getClientRects().length && getComputedStyle(n).visibility !== "hidden");
  }

  function onKeyDown(e) {
    if (!isOpen) return;
    // another dialog on top (the editor) handles its own keys
    if (e.target !== document.body && !root.contains(e.target)) return;
    // the page behind (chart keyboard, "/" search) must not react while the viewer is open
    e.stopPropagation();
    const typing = /^(input|textarea|select)$/i.test(e.target.tagName || "");
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key === "Tab") {
      const items = focusables();
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1];
      const at = items.indexOf(document.activeElement);
      if (e.shiftKey && (at <= 0)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (at === -1 || at === items.length - 1)) { e.preventDefault(); first.focus(); }
      return;
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    // a table or reading column that scrolls sideways keeps its arrow keys (native scrolling)
    if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && sidewaysScroller(e.target)) return;
    if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
    else if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomBy(1.5); }
    else if (e.key === "-" || e.key === "_") { e.preventDefault(); zoomBy(1 / 1.5); }
    else if (e.key === "0") { e.preventDefault(); zoomTo(1); }
  }

  function sidewaysScroller(target) {
    const box = target && target.closest && target.closest(".vw-table-wrap, .vw-read");
    return !!box && box.scrollWidth > box.clientWidth + 1;
  }

  function setDrawer(openIt) {
    drawerOpen = !!openIt;
    root.classList.toggle("is-drawer-open", drawerOpen);
    ui.peek.setAttribute("aria-expanded", String(drawerOpen));
    ui.peek.setAttribute("aria-label", drawerOpen ? "Hide details" : "Show details");
  }

  // phone: drag the drawer handle up to open, down to close (a plain tap toggles via click)
  let peekDrag = null;
  function onPeekDown(e) {
    if (e.pointerType === "mouse") return;
    peekDrag = { y: e.clientY, done: false };
    const move = ev => {
      if (!peekDrag || peekDrag.done) return;
      const dy = ev.clientY - peekDrag.y;
      if (Math.abs(dy) > 28) { peekDrag.done = true; setDrawer(dy < 0); }
    };
    const up = () => {
      ui.peek.removeEventListener("pointermove", move);
      ui.peek.removeEventListener("pointerup", up);
      ui.peek.removeEventListener("pointercancel", up);
      // a drag already toggled: swallow the click that follows
      if (peekDrag && peekDrag.done) {
        const swallow = ev => { ev.stopImmediatePropagation(); ev.preventDefault(); };
        ui.peek.addEventListener("click", swallow, { once: true, capture: true });
        setTimeout(() => ui.peek.removeEventListener("click", swallow, { capture: true }), 400);
      }
      peekDrag = null;
    };
    ui.peek.addEventListener("pointermove", move);
    ui.peek.addEventListener("pointerup", up);
    ui.peek.addEventListener("pointercancel", up);
  }

  /* ---------------------------------------------------------------- info: title, facts, transcription */
  // "Wilmington, New Castle, Delaware, USA" -> "Wilmington, New Castle, Delaware" (full place, minus the country)
  function fullPlace(place) {
    const out = [];
    for (const s of String(place || "").split(",").map(x => x.trim()).filter(Boolean)) {
      if (/^(usa|united states( of america)?|u\.s\.a\.?)$/i.test(s)) continue;
      if (out[out.length - 1] !== s) out.push(s);
    }
    return out.join(", ");
  }
  const section = (title, cls, ...kids) =>
    el("section", { class: ["vw-sec", cls] }, title ? el("h3", { class: "label vw-sec-title", text: title }) : null, kids);

  function head(m, level) {
    const owner = ownerOf(m);
    const date = cleanDate(m.date);
    const place = fullPlace(m.place);
    // an upload date says so, and the uploader's town is dropped (it isn't where the photo was taken)
    const meta = m.kind === "record"
      ? [m.year && String(m.year), m.coll && m.coll !== m.title ? m.coll : null]
      : isUploadDate(m) ? [`Added to Ancestry ${date}`] : [date, place];
    return el("header", { class: "vw-head" },
      el("p", { class: "label vw-kind" },
        el("span", { class: "marker", style: { "--lc": owner ? lineColor(P[owner]) : "var(--none)" } }),
        kindLabel(m)),
      el(level, { class: "vw-title", text: cleanTitle(m) }),
      meta.some(Boolean) ? el("p", { class: "vw-meta" }, meta.filter(Boolean).join(" · ")) : null);
  }

  // label/value rows: date, place, indexed name, collection
  function facts(m) {
    const rows = [];
    if (m.kind === "record") {
      // the indexed name, unless the transcription already shows it verbatim
      if (m.name && m.name !== m.title && !(m.fields || []).some(f => f && f[1] === m.name)) rows.push(["Indexed as", m.name]);
      if (m.coll && m.coll !== m.title) rows.push(["Collection", m.coll]);
      if (m.date) rows.push(["Date", cleanDate(m.date)]);
      if (m.place) rows.push(["Place", fullPlace(m.place)]);
    } else {
      // date and place are already in the title block
      if (m.added) {
        const d = new Date(m.added);
        if (!isNaN(d)) rows.push(["Added", `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}${m.by ? ` by ${m.by}` : ""}`]);
      }
    }
    if (!rows.length) return null;
    return el("dl", { class: "vw-facts" }, rows.map(([k, v]) => el("div", { class: "vw-fact" }, el("dt", { class: "label", text: k }), el("dd", { text: v }))));
  }

  function description(m) {
    if (!m.desc || !String(m.desc).trim()) return null;
    return el("div", { class: "vw-desc" }, paragraphs(m.desc).map(t => el("p", {}, linkify(t))));
  }

  function transcription(m) {
    const fields = (m.fields || []).filter(f => f && f[0] && f[1] != null && String(f[1]).trim());
    if (!fields.length) return null;
    return section("Transcription", "vw-sec-fields",
      el("table", { class: "vw-fields" },
        el("tbody", {}, fields.map(([k, v]) => el("tr", {}, el("th", { scope: "row", text: k }), el("td", {}, linkify(v)))))));
  }

  // household members and other tables: each scrolls sideways inside its own box
  function tables(m) {
    return (m.tables || []).filter(t => Array.isArray(t) && t.length > 1).map(t => {
      const [header, ...rows] = t;
      const household = /^household members/i.test(String(header[0] || ""));
      const cols = header.map(h => String(h || "").replace(/^household members\s*\((.*)\)$/i, "$1").replace(/^household members\s*/i, "") || "Name");
      const indexed = String(m.name || "").toLowerCase();
      let marked = false;
      return section(household ? `Household · ${plural(rows.length, "person", "people")}` : "Table", "vw-sec-table",
        el("div", { class: "vw-table-wrap", tabindex: "0", role: "region", "aria-label": household ? "Household members" : "Table" },
          el("table", { class: "vw-table" },
            el("thead", {}, el("tr", {}, cols.map(c => el("th", { scope: "col", text: c })))),
            el("tbody", {}, rows.map(r => {
              const self = !marked && indexed && String(r[0] || "").toLowerCase() === indexed;
              if (self) marked = true;
              return el("tr", { class: self ? "is-self" : null }, header.map((_, i) => el("td", { text: r[i] == null ? "" : String(r[i]) })));
            })))));
    });
  }

  function citation(m) {
    if (!m.citation) return null;
    return section("Citation", "vw-sec-cite", el("p", { class: "vw-cite" }, linkify(m.citation)));
  }

  function story(m) {
    const paras = paragraphs(m.text);
    if (!paras.length) return null;
    return el("div", { class: "vw-prose" }, paras.map(t => el("p", {}, linkify(t))));
  }

  /* ---------------------------------------------------------------- info: people, actions, credit */
  function people(m) {
    const pids = (m.people || []).filter(pid => P[pid]);
    if (!pids.length) return null;
    const title = m.kind === "record" ? (pids.length > 1 ? "People in this record" : "Person in this record")
      : pids.length > 1 ? "People" : "Person";
    return section(title, "vw-sec-people",
      el("ul", { class: "vw-people" }, pids.map(pid => {
        const p = P[pid];
        const sub = [years(p), p.rel].filter(Boolean).join(" · ");
        return el("li", {},
          el("button", { class: "vw-person", type: "button", onclick: () => App.go(pid, { scroll: true }), title: `Show ${p.name} in the tree` },
            decorative(avatar(p, { size: 40, decorative: true })),
            el("span", { class: "vw-person-text" },
              el("span", { class: "vw-person-name", text: p.name }),
              sub ? el("span", { class: "vw-person-sub", text: sub }) : null),
            el("span", { class: "vw-person-go" }, icon("arrow-right", 18))));
      })));
  }

  function linkBtn(href, label, iconName, extra = {}) {
    return el("a", { class: "btn vw-action", href, target: "_blank", rel: "noopener noreferrer", ...extra }, icon(iconName, 18), el("span", { text: label }));
  }

  function actions(m) {
    const out = [];
    const link = safeHref(m.link), external = safeHref(m.external);
    if (link) {
      const host = hostLabel(link);
      out.push(linkBtn(link, host === "Ancestry" ? "Open on Ancestry" : `Open on ${host}`, "external"));
    }
    if (external && external !== link) out.push(linkBtn(external, `Open on ${hostLabel(external)}`, "external"));
    if (m.src && (hasImage(m) || isPdf(m))) {
      out.push(el("a", { class: "btn vw-action", href: mediaUrl(m.src), download: downloadName(m) }, icon("download", 18), el("span", { text: "Download" })));
    }
    out.push(...editorActions(m));
    return out.length ? el("div", { class: "vw-actions" }, out) : null;
  }

  // shown only when the editor is connected: "Use as profile photo" (photos) and "Remove" (uploads)
  function editorActions(m) {
    if (!editorOn()) return [];
    const out = [];
    const owner = ownerOf(m);
    const p = owner && P[owner];
    if (editorHas("setAvatar") && p && m.kind === "photo" && hasImage(m)) {
      const multi = (m.people || []).filter(pid => P[pid]).length > 1;
      if (p.photo === m.id) {
        out.push(el("button", { class: "btn vw-action", type: "button", disabled: true }, icon("check", 18),
          el("span", { text: multi ? `${firstName(p)}'s profile photo` : "Profile photo" })));
      } else {
        const btn = el("button", { class: "btn vw-action", type: "button" }, icon("star", 18),
          el("span", { text: multi ? `Use as ${firstName(p)}'s profile photo` : "Use as profile photo" }));
        btn.addEventListener("click", () => runEditor(btn, "Saving…", () => App.editor.setAvatar(owner, m.id)));
        out.push(btn);
      }
    }
    if (editorHas("remove") && String(m.id).startsWith("u-")) {
      const btn = el("button", { class: "btn vw-action vw-remove", type: "button" }, icon("trash", 18), el("span", { text: "Remove" }));
      // the editor asks for confirmation in its own dialog (it explains the file stays in git history)
      btn.addEventListener("click", () => runEditor(btn, "Removing…", () => App.editor.remove(m.id)));
      out.push(btn);
    }
    return out;
  }

  // run an editor call (sync or promise) with a busy button; the editor reports errors itself
  function runEditor(btn, busyText, fn) {
    const label = btn.lastElementChild, before = label.textContent;
    btn.disabled = true;
    label.textContent = busyText;
    const restore = () => { if (btn.isConnected) { btn.disabled = false; label.textContent = before; } };
    let result;
    try { result = fn(); } catch (err) { console.error("[viewer] editor action failed:", err); restore(); return; }
    Promise.resolve(result).then(() => {
      // a "media" event normally re-renders the panel; refresh anyway in case it didn't come
      if (btn.isConnected && current) rerender();
    }, err => { console.error("[viewer] editor action failed:", err); restore(); });
  }

  function credit(m) {
    if (!m.credit) return null;
    return el("p", { class: "vw-credit" }, m.credit);
  }

  /* ---------------------------------------------------------------- the two layouts */
  function buildInfo(m) {
    const isRecord = m.kind === "record";
    return [
      head(m, "h2"),
      facts(m),
      description(m),
      actions(m),
      people(m),
      isRecord ? transcription(m) : null,
      isRecord ? tables(m) : null,
      citation(m),
      credit(m),
    ].flat().filter(Boolean);
  }

  function buildRead(m) {
    const isStory = m.kind === "story";
    return el("article", { class: ["vw-article", isStory ? "is-story" : "is-record"] },
      head(m, "h2"),
      isStory ? null : el("p", { class: "vw-noscan" }, icon("document", 18),
        el("span", { text: "No image of this record was saved. This is the transcription." })),
      facts(m),
      description(m),
      isStory ? story(m) : null,
      isStory ? null : transcription(m),
      isStory ? null : tables(m),
      citation(m),
      el("footer", { class: "vw-article-foot" }, people(m), actions(m), credit(m)));
  }

  function rerender() {
    if (!isOpen || !current) return;
    if (isReadMode(current)) {
      const y = ui.read.scrollTop;
      ui.read.replaceChildren(buildRead(current));
      ui.read.scrollTop = y;
    } else {
      const y = ui.body.scrollTop;
      ui.body.replaceChildren(...buildInfo(current));
      ui.body.scrollTop = y;
    }
  }

  // the editor added, removed or re-pointed something
  function onMediaChanged() {
    if (!isOpen) return;
    const shownId = current && current.id;
    list = list.filter(id => media(id));
    if (!list.length) { close(); return; }
    if (shownId && media(shownId)) {
      index = list.indexOf(shownId);
      ui.count.textContent = list.length > 1 ? `${index + 1} / ${list.length}` : "";
      rerender();
      return;
    }
    // the shown item was removed: show its neighbour
    index = Math.min(index, list.length - 1);
    show(0);
    try { App.mediaShown(list[index]); } catch (err) { console.error("[viewer] mediaShown failed:", err); }
  }

  /* ---------------------------------------------------------------- register */
  function mount(body) {
    if (root) return;
    (body || document.body).append(build());
    window.addEventListener("keydown", onKeyDown, true);
    // remember the last kind of input, for where focus goes when the viewer opens
    window.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " " || e.key === "Tab") lastInput = "key"; }, true);
    window.addEventListener("pointerdown", () => { lastInput = "pointer"; }, true);
    // leaving the drawer layout (a tablet turned sideways) drops the drawer state
    DRAWER_QUERY.addEventListener("change", () => { if (!drawerLayout() && drawerOpen) setDrawer(false); });
  }

  App.viewer = { mount, open, close };
})();
