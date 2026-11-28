# Erik's Life App

A personal app that runs in the browser: bills and budgeting, the 401(k), taxes, health, vehicles, the house, pets,
insurance, dinners, the kids' lunches, gifts and career. It's static HTML and JavaScript with no build step, served by
GitHub Pages from `docs/` at **https://erikfol.github.io/erik-life-app/**. The data is never put on GitHub: it lives in
a folder on the PC (and in Dropbox, for the tablet), and the pages read and write it there.

## Sections

| Section | Code | Saves to |
|---|---|---|
| Home page (red / yellow counts, Backup, assistant) | `docs/index.html`, `docs/shared/js/home.js` | `backups.json`, `inputs/assistant/` |
| Bills Etc | `docs/bills-etc/` | `inputs/…` (bank CSVs, savings, loans_cc, electric, water, …), `output_master_data/`, `config.json` |
| 401(k) | `docs/401k/` | `inputs/401k/` |
| Taxes | `docs/taxes/` | `inputs/taxes/` |
| Health | `docs/health/` | `inputs/health/` |
| Vehicles | `docs/vehicles/` | `inputs/vehicles/` |
| House | `docs/house/` | `inputs/house/` |
| Pets | `docs/pets/` | `inputs/pets/` |
| Insurance | `docs/insurance/` | `inputs/insurance/` |
| Dinner Planner | `docs/dinner-planner/` | `inputs/dinner-planner/` |
| Kid Lunches | `docs/kid-lunches/` | `inputs/kid-lunches/` |
| Gifts, Bday, Anniversary | `docs/gifts/` | `inputs/gifts/` |
| Working Career | `docs/career/` | `inputs/career/` |

## How the code is laid out

Each section's folder has `index.html`, `js/app.js` (the start; most sections use `shared/js/section.js` for the
parts they all share), a data module that reads and writes its files, `js/alerts.js` (its red and yellow rules, which
the Home page counts and the menus are coloured by), `js/views/` (its pages) and sometimes `css/`.

`docs/shared/` holds what every section uses, and a section never imports from another section's folder:

- `js/fs.js` (the data folder, or Dropbox on a tablet), `fileguard.js` (won't save over a file changed elsewhere),
  `folder.js`, `section.js`, `navcolors.js`
- `js/util.js`, `dates.js`, `csv.js`, `charts.js`
- `js/datatable.js` + `filtermenu.js` (sortable, filterable tables), `recordtable.js` (editable record tables),
  `infobox.js`, `infolinks.js`, `gallery.js`, `places.js`, `guidetext.js`, `appointments.js`, `lightbox.js`
- `js/backup.js`, `js/assistant/` (the Home page)
- `css/app.css` (the look every section shares), `records.css`, `sections.css`

Before committing changes to `docs/`, run `python tools/stamp_version.py` (so browsers fetch the new files at once
rather than up to 10 minutes later) and `node --test` (the tests in `tests/`). For a change that should leave the
pages as they were, `node tools/check/run.mjs` compares every page before and after on a copy of your data
(see `tools/check/README.md`).

To run it locally: `python -m http.server 8000 -d docs` and open http://localhost:8000.

## Bills Etc

The bills and budget section, at **https://erikfol.github.io/erik-life-app/bills-etc/**. It reads Citizens Bank
transaction CSVs, categorizes each line (your history first, then optionally a local Ollama model, 100% offline), keeps
a master history, and shows the month, savings, bills, utilities and loans.

- In **Chrome or Edge** you connect the data folder on the Setup page; the app reads and writes `inputs/`,
  `output_master_data/` and `config.json` there.
- The data lives in the Dropbox app folder `Dropbox\Apps\ErikLifeApp\`, so a **tablet or phone** can use it too: there
  the app signs in with Dropbox (`docs/shared/js/dropbox.js`, Dropbox app "ErikLifeApp", app-folder access only) and
  reads and writes the same files through Dropbox. On the PC, `inputs/` and `output_master_data/` in this
  repo are links (junctions) into that folder.
- AI calls go straight from the browser to your local Ollama (model `qwen2.5:3b`; `ollama pull qwen2.5:3b` once). For the
  GitHub Pages address, allow its origin once, then restart Ollama: `setx OLLAMA_ORIGINS "https://erikfol.github.io"`.
  Run locally, Ollama needs no setup: it allows localhost by default.
- Pages: **Setup** (add bank CSVs, optional AI for new merchants, close the month; things to update; bills & paydays
  calendar), **This Month** (projection and left to spend), **Savings**, **Checking History** (history report and AI
  analysis), **Income** (expected monthly take-home, and every paycheck charted with your notes in
  `inputs/income/pay_notes.csv`), **Bills** (scheduled bills in `config.json` `scheduled_bills`: paid / due / late each
  month, 12-month grid, suggestions from history), **Utilities** (Electric, Water, Home Heating, Propane, Property
  Taxes), **Loan/CC**, **Finance Table** (fix the processed month or the master), **Forgettable Subs**, **Config**
  (Categories; Merchants: one table of merchant rules and the names that still need one).

Merchant names and forced categories come only from `merchant_rules` in `config.json` (edit them on Config → Merchants).

### Configuration: `config.json`

| Key | Purpose |
|---|---|
| `monthly_income_*` | Expected monthly take-home pay, summed for This Month. Kept in step with `income_sources` (`{name, per_pay, every}`: each source's take-home per paycheck and how often it comes), which the Income page edits |
| `scheduled_bills` | The bills on the Bills page |
| `variable_categories` | Categories that are day-scaled to project the full month |
| `categories` | Your category list (optional; defaults to the built-in 12). Managed on the Config page |
| `category_renames` | Old → new names, so the built-in rules and older data follow a rename (managed by the Config page) |
| `merchant_rules` | `{name?, bank_text: [...], match: [...], category?}`: when the bank text contains one of `bank_text` (letters only) or the merchant is one of `match`, use this name and/or category. Managed on Config → Merchants |

Keys starting with `_` are notes and are ignored.

### Data and folders

| Path | Contents |
|---|---|
| `inputs/past_months/` | Bank CSVs of closed months |
| `inputs/current_month/` | Bank CSV for the current month (one file) |
| `output_master_data/all_time_finances.csv` | Master history of all transactions |
| `output_master_data/processed_current_month.csv` | Current month's categorized rows (fix them on Finance Table) |
| `output_master_data/categorized_cache.csv` | AI categorization cache for the current month |

### Categories

`Groceries, Dining Out, Utilities, Rent/Mortgage, Entertainment, Shopping, Transport, Gas, Income, Savings, Credit Card, Miscellaneous`

Categorization order: your edits in the processed file → **your history** → the AI cache → your merchant rules (when
they give both a name and a category) → the AI (when it's on) → keyword rules. Merchant rules then apply to everything
but your own edits.

**History-first:** a transaction whose merchant (first three words of the description, letters only, so store numbers
are ignored) already appears in the master gets that merchant's most common category, as long as that category is a
strict majority. That covers roughly 80% of transactions, so the AI only sees new merchants. Fixing a category in the
master teaches the lookup (`docs/bills-etc/js/history.js`). For a merchant the AI keeps getting wrong, add a merchant
rule with a category (Config → Merchants).

Bank CSVs need Citizens Bank's columns (`Date`, `Description`, `Amount`, …); sensitive columns (account numbers,
balance) are dropped on import.

The original Python scripts (`1_…` to `4_close_month.py`) were retired in favour of these pages; they're in the git
history before this change if ever needed.
