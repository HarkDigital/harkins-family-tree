/* editor.js: add photos and documents for anyone, straight from the site.
   GitHub Pages is static, so every change is one commit to the repo through the GitHub REST API, made with a
   fine-grained personal access token the editor keeps in this browser:
     docs/media/added.json            the manifest {version, items, avatars}
     docs/media/added/<file>.jpg|pdf  full-size uploads (images resized to <= 2400px)
     docs/media/added/t/<file>.jpg    480px thumbnails
   The token is only ever sent to https://api.github.com in an Authorization header. It is never logged and
   never put in a URL. Text people type is put in the DOM with textContent only.
   Registers App.editor (see the README "Editor" section). */
(() => {
  const API = "https://api.github.com";
  const TOKEN_KEY = "hft.githubToken";      // sessionStorage by default, localStorage with "Remember"
  const LOGIN_KEY = "hft.githubLogin";      // the GitHub login that goes in each item's "by"
  const USED_KEY = "hft.editorUsed";        // "1" once this browser has connected: keeps the add buttons visible
  const MANIFEST_PATH = "docs/media/added.json";
  const ADDED_DIR = "docs/media/added";
  const MAX_EDGE = 2400, THUMB_EDGE = 480;
  const JPEG_Q = 0.86, THUMB_Q = 0.8;
  const MAX_PDF = 20 * 1024 * 1024;
  const MAX_IMAGE_BYTES = 50 * 1024 * 1024;   // bigger files are refused before decoding (they can crash a phone tab)
  const MAX_PIXELS = 100e6;                   // 100 megapixels: refused after reading the size, before drawing
  const PID_RE = /^@[A-Za-z0-9-]+@$/;
  const MID_RE = /^u-[A-Za-z0-9-]{1,64}$/;
  const KIND_ORDER = { photo: 0, headstone: 1, document: 2, story: 3, record: 4 };
  const KINDS = [["photo", "Photo"], ["headstone", "Headstone"], ["document", "Document"]];
  const TOKEN_URL = "https://github.com/settings/personal-access-tokens/new";
  const PUBLIC_URL = "https://harkdigital.github.io/harkins-family-tree/";
  // a fixed blob used to prove the token can write: the same content always has the same sha, so the
  // check never adds anything new to the repository
  const PROBE_TEXT = "hft editor write check\n";

  const repo = () => ({ owner: "HarkDigital", name: "harkins-family-tree", branch: "main", ...(D.repo || {}) });
  const repoName = () => `${repo().owner}/${repo().name}`;
  const repoPath = rest => `/repos/${encodeURIComponent(repo().owner)}/${encodeURIComponent(repo().name)}${rest}`;

  /* ---------------------------------------------------------------- token storage (never throws) */
  const safeStore = kind => {
    try { const s = window[kind]; s.getItem("x"); return s; } catch (e) { return null; }
  };
  const session = safeStore("sessionStorage"), local = safeStore("localStorage");
  const read = (s, k) => { try { return s ? s.getItem(k) : null; } catch (e) { return null; } };
  const write = (s, k, v) => { try { if (!s) return; if (v == null) s.removeItem(k); else s.setItem(k, v); } catch (e) { /* full or blocked */ } };

  const tokenInfo = () => {
    const s = read(session, TOKEN_KEY);
    if (s) return { token: s, remembered: false, login: read(session, LOGIN_KEY) || "" };
    const l = read(local, TOKEN_KEY);
    if (l) return { token: l, remembered: true, login: read(local, LOGIN_KEY) || "" };
    return null;
  };
  const getToken = () => (tokenInfo() || {}).token || "";
  function saveToken(token, login, remember) {
    forgetToken();
    const s = remember ? local : session;
    write(s, TOKEN_KEY, token);
    write(s, LOGIN_KEY, login || "");
    write(local, USED_KEY, "1");
  }
  function forgetToken() {
    for (const s of [session, local]) { write(s, TOKEN_KEY, null); write(s, LOGIN_KEY, null); }
  }
  /* "github_pat_…k9Qz": enough to recognise a token, useless to anyone reading the screen */
  const maskToken = t => {
    if (!t) return "";
    const head = /^github_pat_/.test(t) ? "github_pat_" : /^gh[pousr]_/.test(t) ? t.slice(0, 4) : "";
    return `${head}…${t.slice(-4)}`;
  };

  /* ---------------------------------------------------------------- GitHub client */
  class GitHubError extends Error {
    constructor(status, message, detail) { super(message); this.status = status; this.detail = detail || ""; }
  }
  /* gh("GET", "/repos/..."): JSON or throws GitHubError. path is always an API path; the token goes in
     the header only. */
  async function gh(method, path, body, token = getToken()) {
    if (!token) throw new GitHubError(0, "Not connected to GitHub.");
    if (typeof path !== "string" || !path.startsWith("/")) throw new GitHubError(0, "Bad API path.");
    let res;
    try {
      res = await fetch(API + path, {
        method,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
    } catch (err) {
      throw new GitHubError(0, "Couldn't reach GitHub. Check the internet connection and try again.");
    }
    let data = null;
    const text = await res.text().catch(() => "");
    if (text) { try { data = JSON.parse(text); } catch (e) { data = null; } }
    if (!res.ok) throw new GitHubError(res.status, (data && data.message) || `GitHub answered ${res.status}.`, res.headers.get("x-ratelimit-remaining") === "0" ? "rate" : "");
    return data;
  }
  /* turn a GitHubError into one plain sentence for the dialogs */
  function explain(err) {
    if (!(err instanceof GitHubError)) return "Something went wrong. Nothing was changed. Try again.";
    if (err.status === 0) return err.message;
    if (err.status === 401) return "GitHub didn't accept that token. It may be mistyped, expired or revoked. Make a new one and paste it here.";
    if (err.status === 403 && err.detail === "rate") return "GitHub is limiting requests right now. Wait a few minutes and try again.";
    if (err.status === 403) return `This token can't write to ${repoName()}. In the token's settings, set Contents to “Read and write”.`;
    if (err.status === 404) return `This token can't see ${repoName()}. Under Repository access, choose “Only select repositories” and pick ${repoName()}.`;
    if (err.status === 409 || err.status === 422) return "Someone else changed the site at the same moment. Nothing was lost: try again.";
    if (err.status >= 500) return "GitHub is having trouble right now. Nothing was changed. Try again in a minute.";
    return `GitHub said: ${err.message}`;
  }

  /* Test a token: it must see the repo, have push access and be able to create a blob there.
     Returns {login}; throws GitHubError (with a 403 when it can only read). */
  async function testToken(token) {
    const info = await gh("GET", repoPath(""), null, token);
    if (!info || !info.permissions || !info.permissions.push) {
      throw new GitHubError(403, "no push");
    }
    await gh("POST", repoPath("/git/blobs"), { content: PROBE_TEXT, encoding: "utf-8" }, token);
    let login = "";
    try { const me = await gh("GET", "/user", null, token); login = (me && me.login) || ""; } catch (e) { /* optional */ }
    return { login };
  }

  /* ---------------------------------------------------------------- encoding helpers */
  function bytesToBase64(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  const textToBase64 = text => bytesToBase64(new TextEncoder().encode(text));
  function base64ToText(b64) {
    const bin = atob(String(b64 || "").replace(/\s+/g, ""));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  const blobToBase64 = blob => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).slice(String(r.result).indexOf(",") + 1));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
  const randomHex = n => Array.from(crypto.getRandomValues(new Uint8Array(Math.ceil(n / 2))), b => b.toString(16).padStart(2, "0")).join("").slice(0, n);
  const slugify = s => fold(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48).replace(/-+$/, "") || "item";
  const formatBytes = n => n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

  /* ---------------------------------------------------------------- manifest and commits */
  const emptyManifest = () => ({ version: 1, items: [], avatars: {} });
  function normalizeManifest(m) {
    const out = m && typeof m === "object" && !Array.isArray(m) ? m : emptyManifest();
    if (!out.version) out.version = 1;
    if (!Array.isArray(out.items)) out.items = [];
    if (!out.avatars || typeof out.avatars !== "object" || Array.isArray(out.avatars)) out.avatars = {};
    return out;
  }
  /* the manifest as of commit sha; a missing file (404) is a new, empty manifest */
  async function loadManifest(sha) {
    let file;
    try {
      file = await gh("GET", repoPath(`/contents/${MANIFEST_PATH}?ref=${encodeURIComponent(sha)}`));
    } catch (err) {
      if (err.status === 404) return emptyManifest();
      throw err;
    }
    let text = file && file.encoding === "base64" && file.content ? base64ToText(file.content) : null;
    if (text == null && file && file.sha) {   // over 1 MB the contents API leaves content empty
      const blob = await gh("GET", repoPath(`/git/blobs/${encodeURIComponent(file.sha)}`));
      text = base64ToText(blob.content);
    }
    try { return normalizeManifest(JSON.parse(text || "{}")); } catch (e) {
      throw new GitHubError(0, `${MANIFEST_PATH} in the repository isn't valid JSON, so nothing was changed. Fix it on GitHub first.`);
    }
  }
  /* the files currently in a folder at commit sha (a Set of paths); a missing folder is empty */
  async function listFolder(dir, sha) {
    try {
      const list = await gh("GET", repoPath(`/contents/${dir}?ref=${encodeURIComponent(sha)}`));
      return new Set((Array.isArray(list) ? list : []).filter(f => f.type === "file").map(f => f.path));
    } catch (err) {
      if (err.status === 404) return new Set();
      throw err;
    }
  }

  /* One atomic commit: ref -> commit -> manifest -> blobs -> tree -> commit -> PATCH ref.
     change(manifest) edits the fresh manifest in place and returns {deletes: [paths]} (or nothing); it runs again
     on the retry, so it must be safe to repeat. files: [{path, blob}] new files to add.
     onStep({label, done, total}) reports progress. Retries once from the top when the branch moved (409/422). */
  async function commitChange({ message, files = [], change, onStep = () => {} }) {
    const branch = repo().branch;
    const blobShas = new Map();    // path -> sha, kept across the retry so big files go up once
    const total = files.length + 4;
    let lastErr;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        let done = 0;
        onStep({ label: attempt ? "The site changed meanwhile. Trying again…" : "Connecting to GitHub…", done, total });
        const ref = await gh("GET", repoPath(`/git/ref/heads/${encodeURIComponent(branch)}`));
        const headSha = ref.object.sha;
        const head = await gh("GET", repoPath(`/git/commits/${encodeURIComponent(headSha)}`));
        const manifest = await loadManifest(headSha);
        const result = change(manifest) || {};
        onStep({ label: "Connected", done: ++done, total });

        const entries = [];
        for (const [i, f] of files.entries()) {
          if (!blobShas.has(f.path)) {
            onStep({ label: files.length > 1 ? `Uploading file ${i + 1} of ${files.length}…` : "Uploading…", done, total });
            const blob = await gh("POST", repoPath("/git/blobs"), { content: await blobToBase64(f.blob), encoding: "base64" });
            blobShas.set(f.path, blob.sha);
          }
          entries.push({ path: f.path, mode: "100644", type: "blob", sha: blobShas.get(f.path) });
          onStep({ label: `Uploaded ${i + 1} of ${files.length}`, done: ++done, total });
        }

        onStep({ label: "Saving the list of added items…", done, total });
        const text = JSON.stringify(manifest, null, 2) + "\n";
        const mblob = await gh("POST", repoPath("/git/blobs"), { content: textToBase64(text), encoding: "base64" });
        entries.push({ path: MANIFEST_PATH, mode: "100644", type: "blob", sha: mblob.sha });

        // deleting a path that isn't there fails the whole tree, so only delete what exists
        const deletes = (result.deletes || []).filter(Boolean);
        if (deletes.length) {
          const present = new Set();
          for (const dir of new Set(deletes.map(p => p.slice(0, p.lastIndexOf("/"))))) {
            for (const p of await listFolder(dir, headSha)) present.add(p);
          }
          for (const p of deletes) if (present.has(p)) entries.push({ path: p, mode: "100644", type: "blob", sha: null });
        }
        onStep({ label: "Saving…", done: ++done, total });

        const tree = await gh("POST", repoPath("/git/trees"), { base_tree: head.tree.sha, tree: entries });
        const commit = await gh("POST", repoPath("/git/commits"), { message, tree: tree.sha, parents: [headSha] });
        onStep({ label: "Publishing…", done: ++done, total });
        await gh("PATCH", repoPath(`/git/refs/heads/${encodeURIComponent(branch)}`), { sha: commit.sha, force: false });
        onStep({ label: "Published", done: total, total });
        return { commit: commit.sha, manifest };
      } catch (err) {
        lastErr = err;
        if (attempt === 0 && err instanceof GitHubError && (err.status === 409 || err.status === 422)) continue;
        throw err;
      }
    }
    throw lastErr;
  }

  /* ---------------------------------------------------------------- merging into D */
  /* insert mid into the person's media after the last item of the same or an earlier kind */
  function insertMedia(p, mid) {
    p.media = Array.isArray(p.media) ? p.media.filter(x => x !== mid) : [];
    const rank = KIND_ORDER[(D.media[mid] || {}).kind] ?? 9;
    let at = p.media.length;
    for (let i = 0; i < p.media.length; i++) {
      const m = D.media[p.media[i]];
      if ((KIND_ORDER[m && m.kind] ?? 9) > rank) { at = i; break; }
    }
    p.media.splice(at, 0, mid);
  }
  const prefixed = path => (path && !/^(blob:|data:|https?:)/.test(path) ? (D.mediaBase || "") + path : path);
  /* own-property lookups only: "constructor" or "__proto__" must never resolve to a person or an item */
  const personOf = pid => (typeof pid === "string" && PID_RE.test(pid) && Object.hasOwn(P, pid) ? P[pid] : null);
  const mediaOf = mid => (typeof mid === "string" && D.media && Object.hasOwn(D.media, mid) ? D.media[mid] : null);
  /* on the shared (public) site: people the build keeps local-only are "not connected to your family" */
  const onSharedSite = p => !!p && p.line !== "none" && p.rel !== "Not connected to your family";
  /* people an item may belong to: known, on the shared site and not living (living people's photos never go on it) */
  const allowedPeople = pids => (Array.isArray(pids) ? pids : []).filter(pid => { const p = personOf(pid); return !!p && !p.living && onSharedSite(p); });
  function setPhoto(p, mid) {
    p.photo = mid;
    const m = D.media[mid];
    p.photoPos = (m && m.pos) || "50% 30%";
  }
  function dropMedia(mid) {
    const touched = [];
    for (const p of Object.values(P)) {
      if (Array.isArray(p.media) && p.media.includes(mid)) { p.media = p.media.filter(x => x !== mid); touched.push(p.id); }
      if (p.photo === mid) { p.photo = null; delete p.photoPos; if (!touched.includes(p.id)) touched.push(p.id); }
    }
    const m = D.media[mid];
    if (m) for (const u of [m.src, m.thumb]) if (u && u.startsWith("blob:")) { try { URL.revokeObjectURL(u); } catch (e) { /* ignore */ } }
    delete D.media[mid];
    return touched;
  }

  /* ---------------------------------------------------------------- reading files */
  const isPdf = f => f.type === "application/pdf" || /\.pdf$/i.test(f.name || "");
  const isHeic = f => /^image\/hei[cf]/.test(f.type) || /\.hei[cf]$/i.test(f.name || "");
  const looksLikeImage = f => /^image\//.test(f.type) || /\.(jpe?g|png|gif|webp|avif|bmp|tiff?|hei[cf])$/i.test(f.name || "");

  function canvasOf(w, h) {
    if (typeof OffscreenCanvas === "function") {
      try { const c = new OffscreenCanvas(w, h); if (c.getContext("2d")) return c; } catch (e) { /* fall through */ }
    }
    return Object.assign(document.createElement("canvas"), { width: w, height: h });
  }
  function toJpeg(canvas, quality) {
    if (canvas.convertToBlob) return canvas.convertToBlob({ type: "image/jpeg", quality });
    return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/jpeg", quality));
  }
  /* draw src (an ImageBitmap or canvas) into a new canvas no larger than edge px on its long side.
     Big reductions go in halving steps so the result stays sharp. */
  function scaled(src, sw, sh, edge) {
    const k = Math.min(1, edge / Math.max(sw, sh));
    const w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
    let cur = src, cw = sw, ch = sh;
    while (cw / 2 >= w * 1.05 && ch / 2 >= h * 1.05) {
      const nw = Math.round(cw / 2), nh = Math.round(ch / 2);
      const step = canvasOf(nw, nh), ctx = step.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(cur, 0, 0, nw, nh);
      cur = step; cw = nw; ch = nh;
    }
    const out = canvasOf(w, h), ctx = out.getContext("2d");
    ctx.fillStyle = "#ffffff";                 // transparent PNGs get a white backing, not black
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(cur, 0, 0, w, h);
    return { canvas: out, w, h };
  }

  /* a real PDF starts with "%PDF-" (a few writers put junk before it, so look through the first kilobyte) */
  async function looksLikePdfBytes(file) {
    try {
      const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
      return new TextDecoder("latin1").decode(head).includes("%PDF-");
    } catch (e) { return false; }
  }
  /* an image's pixel size from its header, without decoding the pixels (null when the browser can't read it) */
  function imageSize(file) {
    return new Promise(resolve => {
      let url;
      try { url = URL.createObjectURL(file); } catch (e) { resolve(null); return; }
      const img = new Image();
      const done = v => { URL.revokeObjectURL(url); img.onload = img.onerror = null; img.src = ""; resolve(v); };
      img.onload = () => done(img.naturalWidth && img.naturalHeight ? { w: img.naturalWidth, h: img.naturalHeight } : null);
      img.onerror = () => done(null);
      img.src = url;
    });
  }

  /* prepare one picked file: {type: "image", full, thumb, w, h} | {type: "pdf", full} | throws Error(plain message) */
  async function prepareFile(file) {
    if (isPdf(file)) {
      if (file.size > MAX_PDF) throw new Error(`This PDF is ${formatBytes(file.size)}. PDFs can be up to 20 MB: try a smaller scan or split it.`);
      if (!file.size) throw new Error("This PDF is empty.");
      if (!(await looksLikePdfBytes(file))) throw new Error("This file is named like a PDF but isn't one inside. Open it and save or export it as a PDF again.");
      return { type: "pdf", full: file };
    }
    if (!looksLikeImage(file)) throw new Error("Only photos (JPEG, PNG, WebP, GIF) and PDF documents can be added.");
    if (file.size > MAX_IMAGE_BYTES) throw new Error(`This photo is ${formatBytes(file.size)}. Photos can be up to 50 MB: export a smaller copy (a JPEG of a few MB is plenty).`);
    // refuse huge pixel counts before decoding: a 100+ megapixel image can run a phone out of memory
    const size = await imageSize(file);
    if (size && size.w * size.h > MAX_PIXELS) {
      throw new Error(`This image is ${size.w.toLocaleString("en-US")} × ${size.h.toLocaleString("en-US")} pixels, too big to resize here. Export a copy under 10,000 pixels on its long side.`);
    }
    let bitmap;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch (err) {
      if (isHeic(file)) throw new Error("This browser can't open HEIC photos (the iPhone format). Open this page in Safari, or export the photo as a JPEG first.");
      throw new Error("This browser couldn't open this image. It may be damaged, or in a format it doesn't read: try saving it as a JPEG.");
    }
    try {
      const big = scaled(bitmap, bitmap.width, bitmap.height, MAX_EDGE);
      const small = scaled(big.canvas, big.w, big.h, THUMB_EDGE);
      const [full, thumb] = await Promise.all([toJpeg(big.canvas, JPEG_Q), toJpeg(small.canvas, THUMB_Q)]);
      return { type: "image", full, thumb, w: big.w, h: big.h, origW: bitmap.width, origH: bitmap.height };
    } finally {
      if (bitmap.close) bitmap.close();
    }
  }
  /* a starting title from the file name, unless it's a camera name like IMG_1234 */
  function titleFromName(name, kind, p) {
    const base = String(name || "").replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[_]+/g, " ").replace(/\s*-\s*/g, " – ").replace(/\s+/g, " ").trim();
    const camera = /^(img|dsc|dscn|dscf|pxl|mvimg|photo|image|scan|scanned|screenshot|screen shot|document|doc|file|untitled|whatsapp image)?[\s\d.:–()-]*(at)?[\s\d.:–()-]*$/i;
    if (!base || camera.test(base)) return `${(KINDS.find(k => k[0] === kind) || KINDS[0])[1]} of ${p ? p.name : "this person"}`;
    return base.charAt(0).toUpperCase() + base.slice(1);
  }

  /* ---------------------------------------------------------------- dialog shell */
  /* One editor dialog at a time. openDialog({size, kicker, title, lead, onClose, canClose}) builds
     .ed-layer > .ed-scrim + section.ed-dialog (header, scrolling body, footer), traps focus, closes on
     Escape and on the scrim (unless canClose() says no), locks the page scroll and restores focus. */
  let current = null;
  let returnFocus = null;
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function openDialog({ size = "md", kicker, title, onClose, canClose = () => true }) {
    if (current) current.close({ silent: true, keepFocus: true });
    else if (!returnFocus || !returnFocus.isConnected) returnFocus = document.activeElement;
    const titleId = `ed-title-${randomHex(6)}`;
    const closeBtn = el("button", { class: "btn btn-ghost btn-icon ed-close", type: "button", "aria-label": "Close", onclick: () => api.close() }, icon("close", 20));
    const head = el("header", { class: "ed-head" },
      el("div", { class: "ed-head-text" },
        kicker && el("p", { class: "label ed-kicker", text: kicker }),
        el("h2", { class: "ed-title", id: titleId, text: title })),
      closeBtn);
    const body = el("div", { class: "ed-body" });
    const foot = el("footer", { class: "ed-foot" });
    const panel = el("section", { class: `ed-dialog ed-dialog-${size}`, role: "dialog", "aria-modal": "true", "aria-labelledby": titleId, tabindex: "-1" }, head, body, foot);
    const scrim = el("div", { class: "ed-scrim", onclick: () => api.close() });
    const layer = el("div", { class: "ed-layer" }, scrim, panel);

    const onKey = e => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); api.close(); return; }
      if (e.key !== "Tab") return;
      const items = $$(FOCUSABLE, panel).filter(n => n.offsetParent !== null || n === document.activeElement);
      if (!items.length) { e.preventDefault(); panel.focus(); return; }
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    // focus that wanders out of the dialog (a click on the scrim, a script) comes back in
    const onFocusIn = e => { if (current === api && !layer.contains(e.target)) panel.focus(); };

    const api = {
      layer, panel, head, body, foot, closeBtn,
      setTitle(t) { $(".ed-title", head).textContent = t; },
      close({ silent = false, keepFocus = false, force = false } = {}) {
        if (current !== api) return false;
        if (!force && !silent && !canClose()) return false;
        current = null;
        document.removeEventListener("keydown", onKey, true);
        document.removeEventListener("focusin", onFocusIn);
        layer.classList.add("is-leaving");
        const done = () => layer.remove();
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) done(); else setTimeout(done, 180);
        if (!keepFocus) {
          document.documentElement.classList.remove("ed-locked");
          const back = returnFocus;
          returnFocus = null;
          if (back && back.isConnected && typeof back.focus === "function") { try { back.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
        }
        if (onClose) { try { onClose({ silent }); } catch (err) { console.error("[editor] onClose failed:", err); } }
        return true;
      },
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", onFocusIn);
    document.documentElement.classList.add("ed-locked");
    document.body.append(layer);
    current = api;
    return api;
  }
  /* focus the first useful control once the dialog is in the page */
  const focusFirst = (dlg, sel) => requestAnimationFrame(() => {
    const n = (sel && $(sel, dlg.panel)) || $$(FOCUSABLE, dlg.body)[0] || dlg.panel;
    try { n.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  });

  /* a short status line inside a dialog: kind "info" | "ok" | "error" | "busy" */
  function statusLine() {
    const n = el("p", { class: "ed-status", role: "status", "aria-live": "polite", hidden: true });
    n.set = (kind, text) => {
      n.hidden = !text;
      n.className = `ed-status is-${kind || "info"}`;
      n.replaceChildren(kind === "busy" ? el("span", { class: "ed-spinner", "aria-hidden": "true" })
        : icon(kind === "ok" ? "check" : "info", 18), el("span", { text: text || "" }));
    };
    return n;
  }

  /* confirmDialog({title, body, confirm, danger}) -> Promise<boolean> */
  function confirmDialog({ kicker, title, body, confirm = "OK", danger = false }) {
    return new Promise(resolve => {
      let answered = false;
      const dlg = openDialog({ size: "sm", kicker, title, onClose: () => { if (!answered) resolve(false); } });
      dlg.body.append(...[].concat(body).map(t => (typeof t === "string" ? el("p", { class: "ed-text", text: t }) : t)));
      const yes = el("button", { class: ["btn", danger ? "btn-danger ed-danger" : "btn-primary"], type: "button",
        onclick: () => { answered = true; dlg.close({ force: true }); resolve(true); } }, danger && icon("trash", 18), el("span", { text: confirm }));
      dlg.foot.append(el("div", { class: "ed-foot-actions" },
        el("button", { class: "btn btn-ghost", type: "button", onclick: () => dlg.close() }, "Cancel"), yes));
      focusFirst(dlg, ".ed-foot .btn-ghost");
    });
  }

  /* ---------------------------------------------------------------- settings: connect to GitHub */
  /* openSettings({then: pid}) — with then, a successful Save goes straight on to that person's upload dialog */
  function openSettings(opts = {}) {
    const then = opts && personOf(opts.then) ? opts.then : null;
    let busy = false;
    let tested = null;            // {token, login} after a passing Test of what's in the field
    const dlg = openDialog({
      size: "md", kicker: "Add photos and documents", title: "Connect to GitHub",
      canClose: () => !busy,
    });
    const status = statusLine();
    const input = el("input", {
      class: "input ed-token", id: "ed-token", type: "password", autocomplete: "off", autocapitalize: "off",
      spellcheck: "false", "aria-describedby": "ed-token-help", placeholder: "github_pat_…",
      oninput: () => { tested = null; status.set("info", ""); renderFoot(); },
    });
    const remember = el("input", { type: "checkbox", id: "ed-remember", onchange: () => renderFoot() });

    function render() {
      const info = tokenInfo();
      remember.checked = info ? info.remembered : false;
      const r = repoName();
      dlg.body.replaceChildren(...[
        then && !info && el("p", { class: "ed-callout", role: "note" }, icon("info", 18),
          el("span", { text: `Connect once to add photos and documents for ${P[then].name}.` })),
        el("p", { class: "ed-lead", text: `The family tree is a static website, so photos and documents added here are saved straight into its GitHub repository, ${r}. This browser needs a GitHub access token that can change that one repository and nothing else.` }),
        info && el("div", { class: "ed-connected" },
          el("span", { class: "ed-connected-mark", "aria-hidden": "true" }, icon("check", 18)),
          el("div", {},
            el("p", { class: "ed-connected-title", text: info.login ? `Connected as ${info.login}` : "Connected" }),
            el("p", { class: "ed-connected-meta", text: `Token ${maskToken(info.token)} · ${info.remembered ? "remembered on this device" : "kept until this tab closes"}` }))),
        el("h3", { class: "ed-h3", text: info ? "To use a different token" : "Make a token (about two minutes)" }),
        el("ol", { class: "ed-steps" },
          el("li", {}, el("span", { text: "Open " }),
            el("a", { href: TOKEN_URL, target: "_blank", rel: "noopener noreferrer", class: "ed-a" }, "github.com › Fine-grained tokens › Generate new token", icon("external", 14)),
            el("span", { text: ` and sign in as ${repo().owner} if GitHub asks.` })),
          el("li", {}, el("span", { text: "Token name: anything, like “Family tree uploads”. Expiration: your choice; when it runs out, make a new one here." })),
          el("li", {}, el("span", { text: "Repository access: choose " }), el("strong", { text: "Only select repositories" }),
            el("span", { text: ", then pick " }), el("strong", { text: r }), el("span", { text: "." })),
          el("li", {}, el("span", { text: "Permissions: open Repository permissions and set " }), el("strong", { text: "Contents" }),
            el("span", { text: " to " }), el("strong", { text: "Read and write" }),
            el("span", { text: ". Leave everything else as it is (GitHub adds Metadata: Read-only by itself)." })),
          el("li", {}, el("span", { text: "Press Generate token, copy it, paste it below and press Save." }))),
        el("div", { class: "field ed-field" },
          el("label", { class: "label", for: "ed-token", text: "Access token" }),
          input,
          el("p", { class: "ed-help", id: "ed-token-help", text: "It's only ever sent to GitHub (api.github.com). It's kept in this tab, and harkdigital.github.io is one web address shared by every HarkDigital GitHub Pages site, so another of those sites opened in this same tab could read it: press Forget before you go to other sites in this tab." })),
        el("div", { class: "ed-remember" },
          el("label", { class: "check", for: "ed-remember" }, remember, el("span", { text: "Remember on this device" })),
          el("p", { class: "ed-help", text: "Off, the token is forgotten when you close this tab. On, it stays in this browser until you press Forget, where any HarkDigital GitHub Pages site opened in this browser could read it. Only turn it on for your own computer or phone." })),
        status].filter(Boolean));
      renderFoot();
    }

    /* connected and nothing changed: the job is done, so "Done" is the main button; Test and Save appear once a
       new token is typed in the field (or "Remember on this device" is switched, which Save applies) */
    function renderFoot() {
      const info = tokenInfo();
      const typed = !!input.value.trim();
      const unchanged = !!info && !typed && remember.checked === info.remembered;

      const forget = info && el("button", { class: "btn btn-ghost ed-forget", type: "button", onclick: () => {
        forgetToken();
        input.value = ""; tested = null;
        render();
        status.set("ok", "Forgotten. This browser no longer has a token.");
        App.emit("media", null);  // add buttons hide again
      } }, icon("trash", 18), el("span", { text: "Forget" }));
      const hadFocus = dlg.foot.contains(document.activeElement);
      const actions = [];
      if (unchanged) {
        actions.push(el("button", { class: "btn btn-primary ed-done", type: "button", onclick: () => dlg.close() }, "Done"));
      } else {
        actions.push(el("button", { class: "btn", type: "button", onclick: () => run("test") }, "Test"),
          el("button", { class: "btn btn-primary", type: "button", onclick: () => run("save") }, then ? "Save and continue" : "Save"));
      }
      dlg.foot.replaceChildren(forget || el("span"), el("div", { class: "ed-foot-actions" }, actions));
      if (hadFocus) { const b = $(".ed-foot .btn-primary", dlg.panel); if (b) b.focus({ preventScroll: true }); }
    }

    function setBusy(on) {
      busy = on;
      for (const n of $$("button, input", dlg.panel)) if (!n.classList.contains("ed-close")) n.disabled = on;
      dlg.closeBtn.disabled = on;
    }

    async function run(action) {
      const typed = input.value.trim();
      const info = tokenInfo();
      const token = typed || (info && info.token) || "";
      if (!token) { status.set("error", "Paste a token first."); input.focus(); return; }
      if (/\s/.test(token) || token.length < 20) { status.set("error", "That doesn't look like a whole token. Copy it again from GitHub and paste it here."); input.focus(); return; }
      let login = typed ? tested && tested.token === typed ? tested.login : null : info.login;
      if (action === "test" || login == null) {
        setBusy(true);
        status.set("busy", "Checking the token with GitHub…");
        try {
          ({ login } = await testToken(token));
          if (typed) tested = { token: typed, login };
        } catch (err) {
          setBusy(false);
          status.set("error", explain(err));
          return;
        }
        setBusy(false);
      }
      const classic = /^gh[pousr]_/.test(token) ? " This is a classic token, which can reach every repository on the account: a fine-grained one limited to this repository is safer." : "";
      if (action === "test") {
        status.set("ok", `This token works: it can add photos to ${repoName()}${login ? ` as ${login}` : ""}.${typed ? " Press Save to use it." : ""}${classic}`);
        return;
      }
      saveToken(token, login, remember.checked);
      input.value = ""; tested = null;
      App.emit("media", null);  // add buttons appear
      if (then) { dlg.close({ force: true, silent: true, keepFocus: true }); openUpload(then); return; }
      render();
      status.set("ok", `Saved${remember.checked ? " on this device" : " for this tab"}. You can add photos and documents from anyone's panel.${classic}`);
    }

    render();
    focusFirst(dlg, tokenInfo() ? ".ed-foot .btn-primary" : "#ed-token");
    return dlg;
  }

  /* ---------------------------------------------------------------- upload dialog */
  function eligibleReason(pid) {
    const p = personOf(pid);
    if (!p) return "This person isn't in the tree.";
    if (p.living) return "Photos can't be added for people who may be living: everything added here is public.";
    // uploads are published on the shared site, which deliberately leaves these people out
    if (!onSharedSite(p)) return "This person isn't on the shared site, so photos can't be added here.";
    return "";
  }
  const kindName = (kind, n) => {
    const one = { photo: "photo", headstone: "headstone", document: "document" }[kind] || "item";
    return plural(n, one);
  };
  const joinList = parts => parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  /* "Add 2 photos and 1 document of Thomas M Harkins" */
  function batchMessage(items, p) {
    const counts = {};
    for (const it of items) counts[it.kind] = (counts[it.kind] || 0) + 1;
    const parts = KINDS.map(([k]) => k).filter(k => counts[k]).map(k => kindName(k, counts[k]));
    return `Add ${joinList(parts)} of ${p.name}`;
  }

  function openUpload(pid) {
    pid = resolvePid(pid) || pid;
    const why = eligibleReason(pid);
    if (why) { toast(why, { kind: "error" }); return null; }
    if (!enabled()) return openSettings({ then: pid });
    const p = personOf(pid);
    const items = [];
    let busy = false, published = false;

    const dlg = openDialog({
      size: "lg", kicker: "Add photos and documents", title: p.name,
      canClose: () => !busy,
      onClose: () => {
        if (!published) for (const it of items) if (it.previewUrl) URL.revokeObjectURL(it.previewUrl);
      },
    });
    dlg.panel.classList.add("ed-upload");
    // the person, under the title
    // the title already says the name: the avatar beside it is decorative
    const headAvatar = avatar(p, { size: 48, cls: "ed-head-avatar", decorative: true });
    headAvatar.setAttribute("aria-hidden", "true");
    headAvatar.removeAttribute("role");
    headAvatar.removeAttribute("aria-label");
    $(".ed-head-text", dlg.head).prepend(headAvatar);
    const sub = [years(p), p.rel].filter(Boolean).join(" · ");
    if (sub) $(".ed-head-text", dlg.head).append(el("p", { class: "ed-sub", text: sub }));

    const status = statusLine();
    const picker = el("input", { type: "file", class: "sr-only", id: "ed-files", multiple: true, accept: "image/*,application/pdf", tabindex: "-1",
      onchange: () => { addFiles(picker.files); picker.value = ""; } });
    const chooseBtn = el("button", { class: "btn", type: "button", onclick: () => picker.click() }, icon("plus", 18), el("span", { text: "Choose files" }));
    const drop = el("div", { class: "ed-drop" },
      el("span", { class: "ed-drop-icon", "aria-hidden": "true" }, icon("upload", 28)),
      el("p", { class: "ed-drop-title", text: isPhone() ? "Add photos or PDFs" : "Drop photos or PDFs here" }),
      el("p", { class: "ed-drop-meta", text: "JPEG, PNG, WebP or GIF photos up to 50 MB, and PDF documents up to 20 MB. Choose several at once if you like." }),
      chooseBtn, picker);
    drop.addEventListener("click", e => { if (e.target === drop || e.target.closest(".ed-drop-icon, .ed-drop-title, .ed-drop-meta")) picker.click(); });
    const list = el("ul", { class: "ed-files", "aria-label": "Files to add" });
    const notice = el("div", { class: "ed-notice", role: "note" },
      el("span", { class: "label", text: "Public" }),
      el("p", {}, el("span", { text: "Everything added here is published on the family tree website, " }),
        el("strong", { text: PUBLIC_URL.replace(/^https:\/\//, "").replace(/\/$/, "") }),
        el("span", { text: ", for anyone with the link to see and download. Photos are resized to at most 2400 pixels and their camera and location details are removed. PDFs are published unchanged, including any details saved inside them." })));
    dlg.body.append(notice, drop, list, status);

    const summary = el("p", { class: "ed-summary", "aria-live": "polite" });
    const cancelBtn = el("button", { class: "btn btn-ghost", type: "button", onclick: () => dlg.close() }, "Cancel");
    const publishBtn = el("button", { class: "btn btn-primary", type: "button", onclick: publish }, icon("upload", 18), el("span", { text: "Publish" }));
    const bar = el("div", { class: "ed-progress", hidden: true, role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": "0", "aria-label": "Publishing" },
      el("span", { class: "ed-progress-fill" }));
    dlg.foot.append(el("div", { class: "ed-foot-info" }, summary, bar), el("div", { class: "ed-foot-actions" }, cancelBtn, publishBtn));

    // drag and drop anywhere on the dialog
    let depth = 0;
    const hasFiles = e => Array.from((e.dataTransfer && e.dataTransfer.types) || []).includes("Files");
    dlg.panel.addEventListener("dragenter", e => { if (!hasFiles(e) || busy) return; e.preventDefault(); depth++; drop.classList.add("is-over"); });
    dlg.panel.addEventListener("dragover", e => { if (!hasFiles(e) || busy) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
    dlg.panel.addEventListener("dragleave", () => { depth = Math.max(0, depth - 1); if (!depth) drop.classList.remove("is-over"); });
    dlg.panel.addEventListener("drop", e => {
      if (!hasFiles(e)) return;
      e.preventDefault(); depth = 0; drop.classList.remove("is-over");
      if (!busy) addFiles(e.dataTransfer.files);
    });
    // pasted images (a screenshot, a copied photo)
    dlg.panel.addEventListener("paste", e => {
      const files = Array.from((e.clipboardData && e.clipboardData.files) || []);
      if (files.length && !busy) { e.preventDefault(); addFiles(files); }
    });

    const ready = () => items.filter(it => it.state === "ready");
    function updateSummary() {
      const r = ready(), reading = items.filter(it => it.state === "reading").length, bad = items.filter(it => it.state === "error").length;
      const counts = {};
      for (const it of r) counts[it.kind] = (counts[it.kind] || 0) + 1;
      const parts = KINDS.map(([k]) => k).filter(k => counts[k]).map(k => kindName(k, counts[k]));
      summary.textContent = reading ? `Preparing ${plural(reading, "file")}…`
        : r.length ? `${joinList(parts)} ready${bad ? ` · ${plural(bad, "file")} can't be added` : ""}`
        : items.length ? "Nothing to publish yet" : "No files chosen yet";
      $("span", publishBtn).textContent = r.length > 1 ? `Publish ${r.length}` : "Publish";
      publishBtn.disabled = busy || !r.length || reading > 0;
      list.hidden = !items.length;
      drop.classList.toggle("is-compact", items.length > 0);
    }
    function setAvatarChoice(it, on) {
      for (const other of items) {
        other.avatar = on && other === it;
        if (other.avatarBox) other.avatarBox.checked = other.avatar;
      }
    }

    function rowFor(it) {
      const idBase = `ed-f-${it.key}`;
      const preview = el("div", { class: "ed-file-preview" });
      if (it.state === "reading") preview.append(el("span", { class: "ed-spinner", "aria-hidden": "true" }));
      else if (it.prep && it.prep.type === "image") preview.append(el("img", { src: it.previewUrl, alt: "" }));
      else if (it.prep || isPdf(it.file)) preview.append(el("span", { class: "ed-file-doc", "aria-hidden": "true" }, icon("document", 32), el("span", { text: "PDF" })));
      else preview.append(el("span", { class: "ed-file-doc", "aria-hidden": "true" }, icon("image", 32)));
      const meta = it.state === "error" ? "Can't be added"
        : it.state === "reading" ? "Preparing…"
        : it.prep.type === "image"
          ? `${it.prep.w} × ${it.prep.h}${it.prep.origW > it.prep.w ? ` (from ${it.prep.origW} × ${it.prep.origH})` : ""} · ${formatBytes(it.prep.full.size)}`
          : `PDF · ${formatBytes(it.prep.full.size)}`;
      const removeBtn = el("button", { class: "btn btn-ghost btn-icon btn-sm ed-file-remove", type: "button", "aria-label": `Don't add ${it.name}`, title: "Don't add this file",
        onclick: () => {
          const i = items.indexOf(it);
          if (i >= 0) items.splice(i, 1);
          if (it.previewUrl) URL.revokeObjectURL(it.previewUrl);
          it.row.remove();
          updateSummary();
          (($(".ed-file-remove", list)) || chooseBtn).focus();
        } }, icon("close", 18));
      const head = el("div", { class: "ed-file-head" },
        el("div", { class: "ed-file-name" }, el("strong", { text: it.name }), el("span", { class: "ed-file-meta", text: meta })),
        removeBtn);
      const fields = el("div", { class: "ed-file-main" }, head);
      if (it.state === "error") {
        fields.append(el("p", { class: "ed-file-error", role: "alert" }, icon("info", 18), el("span", { text: it.error })));
      } else if (it.state === "ready") {
        const title = el("input", { class: "input", id: `${idBase}-title`, maxlength: "140", value: it.title, oninput: e => { it.title = e.target.value; } });
        const date = el("input", { class: "input", id: `${idBase}-date`, maxlength: "40", placeholder: "e.g. 1946 or 7 Sep 1946", value: it.date, oninput: e => { it.date = e.target.value; } });
        const kinds = it.prep.type === "pdf" ? [["document", "Document"]] : KINDS;
        const kind = el("select", { class: "input", id: `${idBase}-kind`, disabled: kinds.length < 2,
          onchange: e => {
            it.kind = e.target.value;
            if (it.avatarBox) { it.avatarBox.disabled = it.kind !== "photo"; if (it.kind !== "photo" && it.avatar) setAvatarChoice(it, false); }
          } }, kinds.map(([v, label]) => el("option", { value: v, selected: v === it.kind, text: label })));
        const desc = el("textarea", { class: "input", id: `${idBase}-desc`, rows: "2", maxlength: "2000", placeholder: "Who is in it, where and when, where it came from", oninput: e => { it.desc = e.target.value; } });
        desc.value = it.desc;
        fields.append(
          el("div", { class: "ed-grid" },
            el("div", { class: "field ed-span" }, el("label", { class: "label", for: `${idBase}-title`, text: "Title" }), title),
            el("div", { class: "field" }, el("label", { class: "label", for: `${idBase}-date`, text: "Date (optional)" }), date),
            el("div", { class: "field" }, el("label", { class: "label", for: `${idBase}-kind`, text: "Kind" }), kind),
            el("div", { class: "field ed-span" }, el("label", { class: "label", for: `${idBase}-desc`, text: "Description (optional)" }), desc)));
        if (it.prep.type === "image") {
          it.avatarBox = el("input", { type: "checkbox", id: `${idBase}-avatar`, checked: it.avatar, disabled: it.kind !== "photo",
            onchange: e => setAvatarChoice(it, e.target.checked) });
          fields.append(el("label", { class: "check ed-avatar-check", for: `${idBase}-avatar` }, it.avatarBox,
            el("span", { text: `Use as ${firstName(p)}'s profile photo` })));
        }
      }
      const row = el("li", { class: ["ed-file", `is-${it.state}`] }, preview, fields);
      if (it.row) it.row.replaceWith(row);
      it.row = row;
      return row;
    }

    let queue = Promise.resolve();
    function addFiles(fileList) {
      const files = Array.from(fileList || []);
      if (!files.length) return;
      status.set("info", "");
      for (const file of files) {
        const it = { key: randomHex(8), file, name: file.name || "Pasted image", state: "reading", title: "", date: "", desc: "", kind: isPdf(file) ? "document" : "photo", avatar: false };
        items.push(it);
        list.append(rowFor(it));
        // one at a time, so a dozen big photos don't all decode at once
        queue = queue.then(async () => {
          if (!items.includes(it)) return;
          try {
            it.prep = await prepareFile(file);
            it.state = "ready";
            if (it.prep.type === "image") it.previewUrl = URL.createObjectURL(it.prep.thumb);
            it.title = titleFromName(it.name, it.kind, p);
            // someone with no profile photo gets the first photo as one (they can untick it)
            if (it.prep.type === "image" && !p.photo && !items.some(o => o.avatar)) it.avatar = true;
          } catch (err) {
            it.state = "error";
            it.error = err && err.message ? err.message : "This file can't be added.";
          }
          if (items.includes(it)) rowFor(it);
          updateSummary();
        });
      }
      updateSummary();
    }

    function setBusy(on) {
      busy = on;
      dlg.panel.classList.toggle("is-busy", on);
      for (const n of $$("button, input, select, textarea", dlg.panel)) {
        if (on) { n.dataset.edWasDisabled = n.disabled ? "1" : ""; n.disabled = true; }
        else { n.disabled = n.dataset.edWasDisabled === "1"; delete n.dataset.edWasDisabled; }
      }
      bar.hidden = !on;
      summary.hidden = false;
      if (!on) updateSummary();
    }

    async function publish() {
      const batch = ready();
      if (!batch.length || busy) return;
      for (const it of batch) {
        it.title = String(it.title || "").trim();
        if (!it.title) it.title = titleFromName("", it.kind, p);
      }
      const login = (tokenInfo() || {}).login || "";
      const now = new Date().toISOString();
      const planned = batch.map(it => {
        const hex = randomHex(8);
        const base = `${slugify(`${p.name} ${it.title}`)}-${hex.slice(0, 6)}`;
        const pdf = it.prep.type === "pdf";
        const item = {
          id: `u-${hex}`, kind: pdf ? "document" : it.kind, title: it.title,
          date: String(it.date || "").trim(), desc: String(it.desc || "").trim(),
          src: `media/added/${base}.${pdf ? "pdf" : "jpg"}`,
          ...(pdf ? { file: "pdf" } : { thumb: `media/added/t/${base}.jpg`, w: it.prep.w, h: it.prep.h }),
          people: [pid], added: now, by: login,
        };
        return { it, item, avatar: !pdf && it.avatar && item.kind === "photo" };
      });
      const files = [];
      for (const { it, item } of planned) {
        files.push({ path: `docs/${item.src}`, blob: it.prep.full });
        if (item.thumb) files.push({ path: `docs/${item.thumb}`, blob: it.prep.thumb });
      }
      const avatarItem = planned.find(x => x.avatar);
      setBusy(true);
      status.set("busy", "Publishing… keep this page open until it's done.");
      status.scrollIntoView({ block: "nearest", behavior: "smooth" });
      try {
        await commitChange({
          message: batchMessage(planned.map(x => x.item), p),
          files,
          change: manifest => {
            for (const { item } of planned) if (!manifest.items.some(x => x.id === item.id)) manifest.items.push(item);
            if (avatarItem) manifest.avatars[pid] = avatarItem.item.id;
          },
          onStep: ({ label, done, total }) => {
            const pct = Math.round((done / total) * 100);
            bar.setAttribute("aria-valuenow", String(pct));
            bar.style.setProperty("--pct", `${pct}%`);
            summary.textContent = label;
          },
        });
      } catch (err) {
        setBusy(false);
        status.set("error", explain(err));
        status.scrollIntoView({ block: "nearest", behavior: "smooth" });
        return;
      }
      // the files take about a minute to appear on Pages: show these copies until then
      for (const { it, item } of planned) {
        const m = { ...item };
        if (it.prep.type === "pdf") m.src = URL.createObjectURL(it.prep.full);
        else { m.src = URL.createObjectURL(it.prep.full); m.thumb = it.previewUrl; }
        D.media[m.id] = m;
        insertMedia(p, m.id);
      }
      if (avatarItem) setPhoto(p, avatarItem.item.id);
      published = true;
      busy = false;
      dlg.close({ force: true });
      App.emit("media", pid);
      toast("Added. Everyone will see it in about a minute.", { kind: "ok" });
    }

    updateSummary();
    focusFirst(dlg, ".ed-drop .btn");
    return dlg;
  }

  /* ---------------------------------------------------------------- manifest-only changes */
  /* a small blocking "working" dialog for remove and setAvatar */
  function workingDialog(kicker, title) {
    let busy = true;
    const dlg = openDialog({ size: "sm", kicker, title, canClose: () => !busy });
    const status = statusLine();
    dlg.body.append(status);
    status.set("busy", "Saving to GitHub…");
    dlg.closeBtn.disabled = true;
    dlg.fail = msg => {
      busy = false;
      dlg.closeBtn.disabled = false;
      status.set("error", msg);
      dlg.foot.replaceChildren(el("span"), el("div", { class: "ed-foot-actions" },
        el("button", { class: "btn btn-primary", type: "button", onclick: () => dlg.close() }, "OK")));
      focusFirst(dlg, ".ed-foot .btn-primary");
    };
    dlg.done = () => { busy = false; dlg.close({ force: true }); };
    return dlg;
  }
  const ownerName = m => {
    const pid = (m.people || []).find(x => P[x]);
    return pid ? P[pid].name : "";
  };
  const itemNoun = m => (m.file === "pdf" ? "PDF" : { photo: "photo", headstone: "headstone photo", document: "document" }[m.kind] || "item");

  /* remove(mid, {confirm = true}) -> Promise<boolean>. Uploaded items only ("u-…"): deletes the files and the
     manifest entry (and any profile-photo choice pointing at it) in one commit. Asks first. */
  async function remove(mid, { confirm = true } = {}) {
    const m = media(mid);
    if (!m || !/^u-/.test(mid)) { toast("Only photos and documents added on this site can be removed here.", { kind: "error" }); return false; }
    if (!enabled()) { openSettings(); return false; }
    const who = ownerName(m);
    if (confirm) {
      const ok = await confirmDialog({
        kicker: "Remove", title: `Remove this ${itemNoun(m)}?`, danger: true, confirm: "Remove",
        body: [`“${m.title || "Untitled"}”${who ? ` will be taken off ${who}'s page` : " will be taken off the website"} and its file deleted from the website within about a minute.`,
          "It stays in the repository's history on GitHub, so it can be brought back from there if needed."],
      });
      if (!ok) return false;
    }
    const dlg = workingDialog("Remove", `Removing “${m.title || "Untitled"}”`);
    let found = false;
    try {
      await commitChange({
        message: `Remove ${/^[aeiou]/i.test(itemNoun(m)) ? "an" : "a"} ${itemNoun(m)} of ${who || "someone"}: ${m.title || mid}`.slice(0, 200),
        change: manifest => {
          const item = manifest.items.find(x => x.id === mid);
          found = !!item;
          manifest.items = manifest.items.filter(x => x.id !== mid);
          for (const [pid, av] of Object.entries(manifest.avatars)) if (av === mid) delete manifest.avatars[pid];
          const paths = item ? [item.src, item.thumb] : [];
          return { deletes: paths.filter(x => typeof x === "string" && x.startsWith("media/added/")).map(x => `docs/${x}`) };
        },
      });
    } catch (err) {
      dlg.fail(explain(err));
      return false;
    }
    const touched = dropMedia(mid);
    dlg.done();
    for (const pid of touched) App.emit("media", pid);
    toast(found ? "Removed. It will be gone from the website in about a minute." : "Removed from this page. It was already gone from the repository.", { kind: "ok" });
    return true;
  }

  /* can mid be pid's profile photo? a photo (or headstone) with an image that belongs to them */
  function canSetAvatar(pid, mid) {
    const p = personOf(pid), m = mediaOf(mid);
    return !!(p && !p.living && onSharedSite(p) && m && (m.people || []).includes(pid) && ["photo", "headstone"].includes(m.kind)
      && m.file !== "pdf" && (m.thumb || m.src));
  }
  /* setAvatar(pid, mid) -> Promise<boolean>. Commits avatars[pid] = mid. mid = null goes back to the default. */
  async function setAvatar(pid, mid) {
    pid = resolvePid(pid);
    const p = personOf(pid);
    if (!p || eligibleReason(pid)) { toast(eligibleReason(pid), { kind: "error" }); return false; }
    if (mid != null && !canSetAvatar(pid, mid)) { toast("That item can't be used as a profile photo.", { kind: "error" }); return false; }
    if (!enabled()) { openSettings(); return false; }
    if (mid != null && p.photo === mid) { toast(`That's already ${firstName(p)}'s profile photo.`); return true; }
    const dlg = workingDialog("Profile photo", mid == null ? `Clearing ${firstName(p)}'s profile photo` : `Setting ${firstName(p)}'s profile photo`);
    try {
      await commitChange({
        message: mid == null ? `Clear the profile photo of ${p.name}` : `Use “${(media(mid).title || mid).slice(0, 80)}” as the profile photo of ${p.name}`,
        change: manifest => {
          if (mid == null) delete manifest.avatars[pid];
          else manifest.avatars[pid] = mid;
        },
      });
    } catch (err) {
      dlg.fail(explain(err));
      return false;
    }
    if (mid == null) { if (p.photo && /^u-/.test(p.photo)) { p.photo = null; delete p.photoPos; } }
    else setPhoto(p, mid);
    dlg.done();
    App.emit("media", pid);
    toast(mid == null ? "Profile photo cleared." : `Profile photo updated. Everyone will see it in about a minute.`, { kind: "ok" });
    return true;
  }

  /* ---------------------------------------------------------------- loadRemote (public page) */
  /* one manifest item -> a media object built from known fields only, or null. The manifest is served from the
     repository, so anything in it is checked like outside input: short plain strings, positive sizes, paths
     inside media/added/ with no scheme and no "..". Links, transcriptions, credits and other fields never come
     from it (the viewer would turn a link into an href). */
  const ADDED_PATH = /^media\/added\/(t\/)?[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.(jpe?g|pdf)$/i;
  const cleanText = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max) : "");
  const cleanSize = v => (Number.isInteger(v) && v > 0 && v <= 20000 ? v : undefined);
  const cleanPath = v => (typeof v === "string" && ADDED_PATH.test(v) && !v.includes("..") ? v : "");
  function remoteItem(item, pids) {
    const id = item.id;
    const src = cleanPath(item.src);
    if (!src) return null;
    const pdf = item.file === "pdf" || /\.pdf$/i.test(src);
    const kind = pdf ? "document" : ["photo", "headstone", "document"].includes(item.kind) ? item.kind : "photo";
    const m = { id, kind, title: cleanText(item.title, 140) || (pdf ? "Document" : "Photo"), date: cleanText(item.date, 40),
      desc: cleanText(item.desc, 2000), src: prefixed(src), people: pids };
    if (pdf) m.file = "pdf";
    else {
      const thumb = cleanPath(item.thumb);
      if (thumb && !/\.pdf$/i.test(thumb)) m.thumb = prefixed(thumb);
      const w = cleanSize(item.w), h = cleanSize(item.h);
      if (w && h) { m.w = w; m.h = h; }
    }
    const added = cleanText(item.added, 40);
    if (added && !isNaN(Date.parse(added))) m.added = added;
    const by = cleanText(item.by, 39);
    if (/^[A-Za-z0-9-]+$/.test(by)) m.by = by;
    const pos = cleanText(item.pos, 20);
    if (/^\d{1,3}(\.\d+)?% \d{1,3}(\.\d+)?%$/.test(pos)) m.pos = pos;
    return m;
  }

  /* The public page is rebuilt only when Mike runs the build, but uploads land in media/added.json right away.
     Merge what the page doesn't have yet, and drop uploads that were removed since it was built. */
  async function loadRemote() {
    if (!D.public || location.protocol === "file:" || typeof fetch !== "function") return false;
    let data;
    try {
      const res = await fetch("media/added.json", { cache: "no-store", credentials: "same-origin" });
      if (!res.ok) return false;
      data = normalizeManifest(await res.json());
    } catch (e) {
      return false;   // offline, file://, or not there yet: the built page is fine as it is
    }
    const changed = new Set();
    const remoteIds = new Set();
    for (const item of data.items) {
      if (!item || typeof item !== "object" || typeof item.id !== "string" || !MID_RE.test(item.id)) continue;
      remoteIds.add(item.id);
      if (Object.hasOwn(D.media, item.id)) continue;
      const people = Array.isArray(item.people) ? item.people : [];
      const pids = allowedPeople(people);
      // an item that names anyone living is skipped whole; people this page doesn't have are left off it
      if (!pids.length || people.some(x => { const p = personOf(x); return !!p && p.living; })) continue;
      const m = remoteItem(item, pids);
      if (!m) continue;
      D.media[m.id] = m;
      for (const pid of pids) { insertMedia(P[pid], m.id); changed.add(pid); }
    }
    // uploads baked into this page that the repository no longer has (removed since the build)
    for (const mid of Object.keys(D.media)) {
      if (/^u-/.test(mid) && !remoteIds.has(mid) && !String(D.media[mid].src || "").startsWith("blob:")) {
        for (const pid of dropMedia(mid)) changed.add(pid);
      }
    }
    for (const [pid, mid] of Object.entries(data.avatars)) {
      const p = personOf(pid);
      if (!p || p.living || !mediaOf(mid) || !(p.media || []).includes(mid) || p.photo === mid) continue;
      setPhoto(p, mid);
      changed.add(pid);
    }
    if (changed.size) App.emit("media", changed.size === 1 ? [...changed][0] : null);
    return changed.size > 0;
  }

  /* ---------------------------------------------------------------- public API */
  function enabled() { return !!getToken(); }
  /* the person can get an upload button right now */
  function canUpload(pid) { const id = resolvePid(pid); return enabled() && !!personOf(id) && !eligibleReason(id); }
  /* this browser edits the site (connected now, connected before, or the local page): show the editor's
     buttons, and openUpload connects first when needed */
  const isEditorBrowser = () => enabled() || !D.public || read(local, USED_KEY) === "1";
  function offer(pid) { const id = resolvePid(pid); return !!personOf(id) && !eligibleReason(id) && isEditorBrowser(); }
  /* why there's no upload button, in one line, or "" when there's nothing worth saying (ordinary visitors) */
  function whyNot(pid) {
    const id = resolvePid(pid);
    if (canUpload(id)) return "";
    if (!isEditorBrowser()) return "";
    return personOf(id) ? eligibleReason(id) : "This person isn't in the tree.";
  }

  App.editor = {
    enabled, canUpload, whyNot, uploadReason: whyNot, offer, canSetAvatar,
    openUpload: pid => { try { return openUpload(pid); } catch (err) { console.error("[editor] openUpload failed:", err); toast("The upload window couldn't open.", { kind: "error" }); return null; } },
    openSettings: opts => openSettings(opts),
    loadRemote, remove, setAvatar,
    close: () => { if (current) current.close(); },
    isOpen: () => !!current,
    mount() { /* nothing to set up: dialogs are built when they open */ },
  };
})();
