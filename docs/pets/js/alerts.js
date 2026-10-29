// Pets' red and yellow banners, for the Home page's counts and the menu colours: a pet with no future appointment
// (red) or one in the next two weeks (yellow), as the appointment banner on its page (appointmentStatus).
import { loadPets, loadAppointments, appointmentStatus } from './pets.js';

const inDays = n => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`);

/** [{ level: 'red' | 'yellow', text, href }] (href: the pet's page) */
export default async function alerts() {
    const pets = await loadPets(false);
    const status = await Promise.all(pets.map(p => loadAppointments(p, false).then(r => appointmentStatus(r))));
    return pets.flatMap((p, i) => (status[i].level === 'none' ? [{ level: 'red', text: `${p.name}: no future appointment`, href: `#${p.id}` }]
        : status[i].level === 'soon' ? [{ level: 'yellow', text: `${p.name}: appointment ${inDays(status[i].days)}`, href: `#${p.id}` }] : []));
}
