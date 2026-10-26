// Working Career data: everything in inputs/career/ of the connected folder (kept out of git like all of inputs/).
// The profile is a JSON file of label/value fields; every other page is one or more CSV tables (the shared record
// table's columns); tailored resumes are kept in resumes.json.
import * as fs from '../../bills-etc/js/fs.js';
import { parseCSV, toCSV } from '../../bills-etc/js/csv.js';
import { readTracked, writeTracked } from '../../shared/js/fileguard.js';

export const CAREER_DIR = 'inputs/career';
export const PROFILE_PATH = `${CAREER_DIR}/profile.json`;
export const RESUMES_PATH = `${CAREER_DIR}/resumes.json`;

// The profile fields it starts with (any can be renamed or removed).
const PROFILE_FIELDS = ['Name', 'Headline', 'Email', 'Phone', 'Location', 'LinkedIn', 'Website', 'Target Roles', 'Summary'];

// Column kinds are the shared record table's (shared/js/recordtable.js).
export const TABLES = {
    work: { file: 'work_history.csv', columns: [
        { name: 'Start', kind: 'date' },
        { name: 'End', kind: 'end' }, // blank = still there
        { name: 'Company', kind: 'suggest' },
        { name: 'Title', kind: 'suggest' },
        { name: 'Location', kind: 'suggest' },
        { name: 'Type', kind: 'suggest', suggestions: ['Full-time', 'Part-time', 'Contract', 'Internship', 'Volunteer'] },
        { name: 'Summary', kind: 'text' },
        { name: 'Accomplishments', kind: 'text' }, // one per line: the resume's bullets
        { name: 'Skills Used', kind: 'text' }, // comma-separated
        { name: 'Supervisor', kind: 'suggest' },
        { name: 'Starting Pay', kind: 'money', total: false },
        { name: 'Ending Pay', kind: 'money', total: false },
        { name: 'Reason for Leaving', kind: 'text' },
    ] },
    skills: { file: 'skills.csv', columns: [
        { name: 'Skill', kind: 'suggest' },
        { name: 'Category', kind: 'suggest', suggestions: ['Technical', 'Software & Tools', 'Leadership', 'Communication', 'Industry Knowledge', 'Language'] },
        { name: 'Level', kind: 'suggest', suggestions: ['Beginner', 'Intermediate', 'Advanced', 'Expert'] },
        { name: 'Years', kind: 'number' },
        { name: 'Last Used', kind: 'suggest' },
        { name: 'Notes', kind: 'text' },
    ] },
    education: { file: 'education.csv', columns: [
        { name: 'Start', kind: 'date' },
        { name: 'End', kind: 'end' },
        { name: 'School', kind: 'suggest' },
        { name: 'Degree', kind: 'suggest' },
        { name: 'Field of Study', kind: 'suggest' },
        { name: 'Location', kind: 'suggest' },
        { name: 'Notes', kind: 'text' },
    ] },
    certifications: { file: 'certifications.csv', columns: [
        { name: 'Date Earned', kind: 'date' },
        { name: 'Name', kind: 'suggest' },
        { name: 'Issuer', kind: 'suggest' },
        { name: 'Expires', kind: 'date' },
        { name: 'Credential ID', kind: 'suggest' },
        { name: 'Link', kind: 'link' },
        { name: 'Notes', kind: 'text' },
    ] },
    achievements: { file: 'achievements.csv', columns: [
        { name: 'Date', kind: 'date' },
        { name: 'Title', kind: 'suggest' },
        { name: 'Type', kind: 'suggest', suggestions: ['Award', 'Project', 'Recognition', 'Publication', 'Presentation', 'Patent', 'Volunteer'] },
        { name: 'Company', kind: 'suggest' },
        { name: 'Description', kind: 'text' },
        { name: 'Results', kind: 'text' },
        { name: 'Skills Used', kind: 'text' },
    ] },
    references: { file: 'references.csv', columns: [
        { name: 'Name', kind: 'suggest' },
        { name: 'Relationship', kind: 'suggest', suggestions: ['Manager', 'Coworker', 'Direct report', 'Client', 'Mentor', 'Teacher'] },
        { name: 'Company', kind: 'suggest' },
        { name: 'Title', kind: 'suggest' },
        { name: 'Phone', kind: 'suggest' },
        { name: 'Email', kind: 'suggest' },
        { name: 'Last Contacted', kind: 'date' },
        { name: 'Notes', kind: 'text' },
    ] },
    applications: { file: 'applications.csv', columns: [
        { name: 'Date Applied', kind: 'date' },
        { name: 'Company', kind: 'suggest' },
        { name: 'Position', kind: 'suggest' },
        { name: 'Link', kind: 'link' },
        { name: 'Status', kind: 'suggest', suggestions: ['Interested', 'Applied', 'Interviewing', 'Offer', 'Accepted', 'Rejected', 'Withdrawn'] },
        { name: 'Salary Range', kind: 'suggest' },
        { name: 'Contact', kind: 'suggest' },
        { name: 'Next Step', kind: 'text' },
        { name: 'Notes', kind: 'text' },
    ] },
};

// The pages in the top menu: the profile, pages of tables (each with a heading when there's more than one), and the
// resume builder.
export const PAGES = [
    { id: 'profile', label: 'Profile', lead: 'Your contact details and summary; the Resume Builder puts them at the top of a resume.' },
    { id: 'work', label: 'Work History', tables: [['work']],
        lead: 'One row per position (a promotion is a new row). Put each accomplishment on its own line — they become a resume\'s bullet points.' },
    { id: 'skills', label: 'Skills', tables: [['skills']], lead: 'Everything you\'re good at. Skills a job posting mentions are put first in a resume.' },
    { id: 'education', label: 'Education', tables: [['education', 'Education'], ['certifications', 'Certifications & training']] },
    { id: 'achievements', label: 'Achievements', tables: [['achievements']], lead: 'Awards, projects and other wins worth mentioning.' },
    { id: 'references', label: 'References', tables: [['references']] },
    { id: 'jobs', label: 'Job Search', tables: [['applications']], lead: 'Jobs you\'re interested in or have applied for.' },
    { id: 'resume', label: 'Resume Builder' },
];

export const tablePath = id => `${CAREER_DIR}/${TABLES[id].file}`;
const names = id => TABLES[id].columns.map(c => c.name);

/** A table's rows ([] when its file doesn't exist yet); columns the file lacks read as blank. */
export async function loadTable(id, track = true) {
    const text = track ? await readTracked(tablePath(id)) : await fs.readText(tablePath(id));
    if (text === null) return [];
    return parseCSV(text).rows.map(r => Object.fromEntries(names(id).map(c => [c, r[c] ?? ''])));
}

export const saveTable = (id, rows) => writeTracked(tablePath(id), toCSV(names(id), rows));

/** The profile's fields, [{ label, value }]; blank starting fields until it's first saved. */
export async function loadProfile(track = true) {
    const text = track ? await readTracked(PROFILE_PATH) : await fs.readText(PROFILE_PATH);
    const info = text === null ? null : JSON.parse(text).info;
    return Array.isArray(info) ? info : PROFILE_FIELDS.map(label => ({ label, value: '' }));
}

export const saveProfile = info => writeTracked(PROFILE_PATH, JSON.stringify({ info }, null, 2) + '\n');

/** Saved tailored resumes, newest first: [{ id, saved, position, company, posting, summary, picks, text }]. */
export async function loadResumes() {
    const text = await readTracked(RESUMES_PATH);
    const list = text === null ? [] : JSON.parse(text).resumes;
    return Array.isArray(list) ? list : [];
}

export const saveResumes = list => writeTracked(RESUMES_PATH, JSON.stringify({ resumes: list }, null, 2) + '\n');

/** Everything the resume builder works from. */
export async function loadAll() {
    const ids = ['work', 'skills', 'education', 'certifications', 'achievements'];
    const [profile, ...tables] = await Promise.all([loadProfile(false), ...ids.map(id => loadTable(id, false))]);
    return { profile, ...Object.fromEntries(ids.map((id, i) => [id, tables[i]])) };
}
