// The large view of images (a gallery's photos, an entry's invoices): one at a time, ‹ › or the arrow keys to move,
// Esc or a click outside to close. A PDF is shown in a frame instead of as an image.
let closeBox = null; // closes the one that's open

/** Close the large view if it's open (e.g. when leaving the page). */
export const closeLightbox = () => closeBox?.();

/**
 * Show items [{ name, url, pdf? }] from `start`. caption(name) → the image's alt text; onClose() runs when it's closed
 * (e.g. to release object URLs made for it).
 */
export function openLightbox(items, start = 0, { caption = name => name, onClose = null } = {}) {
    let i = start;
    const box = document.createElement('div');
    box.className = 'lightbox';
    box.innerHTML = `
        <button type="button" class="lb-close" aria-label="Close" title="Close (Esc)">✕</button>
        <button type="button" class="lb-prev" aria-label="Previous" title="Previous (←)"${items.length > 1 ? '' : ' hidden'}>‹</button>
        <figure><img alt=""><iframe title="" hidden></iframe><figcaption></figcaption></figure>
        <button type="button" class="lb-next" aria-label="Next" title="Next (→)"${items.length > 1 ? '' : ' hidden'}>›</button>`;
    const img = box.querySelector('img'), frame = box.querySelector('iframe'), cap = box.querySelector('figcaption');
    const show = () => {
        const it = items[i];
        img.hidden = !!it.pdf;
        frame.hidden = !it.pdf;
        if (it.pdf) { frame.src = it.url; frame.title = it.name; } else { img.src = it.url; img.alt = caption(it.name); }
        cap.textContent = `${i + 1} of ${items.length} · ${it.name}`;
    };
    const step = d => { i = (i + d + items.length) % items.length; show(); };
    const close = () => { box.remove(); document.removeEventListener('keydown', onKey); closeBox = null; onClose?.(); };
    const onKey = e => {
        if (e.key === 'Escape') close();
        else if (e.key === 'ArrowLeft') step(-1);
        else if (e.key === 'ArrowRight') step(1);
    };
    box.querySelector('.lb-close').onclick = close;
    box.querySelector('.lb-prev').onclick = () => step(-1);
    box.querySelector('.lb-next').onclick = () => step(1);
    box.addEventListener('click', e => { if (e.target === box) close(); }); // click outside the image
    document.addEventListener('keydown', onKey);
    closeBox?.();
    closeBox = close;
    document.body.appendChild(box);
    show();
}
