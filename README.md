# Erik's Life App

A personal app that runs in the browser: bills and budgeting, the 401(k), taxes, health, vehicles, the house, pets,
insurance, dinners, the kids' lunches, gifts and career. It's static HTML and JavaScript with no build step, served by
GitHub Pages from `docs/` at **https://erikfol.github.io/erik-life-app/**. The data is never put on GitHub: it lives in
a folder on the PC (and in Dropbox, for the tablet), and the pages read and write it there.

The Python scripts at the top of the repo are the original Bills Etc command-line workflow (see **Workflow** below).

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
rather than up to 10 minutes later) and `node --test` (the tests in `tests/`).

To run it locally: `python -m http.server 8000 -d docs` and open http://localhost:8000.

## Bills Etc

The browser version of the whole bills workflow, at **https://erikfol.github.io/erik-life-app/bills-etc/**. It reads
Citizens Bank transaction CSVs, categorizes each line (history first, then optionally a local Ollama model, 100%
offline), keeps a master history, and shows the month, savings, bills, utilities and loans.

- In **Chrome or Edge** you connect the data folder on the Setup page. The app then reads and writes the same files as the scripts (`inputs/`, `output_master_data/`, `config.json`), so you can mix the GUI and the scripts.
- The data lives in the Dropbox app folder `Dropbox\Apps\ErikLifeApp\`, so a **tablet or phone** can use it too: there the app signs in with Dropbox (`docs/shared/js/dropbox.js`, Dropbox app "ErikLifeApp", app-folder access only) and reads and writes the same files through Dropbox. On the PC, `inputs/`, `output_master_data/` and `reports/` in this repo are links (junctions) into that folder and `config.json` is found next to them, so the scripts work as before.
- AI calls go straight from the browser to your local Ollama. Allow the page's origin once, then restart Ollama:
  `setx OLLAMA_ORIGINS "https://erikfol.github.io"`
- Pages: **Setup** (add bank CSVs, optional AI for new merchants, close the month), **This Month** (projection), **Income** (expected monthly take-home, and every paycheck from the bank data charted, with your notes on why it changed in `inputs/income/pay_notes.csv`), **Bills** (scheduled bills in `config.json` `scheduled_bills`: paid / due / late each month, 12-month grid, suggestions from history; transactions matching a bill's merchant count as scheduled, everything else as unscheduled), **Dashboard** (history report and AI analysis), **Finance Table** (fix the processed month or the master), **Config** (tabs: Categories, with the variable categories This Month projects on top; Merchants — one table of merchant rules and the names that still need one).

Run locally (above), Ollama needs no setup: it allows localhost by default.

Merchant names and forced categories come only from `merchant_rules` in `config.json` (edit them on Config → Merchants); the GUI and the scripts apply them the same way. The rules that used to be hardcoded were moved there by `tools/migrate_rules.py`.

## Workflow (the Python scripts)

Requirements: Python 3 with `pandas`, and [Ollama](https://ollama.com) running locally with a pulled model matching
`MODEL_NAME` in the scripts (currently `qwen2.5:3b`; run `ollama pull qwen2.5:3b` once).

### End of month — add a full month of history

1. Export the month's data from CitizensBank.com to CSV and move it to `inputs/past_months/`.
2. Run `python 1_backfill_prev_months_to_master.py`
   - Reuses the category from your history for merchants you've seen before, asks the local AI only about new merchants, applies hardcoded override rules, saves to `output_master_data/all_time_finances.csv`.
   - Skips transactions already in the master (dedupe on date + description + amount), and drops sensitive columns (account numbers, balance, etc.).
3. Fix any mis-categorized rows directly in the master.
4. Run `python 2_process_master_data_plus_report.py` to view the data —
   writes a styled HTML report (cash flow, category breakdowns, trends, transaction tabs, AI analysis) to `reports/<latest_month>_report.html` and opens it.

### Mid-month — how are we doing?

1. Export the current month's data to CSV and move it to `inputs/current_month/` (exactly one file).
2. Run `python 3_process_current_month.py --ai` to categorize any new transactions with AI (results are cached).
3. Open `output_master_data/processed_current_month.csv` and fix any categories by hand.
4. Run `python 3_process_current_month.py` again (no `--ai`) to regenerate the projection:
   - Expected income vs. fixed expenses (from `config.json`).
   - Variable categories projected to the full month by scaling current pace: `(spent / days_elapsed) * days_in_month`.
   - Comparison against historical averages from the master.
   - Writes `reports/<YYYY_MM>_projection.html` and opens it.

### Close the month

1. After confirming the processed data, run `python 4_close_month.py`.
   - Appends new transactions to the master, archives the raw bank CSV to `inputs/past_months/<YYYY_MM>_closed.csv`, archives the processed file, and clears `inputs/current_month/`.

## Configuration — `config.json`

| Key | Purpose |
|---|---|
| `monthly_income_*` | Expected monthly take-home pay; summed by script 3. Kept in step with `income_sources` (`{name, per_pay, every}`: each source's take-home per paycheck and how often it comes), which the GUI's Income page edits |
| `fixed_expenses` | Bills that hit every month (~same amount) |
| `variable_categories` | Categories that are day-scaled to project the full month |
| `categories` | Your category list (optional; defaults to the built-in 12). Managed on the GUI's Config page |
| `category_renames` | Old → new names, so the built-in rules and older data follow a rename (managed by the GUI) |
| `merchant_rules` | `{name?, bank_text: [...], match: [...], category?}`: when the bank text contains one of `bank_text` (letters only) or the merchant is one of `match`, use this name and/or category. The only place merchant names and forced categories come from, in the GUI and the scripts (`bills_config.py`). Managed on Config → Merchants |

Keys starting with `_` are ignored. See the notes in the file itself.

## Data and folders

| Path | Contents |
|---|---|
| `inputs/past_months/` | Bank CSVs for history to backfill |
| `inputs/current_month/` | Bank CSV for the current month (one file) |
| `output_master_data/all_time_finances.csv` | Master history of all transactions |
| `output_master_data/processed_current_month.csv` | Current month's categorized rows (edit here) |
| `output_master_data/categorized_cache.csv` | AI categorization cache for the current month |
| `reports/` | Generated HTML reports |

## Categories

`Groceries, Dining Out, Utilities, Rent/Mortgage, Entertainment, Shopping, Transport, Gas, Income, Savings, Credit Card, Miscellaneous`

Categorization order: manual edits in the processed file → **your history** → cache → AI (with `--ai`) → override/keyword rules.

**History-first:** a transaction whose merchant (first three words of the description, letters only, so store numbers are ignored) already appears in the master gets that merchant's most common category, as long as that category is a strict majority. That covers roughly 80% of transactions, so the AI only sees new merchants. Fixing a category in the master teaches the lookup. The logic is in `history_lookup.py` and `docs/bills-etc/js/history.js`; keep them in sync. For a merchant the AI keeps getting wrong, add a merchant rule with a category (Config → Merchants).

## Notes

- Requires Citizens Bank CSV columns; adjust `DESCRIPTION_COL` / `AMOUNT_COL` in script 1 if your bank's export differs.
- Sensitive columns are stripped automatically on import.