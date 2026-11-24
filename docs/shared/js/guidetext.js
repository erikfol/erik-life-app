// How-to text typed as plain lines, shown formatted: Vehicles' Guides, House's Future improvements and Projects.
import { esc } from './util.js';

/**
 * Guide text → HTML: '1. …' lines become numbered steps, '- …' lines bullets, '[ ] …' / '[x] …' checklist items,
 * '## …' small headings, blank lines spacing.
 */
export function textHtml(text) {
    return text.split('\n').map(line => {
        const t = line.trim();
        if (!t) return '<div class="g-gap"></div>';
        const head = /^#{1,3}\s+(.*)$/.exec(t);
        if (head) return `<h4 class="g-head">${esc(head[1])}</h4>`;
        const check = /^\[([ xX])\]\s*(.*)$/.exec(t);
        if (check) return `<div class="g-step${check[1] === ' ' ? '' : ' g-done'}"><span class="g-num">${check[1] === ' ' ? '☐' : '☑'}</span><span>${esc(check[2])}</span></div>`;
        const step = /^(\d+[.)])\s+(.*)$/.exec(t);
        if (step) return `<div class="g-step"><span class="g-num">${esc(step[1])}</span><span>${esc(step[2])}</span></div>`;
        const bullet = /^[-•*]\s+(.*)$/.exec(t);
        if (bullet) return `<div class="g-step"><span class="g-num">•</span><span>${esc(bullet[1])}</span></div>`;
        return `<p>${esc(t)}</p>`;
    }).join('');
}
