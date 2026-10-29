"""Stamp each app's index.html (docs/bills-etc/, docs/health/, docs/vehicles/, docs/house/, docs/pets/, docs/insurance/, docs/dinner-planner/, docs/kid-lunches/, docs/career/, docs/gifts/) and the Home page (docs/index.html) with a new version and the list of its files.

GitHub Pages lets browsers cache files for up to 10 minutes, so right after an update a browser can get the new
index.html but old JavaScript. index.html compares this version with the one the browser last ran; when it changed,
it re-downloads every file listed here (bypassing the cache) before starting the app.

Run before committing changes to docs/:  python tools/stamp_version.py
"""
from datetime import datetime, timezone
from pathlib import Path
import json
import posixpath
import re

DOCS = Path(__file__).resolve().parent.parent / 'docs'
# app folder → (localStorage key, files from other apps it imports, relative to docs/)
SHARED = ['bills-etc/css/app.css', 'bills-etc/js/csv.js', 'bills-etc/js/datatable.js', 'bills-etc/js/dates.js',
          'bills-etc/js/filtermenu.js', 'bills-etc/js/fs.js', 'bills-etc/js/util.js', 'shared/css/records.css',
          'shared/js/dropbox.js', 'shared/js/fileguard.js', 'shared/js/folder.js', 'shared/js/infobox.js',
          'shared/js/phonecopy.js', 'shared/js/recordtable.js',
          'health/js/records.js', 'vehicles/js/vehicles.js', 'house/js/house.js', 'pets/js/pets.js',
          'dinner-planner/js/store.js', 'kid-lunches/js/store.js', 'kid-lunches/js/school.js']  # the phone copy reads every app's data
# A section without the 📱 phone copy: the Home sections' table and information box.
BASIC = ['bills-etc/css/app.css', 'bills-etc/js/csv.js', 'bills-etc/js/datatable.js', 'bills-etc/js/dates.js',
         'bills-etc/js/filtermenu.js', 'bills-etc/js/fs.js', 'bills-etc/js/util.js', 'shared/css/records.css',
         'shared/js/dropbox.js', 'shared/js/fileguard.js', 'shared/js/folder.js', 'shared/js/infobox.js', 'shared/js/recordtable.js',
         'vehicles/css/vehicles.css']
APPS = {
    'bills-etc': ('billsetc-version', ['shared/css/records.css', 'shared/js/dropbox.js', 'shared/js/fileguard.js',
                                       'shared/js/infobox.js', 'shared/js/recordtable.js']),  # Forgettable Subs uses the Home sections' table; fs.js uses Dropbox
    'health': ('health-version', SHARED + ['vehicles/css/vehicles.css']),  # the General information box's styles
    'vehicles': ('vehicles-version', SHARED),
    'house': ('house-version', SHARED + ['vehicles/css/vehicles.css', 'vehicles/js/views/gallery.js',
                                         'vehicles/js/views/places.js', 'vehicles/js/views/guides.js']),  # Vehicles' views (+ guide text formatting)
    'insurance': ('insurance-version', SHARED + ['vehicles/css/vehicles.css', 'vehicles/js/views/gallery.js',
                                                 'vehicles/js/views/places.js']),  # Vehicles' views
    'pets': ('pets-version', SHARED + ['vehicles/css/vehicles.css', 'vehicles/js/views/gallery.js']),  # borrows Vehicles' info box + photos
    'dinner-planner': ('dinner-planner-version', SHARED),  # its own page + the 📱 phone copy; catalog.json/seed.json are fetched no-cache
    'kid-lunches': ('kid-lunches-version', SHARED + ['dinner-planner/css/dinner.css']),  # the Dinner Planner's calendar look
    'career': ('career-version', BASIC),
    'gifts': ('gifts-version', BASIC),
}


def own_files(app_dir):
    return sorted(p.relative_to(app_dir).as_posix() for p in list(app_dir.glob('js/**/*.js')) + list(app_dir.glob('css/*.css')))


# `import … from './x.js'`, `import './x.js'`, `export … from './x.js'` and `import('./x.js')`
IMPORT = re.compile(r"""(?:\bfrom\s*|\bimport\s*\(?\s*)['"](\.{1,2}/[^'"]+\.js)['"]""")


def module_graph(entry):
    """`entry` (relative to docs/) and every module it imports, directly or not, relative to docs/."""
    seen, todo = set(), [entry]
    while todo:
        f = todo.pop()
        if f in seen or not (DOCS / f).is_file():
            continue
        seen.add(f)
        for m in IMPORT.finditer((DOCS / f).read_text(encoding='utf-8')):
            todo.append(posixpath.normpath(posixpath.join(posixpath.dirname(f), m.group(1))))
    return sorted(seen)


def version_block(key, files, entry):
    return (
        '<!-- app-version:start (written by tools/stamp_version.py) -->\n'
        '    <script type="module">\n'
        f'        const VERSION = {json.dumps(version)};\n'
        f'        const FILES = {json.dumps(files)};\n'
        '        // After an update, fetch every file fresh once so new pages never run with old cached code.\n'
        '        try {\n'
        f"            if (localStorage.getItem('{key}') !== VERSION) {{\n"
        "                await Promise.all(FILES.map(f => fetch(f, { cache: 'reload' }).catch(() => null)));\n"
        f"                localStorage.setItem('{key}', VERSION);\n"
        "                document.querySelectorAll('link[rel=stylesheet]').forEach(l => { l.href = l.getAttribute('href') + '?v=' + VERSION; });\n"
        '            }\n'
        '        } catch { /* storage blocked: just start */ }\n'
        f"        await import({json.dumps(entry)});\n"
        '    </script>\n'
        '    <!-- app-version:end -->'
    )


def stamp(index, block):
    html = index.read_text(encoding='utf-8')
    if '<!-- app-version:start' in html:
        html = re.sub(r'<!-- app-version:start.*?<!-- app-version:end -->', lambda m: block, html, flags=re.S)
    else:
        html = html.replace('<script type="module" src="js/app.js"></script>', block)
    index.write_text(html, encoding='utf-8', newline='\n')


version = datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')
for app, (key, shared) in APPS.items():
    app_dir = DOCS / app
    files = own_files(app_dir) + ['../' + f for f in shared]
    stamp(app_dir / 'index.html', version_block(key, files, './js/app.js'))
    print(f'{app}: version {version}, {len(files)} files')

# The Home page: its script and every module it brings in (each section's alerts.js and what those use).
home_files = module_graph('shared/js/home.js')
stamp(DOCS / 'index.html', version_block('home-version', home_files, './shared/js/home.js'))
print(f'home: version {version}, {len(home_files)} files')
