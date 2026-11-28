# The before-and-after check

Loads every page of the app twice, as it was (a git commit) and as it is now (this folder, with any changes not yet
committed), on a copy of your data, and reports what's different. Use it before committing a change that should
leave the pages as they were (moving code, renaming, clean-up), or to see exactly what a change does.

```
node tools/check/run.mjs                    # this folder against the last commit (HEAD)
node tools/check/run.mjs --base main        # against main, e.g. everything on a branch
node tools/check/run.mjs --only home,bills-etc,house    # just these (home = the Home page)
node tools/check/run.mjs --keep             # keep the screenshots and results to look at
```

It takes a few minutes. It needs Node 22 or later and Chrome or Edge (set `CHROME` to the browser's path if it isn't
found).

## What it does

1. Copies your data (`config.json`, `inputs/`, `output_master_data/`, `backups.json`) from the data
   folder (where this repo's `inputs/` link points, or `--data <folder>`) into a temporary folder.
2. Checks out the `--base` commit into a temporary folder too.
3. For each of the two: starts a small local web server, opens a headless browser with an empty profile, puts the data
   copy in that browser's private storage (so the app connects to it by itself), and visits the Home page and every
   page, tab and pill reachable from each section's links. For each it keeps the text, the menu and its red / yellow
   colours, the Home page's counts, any errors, and a screenshot.
4. In each section with a record table on its first page, it starts editing, changes a cell, tries to leave, answers
   Cancel (the page should stay) and then OK (it should leave). Nothing is saved.
5. Prints the differences, then deletes the temporary folder (unless `--keep`).

Your real data folder is only read, never written: everything the pages save goes into the copy.

## Reading the report

- **Different text, menu or counts**, **on one side only**, **new errors**, or a **CHANGED** unsaved-edits line: the
  change does something visible. Expected if that was the point; otherwise look into it. The exit code is 1.
- **Same text, different pixels**: the page looks different, with the same words. Run with `--keep` and compare the
  screenshots. Charts, colour fades and photos still loading can differ by timing between two runs of the same code,
  so a few hundred scattered pixels on a chart page is usually noise; a change in the size of the page, or a whole
  area, is not.
- Times of day ("Last updated … 8:40 AM") are ignored in the text.

The temporary folder holds a copy of your data, so with `--keep`, delete it when you're done (the report says where).
