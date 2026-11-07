# Harkins Family Tree

An interactive family tree built from Michael Harkins's Ancestry tree, published at
https://harkdigital.github.io/harkins-family-tree/.

## Updating it

1. On Ancestry, export the tree as a GEDCOM file and put it in `ancestry-export/` (kept out of git).
2. Run `python3 -I tools/build_tree.py`.
3. Commit and push `docs/index.html`. GitHub Pages serves the `docs/` folder.

Web research that isn't on Ancestry lives in `tools/research.py` and is layered over the export on
every build; the evidence is in `research/`. Those facts are marked "Web research" on the site, with
links to their sources. If something no longer fits a new export, the build prints a warning and skips it.

The build writes two pages:

- `docs/index.html` is the public site. Anyone with no death record who was born in the last 100 years,
  or whose age can't be estimated, is shown by name and relationship only. People not connected to the
  family and the "Things to fix" list are left out.
- `family-tree.html` is the full version, with every fact and the fix list, for local use only.
