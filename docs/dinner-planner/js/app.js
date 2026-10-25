// Dinner Planner: empty for now (one page); its data will live in inputs/dinner-planner/.
// Uses the same folder as Bills Etc (the browser remembers it for the whole site).
import * as fs from '../../bills-etc/js/fs.js';
import { refreshStatus, askForFolder } from '../../shared/js/folder.js';

export const DINNER_DIR = 'inputs/dinner-planner';

const viewEl = document.getElementById('view');

function render() {
    if (!fs.folder()) return askForFolder(viewEl, { what: 'Dinner plans', where: `${DINNER_DIR}/`, onConnected: render });
    viewEl.innerHTML = `
        <h1 class="page">Dinner Planner</h1>
        <p class="lead">Nothing here yet. What it holds will be saved in <code>${DINNER_DIR}/</code>.</p>`;
}

(async () => {
    if (fs.isSupported()) await fs.rememberedFolder().catch(() => null);
    refreshStatus();
    render();
})();
