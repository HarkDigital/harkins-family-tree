# tools/site: the family tree front end

`python3 -I tools/build_tree.py` turns these files into one self-contained HTML page:
`family-tree.html` (local, everything) and `docs/index.html` (public, GitHub Pages). Never edit those two by hand.

## Files and load order

| Step | Files |
|---|---|
| Page shell | `index.html` (the build fills its three placeholders) |
| CSS, in order | `site.css`, `chart.css`, `family.css`, `person.css`, `viewer.css`, `editor.css` |
| JS, in order | `core.js`, `chart.js`, `family.js`, `person.js`, `viewer.js`, `editor.js`, `app.js` |

- Missing files are skipped. Each JS file gets its own `<script>` tag ending in `//# sourceURL=<file>`, so a
  syntax error in one file doesn't stop the others and stack traces name the file.
- `index.html` must keep exactly `<style>/*__CSS__*/</style>`, `<script>const D = /*__DATA__*/{};</script>` and
  `<script>/*__JS__*/</script>`.
- All scripts share one global scope. `core.js` declares the top-level names listed below. **Every other file
  wraps itself in an IIFE** `(() => { ... })();` and exposes only `App.<module> = {...}`. Don't declare
  top-level `const`/`let`/`function` names in module files (a repeat of `P`, `$`, `el`... is a SyntaxError).
- Modules must not touch the DOM when their script runs: do everything in `mount()`. `app.js` runs last,
  renders the page, then mounts the modules.

## Build and preview

```sh
cd "/Users/michaelharkins/Hark.Digital Dropbox/Mike Harkins/Claude Code/Harkins Family Tree"
python3 -I tools/build_tree.py --dev <name>
```

`--dev <name>` writes `docs/dev-<name>.html` (public data, media under `docs/media/`) and `dev-<name>.html` at
the repo root (local data with "Things to fix"; media under `ancestry-export/media/`). It leaves the real
pages alone. Never run the build without `--dev` while developing. Delete your dev pages when you're done.

Headless check (see the top of `qa/shot.mjs` in the scratchpad for all steps):

```sh
node shot.mjs --root "<repo>/docs" --path /dev-<name>.html --out <abs>.png [--phone] [--dark] [--full] [--steps '<json>']
node shot.mjs --root "<repo>" --path /dev-<name>.html ...      # the local page
```

`html { scroll-behavior: smooth }` is on, so in test steps set
`document.documentElement.style.scrollBehavior = "auto"` before scrolling, or screenshots catch mid-scroll.

## Page structure and ids

```
header#topbar.topbar               sticky top bar (wordmark, nav, search, theme), z --z-bar
main#main
  section#tree.tree                fills the viewport under the bar (never taller on short screens); data-view="chart"|"family";
                                   .has-panel while a person is selected. Holds the page's only h1 (visually hidden).
    div#tree-toolbar.tree-toolbar
      div#view-switch.seg          Chart / Family switch (app.js)
      div#tree-tools.tree-tools    the slot for the active view's controls (scrolls sideways if it overflows)
        div#chart-tools            chart.js puts its controls here   (App.toolbar("chart"))
        div#family-tools           family.js puts its controls here  (App.toolbar("family"))
      div#tree-toolbar-end         "Centered on ..." and "Back to Michael" (app.js)
    div#tree-stage.tree-stage      position: relative; overflow: hidden; display: flex
      div.tree-views               flex: 1; position: relative
        div#chart-view.tree-view   mount point for App.chart  (position: absolute; inset: 0; overflow: hidden)
        div#family-view.tree-view  mount point for App.family (same); the inactive one has [hidden]
      aside#person-panel.person-panel   mount point for App.person; .is-open while a person is selected
    div#tree-more.tree-more        phones and touch screens only: "More below the tree", a bar under the stage that
                                   scrolls to #intro (a swipe in the tree moves the tree, not the page) (app.js)
  section#intro                    the headline and numbers (app.js), above Lines so the "Lines" link lands on the lines
  section#lines, #research, #fix (local only), #everyone    rendered by app.js; sections 01-04 are numbered in that
                                   order. Research, Fix and Everyone render when the browser is first idle (or on the
                                   first scroll), so the tree responds sooner: don't assume they exist at mount time.
    #everyone > div#everyone-bar   the filter, count, chips and A-Z (sticky under the bar on phones)
footer#footer
div#toasts.toast-stack             toast()
```

### Views (chart.js, family.js)

- `mount(el)` gets `#chart-view` / `#family-view`. It holds a quiet placeholder until then: replace it with
  `el.replaceChildren(...)`. The element is absolutely positioned and clipped; fill it (`height: 100%`).
  It can be resized at any time (the panel docks beside it on desktop): use a `ResizeObserver`.
- Toolbar controls: `const bar = App.toolbar("chart")` (`#chart-tools`), then append your controls in `mount`.
  app.js shows only the active view's slot. Use the shared controls: `.btn.btn-sm`, `.btn.btn-icon.btn-sm`
  (icon buttons), `.seg.seg-sm` (and `.seg-icons`) for choices, `.tool-group` (inline group, optional
  leading `.label`), `.tool-sep` (a 1px vertical rule between groups). They reach 44px at phone width.
- `focus(pid)` is called on the active view for every `"focus"` event, and on the newly active view right
  after a switch (with `App.state.focus`). The hidden view is not called; read `App.state` when you're shown.
- `refresh(pid)` is called after a `"media"` event (photos or avatars changed) with that event's pid, or with no
  argument for "many". The chart rebuilds only that person's cards when given a pid; the family view re-renders.
- Clicking a person: `App.go(pid, {focus: false})` selects (opens the panel) without re-centering;
  `App.go(pid)` re-centers and selects. Don't call `App.person` directly.
- Chart specifics (chart.js): a single click or tap selects after 250ms, so a second click on the same card can
  make it a double-click (re-centre; on phones that re-centres without opening the sheet). Keyboard: arrows move
  the cursor card, Enter selects, `e` shows or hides an edge ancestor's extra generations. The parents' brothers and
  sisters bring their children along as indented cousin rows (`kind: "cousin"`, `down` = the parent's sibling
  row, a `c:` edge down its left side); a cousin with two aunt/uncle parents in the chart appears under both. "Expand all" shows every
  generation with every brother and sister (`S.gens = Infinity`, siblings on, `S.groupsAll`: every "+N more" group
  open, `S.openGroups` then holding the groups folded again); "Collapse all" goes back to the first-visit chart
  (four generations, big families folded, no edge expanded) and its home view. Each is disabled when it would
  change nothing; the one just used hands keyboard focus to the other (or, when both are disabled, to the pressed
  generations button). When the toolbar runs short of room, `fitTools` takes words away in steps (`.is-snug`: the
  zoom percentage; `.is-compact`: the words of Expand all and Collapse all; `.is-tight`: the Generations label;
  `.is-cramped`: the word Siblings; `.is-bare`: the separators) before the slot scrolls sideways. Touch screens
  have no tooltips for icon-only buttons, so there `.is-tight` and `.is-bare` come before `.is-compact`. On phones all of it is
  in the "View" panel, which goes to two columns on short screens and scrolls if it still doesn't fit. The line
  legend lives at the right end of the column-header strip and folds into a "Lines" button when the chart is
  narrower than 1180px or on phones. The default layout is `S.layoutMode = "fan"`: each generation column is
  packed as close as it can get to the cards it hangs from and deep columns fan out with longer connectors, so the
  first view fits Michael, his parents and all four grandparents. This departs from the spec's "center the
  child's card on the midpoint of the parents' cards"; the old contour placement is still there as `"stair"` /
  `"center"`. Touch layouts (`pointer: coarse`) use taller sibling rows and a phone "View" menu for generations,
  siblings, Expand all and Collapse all, zoom, Fit and Center; on touch screens wider than a phone the zoom
  buttons are hidden (pinch zooms) so the other tools keep their room in the toolbar. A column label that only
  the legend squeezes is hidden rather than shortened to "Gen. N".
- Links from a view to a page section: `App.goSection(id)` (`"tree"`, `"intro"`, `"lines"`, `"research"`,
  `"fix"`, `"everyone"`), which renders a lazy section first and then scrolls to it.

### Person panel (person.js)

- `mount(el)` gets `#person-panel`. `show(pid)` is called for each `"select"` with a pid, `close()` for
  `"select"` with null. app.js adds/removes `.is-open` on `#person-panel` and `.has-panel` on `#tree`.
- To close from inside (×, Escape, swipe down): call `App.select(null)`; app.js then calls `close()`.
- Layout room app.js provides (site.css):
  - Desktop (>= 1100px): docked on the right; the panel animates `width` 0 -> `--panel-w` (420px) and the
    views shrink. Put your content in one child element: site.css gives `#person-panel > *` a fixed
    width of `--panel-w`, so text doesn't reflow while it opens. That child should be `height: 100%` with
    its own `overflow-y: auto`.
  - Tablet (700-1099px): floats over the right of the stage, `min(420px, 62%)` wide, slides in.
  - Phone (< 700px): `position: fixed` bottom sheet, `92dvh` tall, `z-index: var(--z-sheet)`. It is
    translated by `--sheet-y` when open (0 = fully open). person.css owns the snap points, the drag handle,
    swipe-to-close, any scrim and the body scroll lock: set `--sheet-y` inline while dragging
    (`transition: none`) and to the snap value after (e.g. `calc(92dvh - 45dvh)` for the half snap).
- "Show in Family view": `App.setView("family")`.

### Viewer (viewer.js)

- If `App.viewer.mount` exists it is called once with `document.body`; append your own root there
  (`z-index: var(--z-viewer)`, backdrop `var(--viewer-bg)`).
- Open with `App.openMedia(mid, list)` (never call `App.viewer.open` from other modules). It sets
  `App.state.media`, pushes `#/<pid>/m/<mid>` and calls `App.viewer.open(mid, list)`.
- Layout: an info column on the right on desktop and landscape tablets; an info drawer under the image on phones
  and upright tablets (`(max-width: 699px), (max-width: 1099px) and (orientation: portrait)`; viewer.js
  `DRAWER_QUERY` matches viewer.css). Tapping the dimmed stage while the drawer is open collapses the drawer; it
  closes the viewer only when the drawer is already collapsed.
- Don't touch `location` or `history` in the viewer. On prev/next call `App.mediaShown(mid)` (rewrites the
  hash in place). When you close yourself (×, Escape, backdrop) call `App.mediaClosed()` (pops the
  viewer's history entry). When the user presses Back, the router calls `App.viewer.close()` itself, and
  `App.mediaClosed()` is a no-op then, so it's safe to call from `close()` every time.
- People links in the viewer: just `App.go(pid)`; it closes the viewer for you.

### Editor (editor.js)

- `App.editor`: `enabled()`, `canUpload(pid)` (connected, and the person is on the shared site:
  not line `"none"` / "Not connected to your family"), `offer(pid)` (eligible and
  this is an editor's browser: connected now, connected before, or the local page), `uploadReason(pid)` (one
  line, "" for ordinary visitors), `openUpload(pid)`, `openSettings()`, `loadRemote()`, `remove(mid)` (asks in
  its own confirm dialog), `setAvatar(pid, mid)`, `canSetAvatar(pid, mid)`, `close()`, `isOpen()`.
- The person panel shows "Add photo or document" when `canUpload || offer`; otherwise the `uploadReason` line
  if there is one (for editors), and nothing at all for ordinary visitors.

- `mount` (optional) is called once with `document.body`. app.js calls `App.editor.loadRemote()` on the
  public page right after mounting (it may return a promise; failures are logged).
- The footer shows "Add photos and documents" -> `App.editor.openSettings()` when `App.editor` exists.
- After a change, update `D.media` / `P[pid].media` / `P[pid].photo` and `App.emit("media", pid)`;
  app.js refreshes the Everyone list, the Lines counts and both views (`refresh()`).
- Dialogs: `z-index: var(--z-dialog)`, trap focus, close on Escape.
  On tablet and phone the child should simply be `width: 100%; height: 100%`.

## App.state and events

```js
App.state = { focus: pid, selected: pid | null, view: "chart" | "family", media: mid | null }
```

Read it freely; change it only through `App.go`, `App.select`, `App.setView`, `App.openMedia`.

| Event | Payload | Emitted by | Meaning |
|---|---|---|---|
| `"focus"` | pid | `App.go` (focus), router | re-center the tree on pid. app.js calls the active view's `focus(pid)` |
| `"select"` | pid or null | `App.go` (select), `App.select`, router | show pid in the person panel; null closes it. app.js calls `App.person.show/close` |
| `"media"` | pid (or null for "many") | editor | pid's photos/documents/avatar changed |
| `"view"` | "chart" or "family" | `App.setView`, the switch | the active view changed (not emitted for the initial view) |
| `"theme"` | "auto", "light" or "dark" | the theme toggle | the user picked a theme |

`App.on(evt, fn)` returns an unsubscribe function (`App.off(evt, fn)` also works). `App.emit` runs every
listener in its own try/catch and logs failures with `console.error`, so one module can't break another.

## Router

- The hash is `#/<id>` where `<id>` is the pid without its `@`s (`#/I342198302222`, `#/R-william-harkins-1859`),
  or `#/<id>/m/<mid>` while the viewer is open. Each history entry carries `{focus, selected}`, so Back and
  Forward restore both. Section anchors (`#lines`) aren't routes; the nav scrolls without changing the hash.
- `App.go(pid, {focus = true, select = true, replace = false, scroll = false})`: pid may be `"@I1@"` or
  `"I1"`. Pushes a history entry (or replaces it when nothing changed or `replace`), emits `"focus"` and/or
  `"select"`, closes the viewer, and with `scroll: true` scrolls the tree into view. Returns false for an
  unknown pid.
- `App.select(pid | null)`: select without re-centering; `App.select(null)` closes the panel.
- `App.setView("chart" | "family")`: switch views and remember the choice (localStorage `hft.view`).
  Without a stored choice phones start on Family and wider screens on Chart.
- `App.openMedia(mid, list?)`, `App.mediaShown(mid)`, `App.mediaClosed()`: see Viewer above. Without a
  viewer module `openMedia` opens the file in a new tab or shows a toast; it never throws.
- `App.scrollToTree()`, `App.toolbar(view)`, `App.startRouter()` (app.js calls it once at boot; the default
  with no hash is `D.root` focused and nothing selected). `scrollToTree` glides only for short distances on wider
  screens and jumps otherwise; `App.go(..., {scroll: true})` scrolls before it emits, so the phone sheet's scroll
  lock never freezes a glide halfway.
- A hash that names nobody on this page (`#/I999`, or someone only on the local copy) shows the toast "That person
  isn't on this page." and is replaced by the hash of what is on screen; a missing media id likewise. While the viewer
  is open the hash names the person in the panel (`App.state.selected`, else the focus), not the item's owner.

## Core API (core.js top-level names)

```
App, P (= App.P = D.people), App.ROOT (= D.root)
LINE_NAMES {harkins: "Harkins line", perret, dymond, henwood, self: "Immediate family", none: ""}
LINE_KEYS ["harkins", "perret", "dymond", "henwood"]
el(tag, props, ...children)   props: class (string or array), text, html (trusted only), style (string or object,
                              "--vars" allowed), dataset, on<event>: fn, other keys -> attributes (true -> "",
                              false/null skipped); children: nodes, strings, numbers, nested arrays; null/false/"" skipped
$(sel, root?), $$(sel, root?) querySelector / querySelectorAll as an array
store.get(key, fallback), store.set(key, value | null)   localStorage that never throws
years(p)           "1888–1943", "b. 1926", "d. 1901", "1850–?", "Living" (no dates), or ""
lifeLine(p)        "Born 26 Nov 1888, Philadelphia, Pennsylvania · Died 23 Jun 1943, Philadelphia, Pennsylvania"
                   (falls back to baptism/burial; "" when nothing is recorded)
shortPlace(place)  "Philadelphia, Philadelphia, Pennsylvania, USA" -> "Philadelphia, Pennsylvania"
lineColor(p)       "var(--harkins)" ...;  firstName(p), initials(p) ("GD" for "Glen Austin Dymond Sr.")
avatar(p, {size = 40, cls})   <span class="avatar is-photo|is-mono" style="--av: 40px; --lc: ..."> square:
                   an <img> (object-fit cover, object-position p.photoPos, lazy, alt = name) when p.photo has a
                   thumb or src, else the monogram; a broken image falls back to the monogram. Size classes:
                   .avatar-xs 22, -sm 32, -md 48, -lg 64, -xl 96 (or pass size).
                   {decorative: true} when the name is printed beside it in the same button or link: alt="" and an
                   aria-hidden monogram, so screen readers don't hear the name twice
jumpScroll(fn)     run fn's scrolling without html's smooth glide (use behavior: "instant" inside fn too)
photoOf(p)         {m, url} of the profile photo or null (null for hidden people)
media(mid)         D.media[mid];  personMedia(pid, kinds?) -> [media] in the person's order ([] when hidden);
                   kinds is "photo" or ["photo", "headstone"]
mediaUrl(path)     the path as given (already page-relative);  kindLabel(m) "Photo", "Headstone", "Document",
                   "Story", "PDF document", or m.type for records
search(q, limit = 8) -> [pid]   name prefix and word matches first, then birthplace and years; ignores
                   accents and case; every word of q must match
fold(s)            lowercase, accents stripped (for your own matching)
isPhone()          matchMedia("(max-width: 699px)").matches;  PHONE_QUERY is that MediaQueryList
plural(n, "photo") "1 photo" / "3 photos";  bareId(pid) "I342..."; resolvePid("I342...") -> "@I342...@" or null
                   (own keys only: "constructor" or "__proto__" never resolve; media(mid) likewise);
                   hasOwn(obj, key) for your own lookups in P / D.media
toast(msg, {kind: "info" | "ok" | "error", timeout})
icon(name, size = 20) -> <svg class="icon icon-NAME"> 24px grid, 1.75 stroke, square caps, currentColor
```

Icons: search, close, chevron-left/right/up/down, arrow-left/right, plus, minus, fit, center, tree, family,
image, document, upload, download, external, sun, moon, auto, menu, edit, trash, star, users, link, zoom-in,
zoom-out, expand, collapse, home, check, info, filter.

## Design rules (Mike's, non-negotiable)

- **Square corners everywhere**: `border-radius: 0` on everything (site.css has a `!important` backstop).
  No pills, no circles; dots and markers are small squares (`.marker`). Accents are straight rules
  (a 3-4px top or left bar), never a curved colored border.
- **Sans-serif only**: Libre Franklin (`var(--font)`). Headings 700-800 with tight tracking, body 400/500,
  tracked caps labels 600 at .12em (`.label`). Numbers: `font-variant-numeric: tabular-nums`. Never IBM
  Plex Mono, no serif, no monospace.
- Editorial and archival: flat surfaces, 1px hairlines (`--rule`, `--rule-strong`), photos framed square with
  a 1px rule. A soft shadow (`--shadow-float`) only for things that float (panels, sheets, menus, toasts).
- Light and dark: use the tokens only, never raw colors (except on the viewer's near-black backdrop).
- Touch targets at least 44px at phone width **and on any touch screen** (`@media (pointer: coarse)` in site.css
  sets `--control-h` and `--control-h-sm` to 44px there, so the shared controls grow on landscape phones and
  tablets too; size your own controls from those tokens or the same query). No horizontal page scroll at
  320-390px; inner strips may scroll sideways.
- Short screens (`max-height: 520px`, landscape phones): `--bar-h` is 48px, the toolbar is tighter, the tree is
  exactly the viewport under the bar, and below 1100px wide the top bar is the phone one (search icon + menu).

## Conventions

**Class prefixes**: each module styles only its own prefix: `ch-` chart, `fv-` family view, `pp-` person
panel, `vw-` viewer, `ed-` editor. site.css owns everything unprefixed. Reuse the shared components rather
than restyling them.

**Breakpoints**: phone < 700px, tablet 700-1099px, desktop >= 1100px
(`@media (max-width: 699px)`, `(min-width: 700px) and (max-width: 1099px)`, `(min-width: 1100px)`), plus
`(pointer: coarse)` for touch sizing and `(max-height: 520px)` for short screens.

**z-index**: `--z-bar` 100 (top bar), `--z-panel` 60 (docked person panel, inside the stage), `--z-sheet` 200
(phone sheet, phone menu, search sheet), `--z-viewer` 300, `--z-dialog` 400, `--z-toast` 500. Inside your
own module root use small local values (1-10).

**Tokens** (all on `:root`, re-defined for dark):

| Group | Names |
|---|---|
| Surfaces | `--bg` page, `--surface` panels and cards, `--surface-2` hover/wells, `--surface-3` pressed |
| Ink | `--ink` text, `--ink-2` secondary body text, `--muted` labels and meta, `--faint` placeholders |
| Rules | `--rule` hairline, `--rule-strong` borders of controls, connectors, `--rule-input` text field borders (3:1) |
| Accent | `--accent` links, focus, selection outline; `--accent-ink` text on accent; `--on-ink` text on `--ink` |
| Lines | `--harkins --perret --dymond --henwood --self --none` (set `--lc: var(--harkins)` and use `var(--lc)`) |
| Status | `--error --duplicate --check --ok` and `-bg` tints of each |
| Effects | `--shadow-float`, `--scrim`, `--viewer-bg`, `--bar-bg`, `--selection` |
| Type | `--font`, `--text-2xs` 11 `--text-xs` 12 `--text-sm` 14 `--text-base` 16 `--text-md` 18 `--text-lg` 22 `--text-xl` 28 `--text-2xl` `--text-3xl` (fluid); `--leading-tight` `--leading-snug` `--leading`; `--tracking-tight` `--tracking-caps` |
| Space | `--space-1` 4 `--space-2` 8 `--space-3` 12 `--space-4` 16 `--space-5` 24 `--space-6` 32 `--space-7` 48 `--space-8` 72 |
| Layout | `--gutter` 16/24/40, `--container` 1360, `--bar-h` 56/60/64, `--toolbar-h`, `--panel-w` 420, `--tap` 44, `--control-h`, `--control-h-sm`, `--safe-b` |
| Motion | `--ease`, `--ease-in-out`, `--dur-fast` 120ms, `--dur` 220ms, `--dur-slow` 380ms (reduced motion zeroes all of them) |

**Shared components** (site.css): `.btn` + `.btn-primary | .btn-accent | .btn-secondary | .btn-ghost`, `.btn-sm`,
`.btn-icon`, `.btn-block`; `.link` (accent text action); `.input` (also textarea/select), `.input-icon`
wrapper, `.field`, `.check`; `.chips` / `.chip` (`aria-pressed="true"` for on, `.chip-count`); `.tag`;
`.seg` (+ `.seg-sm`, `.seg-icons`; buttons with `aria-pressed`); `.label` (+ `.label-lg`); `.marker`
(square in `--lc`); `.rule`, `.rule-strong`, `.rule-ink`; `.avatar`; `.plink` (person link: tiny avatar,
name, years); `.scrim`; `.sr-only`; keyframes `fade-in`, `drop-in`, `rise-in`, `toast-in`.

Focus: `:focus-visible` is a 2px solid `--accent` outline (square). Don't remove it; if a control sits on an
edge, use `outline-offset: -2px`.

## What the public page leaves out

The public page is `docs/index.html` (`D.public === true`). It shows living relatives in full, like everyone
else (Mike's call, 9 Nov 2026). What it still leaves out:

- `D.issues` ("Things to fix") exists only on the local page; the public page gets `[]`.
- The local page (`family-tree.html`) shows everything. Never copy local-only data into anything that goes
  to `docs/`.
- The GitHub token (editor) lives in sessionStorage `hft.githubToken` (localStorage only when the user ticks
  "Remember on this device"); never log it or send it anywhere but https://api.github.com.

## Storage keys

`hft.theme` ("light" | "dark"; absent = auto, applied before first paint by the inline head script),
`hft.view` ("chart" | "family"; only after an explicit choice), `hft.chart.gens` ("3"-"6" or "all"; default 4),
`hft.chart.sibs` ("off" when siblings are hidden; absent = on), `hft.chart.groups` ("all" after "Expand all": every
sibling group open; absent = big families folded), `hft.githubToken` (editor; sessionStorage, or
localStorage with "Remember on this device"), `hft.editorUsed` ("1" once this browser has connected the editor:
keeps the "Add photo or document" buttons visible). Always go through `store` or try/catch.
