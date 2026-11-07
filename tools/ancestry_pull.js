// Pull the tree's photos, stories, record transcriptions and record scans from Ancestry.
//
// Ancestry has no export for these, so this runs inside a signed-in www.ancestry.com page (the built-in browser
// pane in Claude's desktop app works) and hands everything back as JavaScript tool results. It only reads: every
// request is a same-origin GET with Ancestry's own session, and nothing is sent anywhere else.
//
//   1. python3 -I tools/media.py keys > keys.json      the people and records to fetch, from the latest export
//   2. On any www.ancestry.com page, run this file, then: hftPull.start(<contents of keys.json>)
//   3. Check hftPull.status() until done is true (a few minutes; it pauses between requests).
//   4. Call hftPull.take() until a part says "done": true. Parts are about 2.6 MB of JSON, too big to show,
//      so the tool saves each one to a file.
//   5. python3 -I tools/media.py unpack <pull dir> <part files...>
//      python3 -I tools/media.py import <pull dir>
//   6. python3 -I tools/build_tree.py
(() => {
  const PART = 2600000;            // characters of JSON per part
  const PHOTO_SIDE = 2400, PHOTO_Q = 0.88;
  const SCAN_SIDE = 2000, SCAN_Q = 0.72;
  const SSN = /social security number|\bssn\b/i;

  const pause = ms => new Promise(r => setTimeout(r, ms));
  const get = (url, opts = {}) => fetch(url, {credentials: "include", ...opts});
  const clean = s => (s || "").replace(/\s+/g, " ").trim();
  const list = objs => Array.isArray(objs) ? objs : Object.values(objs || {});

  const toB64 = async blob => {
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = "";
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return btoa(s);
  };

  // Shrink to maxSide and re-encode as JPEG on white. Small JPEGs pass through untouched unless always is set.
  const shrink = async (blob, maxSide, quality, always) => {
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const out = {origW: bmp.width, origH: bmp.height, w: bmp.width, h: bmp.height};
    if (always || k < 1 || blob.size > 1500000 || !/jpe?g/.test(blob.type)) {
      out.w = Math.round(bmp.width * k);
      out.h = Math.round(bmp.height * k);
      const c = new OffscreenCanvas(out.w, out.h), ctx = c.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, out.w, out.h);
      ctx.drawImage(bmp, 0, 0, out.w, out.h);
      blob = await c.convertToBlob({type: "image/jpeg", quality});
    }
    return {...out, bytes: blob.size, b64: await toB64(blob)};
  };

  const storyText = s => {
    if (!/<[a-z][\s\S]*>/i.test(s || "")) return (s || "").replace(/\r\n/g, "\n").trim();
    const d = new DOMParser().parseFromString(s, "text/html");
    d.querySelectorAll("br").forEach(b => b.replaceWith("\n"));
    const paras = [...d.body.querySelectorAll("p, li")].map(p => p.textContent.trim()).filter(Boolean);
    return paras.length ? paras.join("\n\n") : d.body.textContent.trim();
  };

  // One record page: the transcription fields, household tables, citation and the scan's image id.
  const getRecord = async (db, rid) => {
    const r = await get(`/search/collections/${db}/records/${rid}`);
    if (!r.ok) return {db, rid, status: r.status};
    const html = await r.text();
    const d = new DOMParser().parseFromString(html, "text/html");
    d.querySelectorAll("script, style, button").forEach(x => x.remove());
    const rec = {db, rid, url: r.url, name: clean(d.querySelector("h1")?.textContent),
                 coll: clean(d.title.replace(/\s*-\s*Ancestry.*$/i, "")), fields: [], tables: []};
    const dl = d.querySelector("#recordFieldsContainer dl");
    let label = null;
    for (const el of dl ? dl.children : []) {
      if (el.tagName === "DT") label = clean(el.textContent);
      else if (el.tagName === "DD" && label !== null) {
        const v = clean(el.textContent);
        if (!el.querySelector("table") && v && !SSN.test(label)) rec.fields.push([label, v]);
        label = null;
      }
    }
    for (const tbl of d.querySelectorAll("#recordData table")) {
      if (tbl.querySelector("table")) continue;  // only the innermost tables hold rows
      const rows = [...tbl.querySelectorAll("tr")].map(tr => [...tr.children].map(c => clean(c.textContent))).filter(r => r.some(Boolean));
      if (rows.length) rec.tables.push(rows);
    }
    const head = d.querySelector(".citationTitle")?.closest("header");
    rec.citation = head?.nextElementSibling ? clean(head.nextElementSibling.textContent) : "";
    // the image link is drawn client-side, so read its id from the page's data
    const im = html.match(/"images":\[([^\]]*)\]/);
    if (im) {
      rec.images = [...im[1].matchAll(/"id":"([^"]+)"/g)].map(m => m[1]);
      rec.imageDb = html.slice(im.index, im.index + 600).match(/"collection":\{"id":(\d+)/)?.[1] || db;
    }
    if (!rec.images?.length) {
      const m = html.match(/data-image-gid="([^":]+):(\d+)"/);
      if (m) [rec.images, rec.imageDb] = [[m[1]], m[2]];
    }
    const ext = d.querySelector('a[href*="newspapers.com"], a[href*="findagrave.com"]');
    if (ext) rec.external = ext.href;
    return rec;
  };

  const getScan = async (db, imageId) => {
    const tk = await (await get(`/imageviewer/api/media/token?dbId=${db}&imageId=${encodeURIComponent(imageId)}`,
                                {headers: {Accept: "application/json"}})).json();
    if (!tk.imagePrintUrl) throw new Error("no image url");
    const r = await get(tk.imagePrintUrl);
    if (!r.ok) throw new Error("HTTP " + r.status);
    return shrink(await r.blob(), SCAN_SIDE, SCAN_Q, true);
  };

  const state = {step: "idle", done: false, people: 0, records: 0, files: {}, meta: {}, recs: {}, stories: {}, errors: {}, part: 0};

  async function start({tree, people, records}) {
    Object.assign(state, {step: "gallery", done: false, people: 0, records: 0, files: {}, meta: {}, recs: {}, stories: {}, errors: {}, part: 0});
    // 1. each person's gallery: photos, headstones, documents and stories
    for (const pid of people) {
      state.people++;
      try {
        const r = await get(`/api/media/viewer/v1/trees/${tree}/people/${pid}?client=ugcgallery-fe&excludeInlineStories=0` +
          "&collectionId=1030&page=1&rows=100&sort=-created&withTranscription=true" +
          "&filter=Audio&filter=Container&filter=Story&filter=Photo&filter=Video");
        if (!r.ok) { state.errors["person " + pid] = "HTTP " + r.status; continue; }
        for (const o of list((await r.json()).objects)) {
          if (o.category === "story") {
            const s = state.stories[o.id] ||= {title: o.title || "", text: storyText(o.story), by: o.origin?.displayName || "",
                                               pids: [], date: "", place: "", desc: clean(o.description)};
            s.pids.push(pid);
            continue;
          }
          const m = state.meta[o.id] ||= {id: o.id, lookup: o.ms_lookup_id, title: o.title, type: o.type, cat: o.category,
            sub: o.subcategory, ext: o.ext, w: o.width, h: o.height, date: o.date, loc: o.location, desc: o.description,
            url: o.url, prim: o.primaryPhoto, by: o.origin?.displayName, originWeb: o.originWebAddress, pid, pids: []};
          m.pids.push(pid);
        }
      } catch (e) { state.errors["person " + pid] = String(e); }
      await pause(200);
    }
    // 2. the gallery images
    state.step = "photos";
    for (const m of Object.values(state.meta)) {
      if (!m.url) continue;
      try {
        const r = await get(m.url);
        if (!r.ok) throw new Error("HTTP " + r.status);
        state.files["photos/" + m.id] = {folder: "photos", id: m.id, meta: m, ...await shrink(await r.blob(), PHOTO_SIDE, PHOTO_Q, false)};
      } catch (e) { state.errors["photo " + m.id] = String(e); }
      await pause(300);
    }
    // 3. records and their scans (several records often share one census page)
    state.step = "records";
    for (const key of records) {
      state.records++;
      const [db, rid] = key.split(":");
      let rec;
      for (let attempt = 0; attempt < 2; attempt++) {
        try { rec = await getRecord(db, rid); } catch (e) { rec = {db, rid, err: String(e)}; }
        if (rec.status !== 429 && rec.status !== 503) break;
        await pause(15000);
      }
      state.recs[key] = rec;
      if (rec.images?.length) {
        const imgKey = rec.imageDb + "/" + rec.images[0];
        const fileKey = "records/" + imgKey.replace("/", "-");
        try {
          if (!state.files[fileKey]) state.files[fileKey] = {folder: "records", id: imgKey.replace("/", "-"), imgKey, ...await getScan(rec.imageDb, rec.images[0])};
          rec.imageKey = imgKey;
        } catch (e) { state.errors["scan " + key] = String(e); }
      }
      await pause(500);
    }
    state.step = "finished";
    state.done = true;
  }

  // The next part of the pull as JSON. The last part carries the records and stories and says done: true.
  function take(limit = PART) {
    if (!state.done) return JSON.stringify({error: "still pulling", ...status()});
    const files = [];
    let size = 0;
    for (const [k, f] of Object.entries(state.files)) {
      if (!f.b64) continue;
      if (files.length && size + f.b64.length > limit) break;
      files.push({...f});
      size += f.b64.length;
      f.b64 = null;
    }
    const done = !Object.values(state.files).some(f => f.b64);
    const part = {hft: 1, part: ++state.part, files, done};
    if (done) Object.assign(part, {records: state.recs, stories: state.stories, errors: state.errors});
    const s = JSON.stringify(part);
    // pad small parts so the tool always saves them to a file rather than printing them
    return s.length > 300000 ? s : s.slice(0, -1) + ',"pad":"' + " ".repeat(300000 - s.length) + '"}';
  }

  function status() {
    const files = Object.values(state.files);
    return {step: state.step, done: state.done, people: state.people, records: state.records, files: files.length,
            waiting: files.filter(f => f.b64).length, stories: Object.keys(state.stories).length, errors: state.errors};
  }

  window.hftPull = {start: opts => { start(opts); return "started"; }, status, take};
  return "hftPull ready";
})();
