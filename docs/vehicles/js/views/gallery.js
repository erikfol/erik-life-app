// Image galleries (a vehicle's Photos, a guide's images): the images in one folder, shown as thumbnails; click one
// to see it large. "＋ Add …" copies picked images into that folder (it never deletes; remove an image from the
// folder itself).
import * as fs from '../../../bills-etc/js/fs.js';
import { esc, toast } from '../../../bills-etc/js/util.js';
import { openLightbox, closeLightbox } from '../../../shared/js/lightbox.js';

const IMAGE = /\.(png|jpe?g|gif|webp|heic|bmp)$/i;
const open = new Map(); // gallery element → its object URLs, released when it re-draws or the page changes

const release = el => { open.get(el)?.forEach(u => URL.revokeObjectURL(u)); open.delete(el); };

/** Release every gallery's images (when leaving the page). */
export function releaseGalleries() {
    [...open.keys()].forEach(release);
    closeLightbox();
}

/** '03-engine-ford-logo.png' → 'engine ford logo'. */
const caption = name => name.replace(/\.[^.]+$/, '').replace(/^\d+[-_ ]*/, '').replace(/[-_]+/g, ' ');
const stem = n => n.replace(/\.[^.]+$/, '');

/** fn(item) for every item, `n` at a time; the results in the same order. */
async function inBatches(items, n, fn) {
    const out = [];
    for (let i = 0; i < items.length; i += n) out.push(...await Promise.all(items.slice(i, i + n).map(fn)));
    return out;
}

/** Image file names in `dir`, in order ('x.png' before 'x (2).png'). Missing folder → []. */
export async function listImages(dir) {
    return (await fs.listFiles(dir, '')).filter(n => IMAGE.test(n))
        .sort((a, b) => stem(a).localeCompare(stem(b), undefined, { numeric: true }));
}

/**
 * Draw the gallery for `dir` into `el`. noun: 'photo' / 'image'; onChange(count) after images are added;
 * compact: no hint line (just the Add button), for small places like a note.
 */
export async function renderGallery(el, dir, { noun = 'photo', onChange, compact = false } = {}) {
    release(el);
    const names = await listImages(dir);
    const images = [], urls = [];
    const files = await inBatches(names, 8, name => fs.readImage(`${dir}/${name}`)); // from Dropbox: 8 downloads at once
    files.forEach((file, i) => {
        if (!file) return;
        const url = URL.createObjectURL(file);
        urls.push(url);
        images.push({ name: names[i], url });
    });
    open.set(el, urls);
    const n = images.length, plural = c => `${c} ${noun}${c === 1 ? '' : 's'}`;
    el.innerHTML = `
        <div class="row table-tools">
            <button type="button" class="small" data-add-images>＋ Add ${noun}s</button>
            ${compact ? '' : `<span class="muted edit-hint">${n ? `${plural(n)} · click one to see it large.` : `No ${noun}s yet.`} Saved in <code>${esc(dir)}/</code>.</span>`}
            <input type="file" accept="image/*" multiple hidden>
        </div>
        ${n ? `<div class="photo-grid">${images.map((p, i) => `
            <button type="button" class="photo" data-i="${i}" title="${esc(p.name)}">
                <img src="${p.url}" alt="${esc(caption(p.name))}" loading="lazy">
                <span>${esc(caption(p.name))}</span>
            </button>`).join('')}</div>` : ''}`;

    el.querySelector('.photo-grid')?.addEventListener('click', e => {
        const b = e.target.closest('[data-i]');
        if (b) openLightbox(images, +b.dataset.i, { caption });
    });
    const picker = el.querySelector('input[type=file]');
    el.querySelector('[data-add-images]').onclick = () => picker.click();
    picker.onchange = async () => {
        const files = [...picker.files];
        if (!files.length) return;
        const taken = new Set(names.map(x => x.toLowerCase()));
        try {
            for (const f of files) {
                // Never overwrite: 'IMG_1.jpg' becomes 'IMG_1 (2).jpg' if the name is already used.
                let name = f.name;
                const dot = name.lastIndexOf('.');
                for (let k = 2; taken.has(name.toLowerCase()); k++) name = `${f.name.slice(0, dot)} (${k})${f.name.slice(dot)}`;
                taken.add(name.toLowerCase());
                await fs.writeText(`${dir}/${name}`, f);
            }
            toast(`Added ${plural(files.length)}`, 'ok');
            window.dispatchEvent(new Event('data-saved')); // the phone copy (shared/js/phonecopy.js) updates itself
        } catch (err) {
            toast(`Couldn't add ${noun}s: ${err.message}`, 'bad');
        }
        await renderGallery(el, dir, { noun, onChange, compact });
        onChange?.(taken.size);
    };
}
