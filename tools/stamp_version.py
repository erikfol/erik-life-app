"""Stamp each section's index.html (every docs/<section>/ with a js/app.js) and the Home page (docs/index.html) with a
new version and the list of its files.

GitHub Pages lets browsers cache files for up to 10 minutes, so right after an update a browser can get the new
index.html but old JavaScript. index.html compares this version with the one the browser last ran; when it changed,
it re-downloads every file listed here (bypassing the cache) before starting the app.

The list is worked out, not kept by hand: every module the page's script imports (directly or not, including
import('…') with a fixed path) and every stylesheet its index.html links. A new section, or a file moved to
docs/shared/, needs no change here.

Run before committing changes to docs/:  python tools/stamp_version.py
"""
from datetime import datetime, timezone
from pathlib import Path
import json
import posixpath
import re

DOCS = Path(__file__).resolve().parent.parent / 'docs'
# The browser remembers the version it last ran under '<section>-version' (Bills Etc kept its older name).
KEYS = {'bills-etc': 'billsetc-version'}

# `import … from './x.js'`, `import './x.js'`, `export … from './x.js'` and `import('./x.js')`
IMPORT = re.compile(r"""(?:\bfrom\s*|\bimport\s*\(?\s*)['"](\.{1,2}/[^'"]+\.js)['"]""")
STYLESHEET = re.compile(r'<link rel="stylesheet" href="([^"?]+)"')


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
    return seen


def page_files(page_dir, entry):
    """What the page in docs/<page_dir>/ loads: its modules from `entry` and its stylesheets, relative to the page.
    The page's own files first, then the shared ones, each sorted."""
    html = (DOCS / page_dir / 'index.html').read_text(encoding='utf-8')
    styles = {posixpath.normpath(posixpath.join(page_dir, h)) for h in STYLESHEET.findall(html)}
    files = [posixpath.relpath(f, page_dir or '.') for f in module_graph(entry) | styles]
    return sorted(files, key=lambda f: (f.startswith('../'), f))


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
for app_dir in sorted(p.parent.parent for p in DOCS.glob('*/js/app.js')):
    app = app_dir.name
    files = page_files(app, f'{app}/js/app.js')
    stamp(app_dir / 'index.html', version_block(KEYS.get(app, f'{app}-version'), files, './js/app.js'))
    print(f'{app}: version {version}, {len(files)} files')

# The Home page: its script and every module it brings in (each section's alerts.js and what those use).
home_files = page_files('', 'shared/js/home.js')
stamp(DOCS / 'index.html', version_block('home-version', home_files, './shared/js/home.js'))
print(f'home: version {version}, {len(home_files)} files')
