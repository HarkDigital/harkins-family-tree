# Harkins Family Tree

An interactive family tree built from Michael Harkins's Ancestry tree, with the family's photos and
records, published at https://harkdigital.github.io/harkins-family-tree/.

## Updating it

1. On Ancestry, export the tree as a GEDCOM file and put it in `ancestry-export/` (kept out of git).
2. Run `python3 -I tools/build_tree.py`.
3. Commit and push `docs/` (the page and `docs/media/`). GitHub Pages serves the `docs/` folder.

Research that isn't on Ancestry lives in `tools/research.py` and is layered over the export on
every build; the evidence is in `research/`. Those facts are marked "Research" on the site, with
links to their sources. If something no longer fits a new export, the build prints a warning and skips it.

The build writes two pages:

- `docs/index.html` is the public site. Anyone with no death record who was born in the last 100 years,
  or whose age can't be estimated, is shown by name and relationship only. People not connected to the
  family and the "Things to fix" list are left out.
- `family-tree.html` is the full version, with every fact and the fix list, for local use only.

## Photos and documents

Each person's photos, headstones, clippings and stories come from their Ancestry gallery, credited on the
site to the Ancestry member who shared them. Every record the tree or the research cites (censuses,
certificates, draft cards, directories and so on) comes with its transcription and, where Ancestry has one,
a scan of the page, so a source line on the site opens the record itself.

They're kept in `ancestry-export/media/` (out of git). The build copies what the public site may show into
`docs/media/`: `p/` for gallery images, `r/` for record scans and `t/` for 480px thumbnails (made with
macOS `sips`). Left off the public site:

- anything showing or belonging to someone who may be living, including the family photos and clippings
  listed in `PRIVATE` in `tools/media.py`
- in records of the people who are shown, any household member who may be living, relatives' names that
  could be living people, and street addresses; the scan of such a record stays off too, since it shows
  the same details (`redact_public` in `tools/media.py`; the build says how many records it trimmed). A
  record that turns out to be about someone who may be living is left out altogether.
- where people lived as adults when their husband or wife may be living: those homes, and the residence on
  their death records
- the place an Ancestry member gave a photo or document that's undated or from the last 100 years
- links to the trimmed records, and to the obituaries, Find a Grave memorials and funeral pages of anyone
  who died in the last 100 years, since those name the family who survive them (`public_links`)
- the foot of a funeral card that gives the funeral home's site, which leads to the same kind of obituary
  (`PUBLIC_CROP`: the public copy is cut short)
- modern address lists (`PRIVATE_COLLECTIONS`) and the facts only they back up
- Social Security numbers, which are dropped from transcriptions when they're pulled

Ancestry has no export for media, so refreshing them runs in a signed-in Ancestry page:

1. `python3 -I tools/media.py keys > keys.json` lists everyone in the latest export and every record they cite.
2. On www.ancestry.com, run `tools/ancestry_pull.js` in the page, then `hftPull.start(<contents of keys.json>)`,
   and wait until `hftPull.status()` says it's done.
3. Call `hftPull.take()` until a part says `"done": true`, saving each part to a file.
4. `python3 -I tools/media.py unpack <pull dir> <part files...>`, then `python3 -I tools/media.py import <pull dir>`.
5. Rebuild.

## Adding photos from the site

Photos and documents can be added for anyone in the tree, except people who may be living, from the site
itself. Uploads are committed straight to this repository, so they're public as soon as GitHub Pages
republishes (about a minute).

1. Make a fine-grained token at https://github.com/settings/personal-access-tokens/new. Under Repository
   access choose Only select repositories, then HarkDigital/harkins-family-tree. Under Permissions, set
   Contents to Read and write. Nothing else is needed.
2. On the site, open "Add photos and documents" at the bottom of the page (or "Add photo or document" on a
   person), paste the token, press Test, then Save. It stays in that browser tab unless you tick "Remember on
   this device" (every HarkDigital GitHub Pages site shares that storage, so only remember it on your own devices).
3. Drop in photos or PDFs, give them a title, date and description, and add them. Photos are resized in the
   browser, and one can be made the person's profile photo.

Uploads land in `docs/media/added/` and are listed in `docs/media/added.json`, which the build reads too.
Because the site commits to `main`, run `git pull` before committing locally.

## How it's built

- `tools/build_tree.py` reads the GEDCOM, layers `tools/research.py` over it, adds the media from
  `tools/media.py`, and inlines everything into the page made from `tools/site/` (see `tools/site/README.md`).
- `python3 -I tools/build_tree.py --dev NAME` writes `dev-NAME.html` and `docs/dev-NAME.html` (both
  gitignored) to preview changes to the page without touching the real ones.
