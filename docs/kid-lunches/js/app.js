// Kid Lunches: empty for now (one page); its data will live in inputs/kid-lunches/.
// Uses the same folder as Bills Etc (the browser remembers it for the whole site).
import * as fs from '../../bills-etc/js/fs.js';
import { refreshStatus, askForFolder } from '../../shared/js/folder.js';

export const LUNCHES_DIR = 'inputs/kid-lunches';

const viewEl = document.getElementById('view');

function render() {
    if (!fs.folder()) return askForFolder(viewEl, { what: 'Kid lunches', where: `${LUNCHES_DIR}/`, onConnected: render });
    viewEl.innerHTML = `
        <h1 class="page">Kid Lunches</h1>
        <p class="lead">Nothing here yet. What it holds will be saved in <code>${LUNCHES_DIR}/</code>.</p>`;
}

(async () => {
    if (fs.isSupported()) await fs.rememberedFolder().catch(() => null);
    refreshStatus();
    render();
})();
