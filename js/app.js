// ============================================================
// Step 2 CK Study Dashboard - Main Application (v2)
// ============================================================

const SHEET_ID = '1TzVTUL47aRgZ7zFe5sdqijWkAOfSIhK6g2I-vFOBwjA';
const sheetUrl = (name) => `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(name)}`;

let APPS_SCRIPT_URL = localStorage.getItem('appsScriptUrl') || '';


const COLORS = {
    blue: '#3b82f6', red: '#ef4444', yellow: '#f59e0b', green: '#22c55e',
    purple: '#a855f7', pink: '#ec4899', teal: '#14b8a6', orange: '#f97316',
    indigo: '#6366f1', cyan: '#06b6d4', lime: '#84cc16', rose: '#f43f5e',
    slate: '#64748b', amber: '#d97706', emerald: '#10b981', sky: '#0ea5e9',
};
const PALETTE = Object.values(COLORS);

const ERROR_COLORS = {
    'Knowledge Gap': COLORS.red,
    'Anchoring Bias': COLORS.yellow,
    'Premature Conclusion': COLORS.purple,
    "Didn't Recognize Presentation": COLORS.blue,
    'Mixed Up Dx': COLORS.pink,
    'Forgot Anki Card': COLORS.teal,
    'Dumb Mistake': COLORS.slate,
};

// Knowledge errors vs cognitive/reasoning errors
const KNOWLEDGE_ERRORS = ['Knowledge Gap', 'Mixed Up Dx', 'Forgot Anki Card'];
const COGNITIVE_ERRORS = ['Anchoring Bias', 'Premature Conclusion', "Didn't Recognize Presentation"];
const LOW_WEIGHT_ERRORS = ['Dumb Mistake'];

// Severity weights for priority scoring
const ERROR_WEIGHTS = {
    'Knowledge Gap': 3,
    'Mixed Up Dx': 2.5,
    'Forgot Anki Card': 2,
    "Didn't Recognize Presentation": 2,
    'Anchoring Bias': 1.5,
    'Premature Conclusion': 1.5,
    'Dumb Mistake': 0.5,
};

let rawData = [];
let uwTrackerData = [];
let ambTrackerData = [];
let charts = {};

// SRG cutoff: every UW Tracker row dated on or after this is SRG; before is IM.
// Used as a fallback when the row has no explicit Shelf tag. Edit this one
// constant if the SRG study block started on a different date.
const SRG_START_DATE_STR = '3/22/26';

function parseDateStr(s) {
    if (!s) return null;
    const trimmed = String(s).trim();
    if (!trimmed) return null;
    // Primary: US slash format (M/D/YY, M/D/YYYY, MM/DD/YY, MM/DD/YYYY)
    const slash = trimmed.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
    if (slash) {
        const month = parseInt(slash[1], 10);
        const day = parseInt(slash[2], 10);
        let year = slash[3] ? parseInt(slash[3], 10) : new Date().getFullYear();
        if (year < 100) year += 2000;
        return new Date(year, month - 1, day);
    }
    // Secondary: ISO format (YYYY-MM-DD) — what Sheets exports if cell is a Date type
    const iso = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) {
        return new Date(parseInt(iso[1], 10), parseInt(iso[2], 10) - 1, parseInt(iso[3], 10));
    }
    // Fallback: let Date parse it (handles "March 22, 2026", "22 Mar 2026", etc.)
    const d = new Date(trimmed);
    return isNaN(d.getTime()) ? null : d;
}

const SRG_START_DATE = parseDateStr(SRG_START_DATE_STR);

// ============================================================
// Data Fetching & Parsing
// ============================================================

function parseCSV(csv) {
    const lines = csv.split('\n');
    const rows = [];
    let currentRow = [];
    let inQuotes = false;
    let currentField = '';

    for (const line of lines) {
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
                    currentField += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                currentRow.push(currentField.trim());
                currentField = '';
            } else {
                currentField += char;
            }
        }
        if (!inQuotes) {
            currentRow.push(currentField.trim());
            currentField = '';
            rows.push(currentRow);
            currentRow = [];
        } else {
            currentField += '\n';
        }
    }
    if (currentRow.length > 0 || currentField) {
        currentRow.push(currentField.trim());
        rows.push(currentRow);
    }
    return rows;
}

const VALID_SHELVES = ['IM', 'FM', 'EM', 'PED', 'OB', 'AMB', 'SURG', 'SRG', 'PSYCH', 'NEU'];

function parseLLJ(csv, source) {
    const rows = parseCSV(csv);
    if (!rows.length) return [];
    const headerRow = rows[0] || [];
    // Validate header looks like an LLJ (not a tracker)
    const headerJoined = headerRow.join(' ').toLowerCase();
    if (headerJoined.includes('q completed') || headerJoined.includes('% correct') || headerJoined.includes('q/day')) {
        console.warn(`parseLLJ(${source}): got tracker data instead of LLJ, skipping`);
        return [];
    }
    // Map columns by header name (handles blank spacer columns, reordering, etc.)
    const colMap = {};
    headerRow.forEach((h, i) => {
        const lc = h.toLowerCase().trim();
        if (lc === 'shelf') colMap.shelf = i;
        else if (lc === 'system') colMap.system = i;
        else if (lc === 'category') colMap.category = i;
        else if (lc === 'topic') colMap.topic = i;
        else if (lc.includes('why') || lc.includes('miss')) colMap.errorType = i;
        else if (lc === 'notes') colMap.notes = i;
        else if (lc.includes('strategy')) colMap.strategy = i;
    });
    console.log(`parseLLJ(${source}): colMap=`, JSON.stringify(colMap), `header="${headerRow.join('","')}"`);
    const col = (row, key) => (row[colMap[key]] || '').trim();

    return rows.slice(1)
        .filter(row => {
            const shelf = col(row, 'shelf').toUpperCase();
            return shelf && VALID_SHELVES.includes(shelf) && col(row, 'system') && col(row, 'topic');
        })
        .map(row => ({
            shelf: col(row, 'shelf').toUpperCase(),
            system: normalizeSystem(col(row, 'system')),
            category: col(row, 'category'),
            topic: col(row, 'topic'),
            errorType: normalizeErrorType(col(row, 'errorType')),
            notes: col(row, 'notes'),
            strategy: col(row, 'strategy'),
            source,
        }));
}

function parseTracker(csv, name, applySrgDateRule) {
    const rows = parseCSV(csv);
    if (!rows.length) return [];
    const headerRow = rows[0] || [];
    const headerJoined = headerRow.join(' ').toLowerCase();
    if (!headerJoined.includes('date') && !headerJoined.includes('completed')) return [];

    // Header-based column mapping so columns can be reordered or include extras like Shelf.
    // Matching is permissive: substring matches handle "Shelf", "Shelf (UW)", "Block/Shelf", etc.
    const colMap = {};
    headerRow.forEach((h, i) => {
        const lc = (h || '').toLowerCase().trim();
        if (!lc) return;
        if (colMap.shelf === undefined && (lc === 'shelf' || lc.includes('shelf') || lc === 'block' || lc === 'subject')) colMap.shelf = i;
        else if (colMap.date === undefined && (lc === 'date' || lc.startsWith('date'))) colMap.date = i;
        else if (colMap.qCompleted === undefined && (lc.includes('completed') || lc === 'q' || lc === 'questions' || lc.includes('q done'))) colMap.qCompleted = i;
        else if (colMap.pctCorrect === undefined && (lc.includes('correct') || lc.includes('%') || lc.includes('score'))) colMap.pctCorrect = i;
        else if (colMap.qRemaining === undefined && lc.includes('remaining')) colMap.qRemaining = i;
    });
    // Fallback to positional columns if any required header missing
    if (colMap.date === undefined) colMap.date = 0;
    if (colMap.qCompleted === undefined) colMap.qCompleted = 1;
    if (colMap.pctCorrect === undefined) colMap.pctCorrect = 2;
    if (colMap.qRemaining === undefined) colMap.qRemaining = 3;

    const col = (row, key) => (row[colMap[key]] || '').trim();

    const parsed = rows.slice(1)
        .filter(row => {
            const dateVal = col(row, 'date');
            const qVal = col(row, 'qCompleted');
            return dateVal && /\d/.test(dateVal) && qVal && /^\d+$/.test(qVal);
        })
        .map(row => {
            const pctStr = col(row, 'pctCorrect').replace(/%/g, '').replace(/[—–-]/g, '').trim();
            const pct = pctStr && !isNaN(parseFloat(pctStr)) ? parseFloat(pctStr) : null;
            const dateStr = col(row, 'date');
            const parsedDate = parseDateStr(dateStr);
            const shelfFromCol = colMap.shelf !== undefined ? col(row, 'shelf').toUpperCase() : '';
            // SRG classification: explicit Shelf tag wins; otherwise fall back to date cutoff
            // (only for sources where the SRG date rule applies, e.g. UW Tracker).
            const isSrgByShelf = shelfFromCol && shelfFromCol.startsWith('SRG');
            const isSrgByDate = applySrgDateRule && SRG_START_DATE && parsedDate && parsedDate >= SRG_START_DATE;
            const isSrg = isSrgByShelf || (!shelfFromCol && isSrgByDate);
            return {
                date: dateStr,
                parsedDate,
                qCompleted: parseInt(col(row, 'qCompleted')) || 0,
                pctCorrect: pct,
                qRemaining: parseInt(col(row, 'qRemaining')) || 0,
                shelf: shelfFromCol,
                isSrg,
            };
        })
        .filter(r => r.qCompleted > 0);

    // Diagnostic logging — surfaces in the browser console so we can verify
    // SRG classification is happening as expected.
    const tag = name || 'Tracker';
    const srgCount = parsed.filter(r => r.isSrg).length;
    const unparsedDates = parsed.filter(r => !r.parsedDate).length;
    console.log(
        `parseTracker(${tag}): rows=${parsed.length} srg=${srgCount} im=${parsed.length - srgCount} unparsedDates=${unparsedDates} cutoff=${applySrgDateRule ? SRG_START_DATE_STR : 'n/a'}`
    );
    if (parsed.length > 0) {
        const fmt = r => ({ date: r.date, parsed: r.parsedDate ? r.parsedDate.toISOString().slice(0, 10) : null, isSrg: r.isSrg, q: r.qCompleted });
        console.log(`parseTracker(${tag}): first=${JSON.stringify(fmt(parsed[0]))}`);
        console.log(`parseTracker(${tag}): last=${JSON.stringify(fmt(parsed[parsed.length-1]))}`);
        // Print the first row that crosses the SRG boundary so we can verify the cutoff is firing
        if (applySrgDateRule) {
            const firstSrg = parsed.find(r => r.isSrg);
            const lastIm = [...parsed].reverse().find(r => !r.isSrg);
            console.log(`parseTracker(${tag}): first SRG row=${firstSrg ? JSON.stringify(fmt(firstSrg)) : 'NONE'}`);
            console.log(`parseTracker(${tag}): last IM row=${lastIm ? JSON.stringify(fmt(lastIm)) : 'NONE'}`);
        }
    }

    return parsed;
}

// Slice UW Tracker by SRG classification (explicit shelf tag OR date cutoff).
// IM bucket = everything that isn't SRG (preserves the historical UW-as-IM data).
function getUwImTrackerData() {
    return uwTrackerData.filter(d => !d.isSrg);
}
function getSrgTrackerData() {
    return uwTrackerData.filter(d => d.isSrg);
}

async function fetchSheetCSV(name) {
    // Try multiple URL formats for resilience
    const urls = [sheetUrl(name), sheetUrl(name.replace(/ /g, '+'))];
    for (const url of urls) {
        try {
            const resp = await fetch(url);
            if (resp.ok) return await resp.text();
        } catch (e) { /* try next */ }
    }
    return null;
}

async function fetchData() {
    try {
        // Fetch all 4 sheets in parallel
        const [uwLljCsv, ambLljCsv, uwTrackerCsv, ambTrackerCsv] = await Promise.all([
            fetchSheetCSV('UW LLJ'),
            fetchSheetCSV('Amb LLJ'),
            fetchSheetCSV('UW Tracker'),
            fetchSheetCSV('Amb Tracker'),
        ]);

        // Combine both LLJs into rawData
        const uwLlj = uwLljCsv ? parseLLJ(uwLljCsv, 'UW') : [];
        const ambLlj = ambLljCsv ? parseLLJ(ambLljCsv, 'Amb') : [];
        rawData = [...uwLlj, ...ambLlj];

        // Parse trackers separately
        uwTrackerData = uwTrackerCsv ? parseTracker(uwTrackerCsv, 'UW Tracker', true) : [];
        ambTrackerData = ambTrackerCsv ? parseTracker(ambTrackerCsv, 'Amb Tracker', false) : [];

        console.log(`Sheets fetched — UW LLJ: ${uwLljCsv ? 'yes' : 'no'}, Amb LLJ: ${ambLljCsv ? 'yes' : 'no'}, UW Tracker: ${uwTrackerCsv ? 'yes' : 'no'}, Amb Tracker: ${ambTrackerCsv ? 'yes' : 'no'}`);
        console.log(`LLJ loaded: ${uwLlj.length} UW + ${ambLlj.length} Amb = ${rawData.length} total`);
        console.log(`Trackers loaded: ${uwTrackerData.length} UW, ${ambTrackerData.length} Amb`);
        if (rawData.length > 0) console.log('Sample LLJ entry:', JSON.stringify(rawData[0]));

        document.getElementById('last-updated').textContent = new Date().toLocaleTimeString();
        return rawData;
    } catch (err) {
        console.error('Error fetching data:', err);
        document.getElementById('last-updated').textContent = 'Error';
        return [];
    }
}

// Canonical system names and keywords that identify them
const CANONICAL_SYSTEMS = [
    { name: 'Gastrointestinal & Nutrition', keys: ['gastrointestinal', 'gi', 'nutrition'] },
    { name: 'Renal & Electrolytes', keys: ['renal', 'urinary', 'electrolyte'] },
    { name: 'Rheumatology/Orthopedics & Sports', keys: ['rheumatol', 'orthoped', 'ortho', 'sports med'] },
    { name: 'Nervous System', keys: ['nervous', 'neurol'] },
    { name: 'Pulmonary & Critical Care', keys: ['pulmonary', 'critical care', 'pulmon'] },
    { name: 'Endocrine, Diabetes & Metabolism', keys: ['endocrin', 'diabetes', 'metabolism'] },
    { name: 'Cardiovascular', keys: ['cardiovascular', 'cardio'] },
    { name: 'Hematology & Oncology', keys: ['hematol', 'oncol'] },
    { name: 'Infectious Diseases', keys: ['infectious'] },
    { name: 'Allergy & Immunology', keys: ['allergy', 'immunol'] },
    { name: 'Dermatology', keys: ['dermatol'] },
    { name: 'ENT', keys: ['ear, nose', 'ent', 'throat'] },
    { name: 'Male Reproductive', keys: ['male repro'] },
    { name: 'Female Reproductive', keys: ['female repro', 'gynecol', 'breast'] },
    { name: 'Social Sciences', keys: ['social science', 'ethics/legal', 'ethics'] },
    { name: 'Poisoning & Environmental', keys: ['poison', 'environmental'] },
    { name: 'Miscellaneous', keys: ['miscellaneous', 'multisystem', 'general principle'] },
    { name: 'Pregnancy & Childbirth', keys: ['pregnan', 'childbirth', 'puerperium', 'obstetric'] },
    { name: 'Psychiatric/Behavioral & Substance Use', keys: ['psychiatr', 'behavioral', 'substance use'] },
    { name: 'Biostatistics & Epidemiology', keys: ['biostatistic', 'epidemiol'] },
    { name: 'Ophthalmology', keys: ['ophthalmol'] },
];

function normalizeSystem(system) {
    if (!system) return system;
    const lower = system.toLowerCase().replace(/[.…]+$/, '').trim();
    // Find the canonical name by keyword match
    for (const canon of CANONICAL_SYSTEMS) {
        if (canon.keys.some(k => lower.includes(k))) return canon.name;
    }
    return system;
}

function normalizeErrorType(error) {
    if (!error) return error;
    const lower = error.toLowerCase().trim();
    const map = {
        // Old types that map to Knowledge Gap
        'wrong algorithm': 'Knowledge Gap',
        'right map / wrong order': 'Knowledge Gap',
        // Old types that map to Didn't Recognize Presentation
        'hidden hook failure': "Didn't Recognize Presentation",
        'misunderstood vinnet': "Didn't Recognize Presentation",
        'misunderstood vignette': "Didn't Recognize Presentation",
        "didnt recognize presentation": "Didn't Recognize Presentation",
        "didn't recognize presentation": "Didn't Recognize Presentation",
        // Normalize casing
        'knowledge gap': 'Knowledge Gap',
        'mixed up dx': 'Mixed Up Dx',
        'anchor bias': 'Anchoring Bias',
        'anchoring bias': 'Anchoring Bias',
        'forgot anki card': 'Forgot Anki Card',
        'dumb mistake': 'Dumb Mistake',
        'premature conclusion': 'Premature Conclusion',
    };
    return map[lower] || error;
}

// ============================================================
// Utilities
// ============================================================

function countBy(arr, key) {
    const counts = {};
    arr.forEach(item => {
        const val = item[key] || 'Unknown';
        counts[val] = (counts[val] || 0) + 1;
    });
    return counts;
}

function sortedEntries(obj) {
    return Object.entries(obj).sort((a, b) => b[1] - a[1]);
}

function getErrorBadgeClass(errorType) {
    const map = {
        'Knowledge Gap': 'knowledge-gap', 'Anchoring Bias': 'anchoring-bias',
        'Premature Conclusion': 'premature-conclusion', "Didn't Recognize Presentation": 'hidden-hook',
        'Mixed Up Dx': 'wrong-algorithm', 'Forgot Anki Card': 'wrong-order',
        'Dumb Mistake': 'dumb-mistake',
    };
    return map[errorType] || '';
}

function destroyChart(name) {
    if (charts[name]) { charts[name].destroy(); delete charts[name]; }
}

function isKnowledgeError(type) { return KNOWLEDGE_ERRORS.includes(type); }
function isCognitiveError(type) { return COGNITIVE_ERRORS.includes(type); }

function calcPriorityScore(items) {
    return items.reduce((sum, d) => sum + (ERROR_WEIGHTS[d.errorType] || 1), 0);
}

function getRepeatTopics() {
    const topicCounts = {};
    rawData.forEach(d => {
        const key = d.topic.toLowerCase();
        if (!topicCounts[key]) {
            topicCounts[key] = { topic: d.topic, count: 0, shelves: new Set(), systems: new Set(), errors: new Set(), categories: new Set(), entries: [] };
        }
        topicCounts[key].count++;
        topicCounts[key].shelves.add(d.shelf);
        topicCounts[key].systems.add(d.system);
        topicCounts[key].errors.add(d.errorType);
        topicCounts[key].categories.add(d.category);
        topicCounts[key].entries.push(d);
    });
    return Object.values(topicCounts).filter(t => t.count >= 2).sort((a, b) => b.count - a.count);
}

const CHART_DEFAULTS = {
    textColor: '#94a3b8',
    gridColor: '#1e3048',
};

// Section display names for the content header
const SECTION_NAMES = {
    'study-today': 'What to Study Today',
    'im-tracker': 'QBank Progress',
    'overview': 'Overview',
    'pareto': 'Pareto Analysis',
    'error-analysis': 'Error Analysis',
    'systems': 'Systems Breakdown',
    'shelves': 'Shelf Performance',
    'repeat-topics': 'Topic Depth Reports',
    'trends': 'Trends & Insights',
    'entries': 'All Entries',
    'exam-review': 'Pre-Exam Review',
    'add-entry': 'Add New Entry',
};

// Track which sections have been rendered
const renderedSections = new Set();

// ============================================================
// Loading overlay
// ============================================================

function hideLoading() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.classList.add('hidden');
}

function showLoading() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.classList.remove('hidden');
}

// ============================================================
// Navigation
// ============================================================

function updateContentHeader(sectionId) {
    const headerTitle = document.getElementById('content-header-title');
    const headerMeta = document.getElementById('content-header-meta');
    if (headerTitle) headerTitle.textContent = SECTION_NAMES[sectionId] || '';
    if (headerMeta && rawData.length > 0) {
        headerMeta.textContent = `${rawData.length} total entries tracked`;
    }
}

document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const section = link.dataset.section;
        document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
        document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
        document.getElementById(section).classList.add('active');
        link.classList.add('active');
        updateContentHeader(section);
        // Lazy render: only render a section when first visited
        renderSection(section);
        // Scroll content to top
        document.querySelector('.content').scrollTo({ top: 0, behavior: 'smooth' });
    });
});

// Render a section only if it hasn't been rendered yet
function renderSection(sectionId) {
    if (!rawData.length || renderedSections.has(sectionId)) return;
    renderedSections.add(sectionId);

    switch (sectionId) {
        case 'study-today': renderStudyToday(); break;
        case 'im-tracker': renderIMTracker(); break;
        case 'overview': renderOverview(); break;
        case 'pareto': renderPareto(); break;
        case 'error-analysis': renderErrorAnalysis(); break;
        case 'systems': renderSystems(); break;
        case 'shelves': renderShelves(); break;
        case 'repeat-topics': renderRepeatTopics(); break;
        case 'trends': renderTrends(); break;
        case 'entries': populateFilters(); renderEntries(); break;
        case 'exam-review': populateReviewFilters(); renderExamReview(); break;
        case 'add-entry': break; // static form, nothing to render
    }
    // Generate data-driven conclusion for this section
    try {
        renderConclusion(sectionId);
    } catch (e) {
        console.error('Error rendering conclusion for', sectionId, e);
    }
}

// ============================================================
// 1. WHAT TO STUDY TODAY
// ============================================================

function renderStudyToday() {
    // Priority 1: Highest-impact system with knowledge gaps
    const systemScores = {};
    rawData.forEach(d => {
        if (!systemScores[d.system]) systemScores[d.system] = { items: [], knowledgeCount: 0, cognitiveCount: 0 };
        systemScores[d.system].items.push(d);
        if (isKnowledgeError(d.errorType)) systemScores[d.system].knowledgeCount++;
        if (isCognitiveError(d.errorType)) systemScores[d.system].cognitiveCount++;
    });

    const systemRanked = Object.entries(systemScores)
        .map(([system, data]) => ({
            system,
            score: calcPriorityScore(data.items),
            total: data.items.length,
            knowledgeCount: data.knowledgeCount,
            cognitiveCount: data.cognitiveCount,
            dominantError: sortedEntries(countBy(data.items, 'errorType'))[0],
            topCategory: sortedEntries(countBy(data.items, 'category'))[0],
        }))
        .sort((a, b) => b.score - a.score);

    // Priority 1: Top knowledge-gap system
    const topKG = systemRanked.find(s => s.knowledgeCount >= 3) || systemRanked[0];
    document.getElementById('today-p1-title').textContent = topKG.system;
    document.getElementById('today-p1-desc').textContent =
        `${topKG.knowledgeCount} knowledge gaps, ${topKG.total} total misses. Focus on: ${topKG.topCategory ? topKG.topCategory[0] : 'general review'}`;
    document.getElementById('today-p1-meta').textContent =
        `Priority Score: ${topKG.score.toFixed(0)} | Top Error: ${topKG.dominantError[0]}`;

    // Priority 2: Top cognitive error system
    const topCog = systemRanked.find(s => s.cognitiveCount >= 3 && s.system !== topKG.system) || systemRanked[1];
    document.getElementById('today-p2-title').textContent = topCog.system;
    document.getElementById('today-p2-desc').textContent =
        `${topCog.cognitiveCount} reasoning errors (anchoring, premature conclusions). Practice systematic question approach here.`;
    document.getElementById('today-p2-meta').textContent =
        `Priority Score: ${topCog.score.toFixed(0)} | ${topCog.total} total misses`;

    // Priority 3: Repeat topics
    const repeats = getRepeatTopics();
    document.getElementById('today-p3-title').textContent = `${repeats.length} Repeat Topics`;
    document.getElementById('today-p3-desc').textContent = repeats.length > 0
        ? `Review: ${repeats.slice(0, 4).map(t => t.topic).join(', ')}${repeats.length > 4 ? '...' : ''}`
        : 'No repeat topics found yet.';
    document.getElementById('today-p3-meta').textContent =
        repeats.length > 0 ? `These topics keep coming back — high-yield flashcard targets` : '';

    // Priority Score Table
    const maxScore = systemRanked[0]?.score || 1;
    document.getElementById('priority-tbody').innerHTML = systemRanked.map((s, i) => {
        const pct = (s.score / maxScore * 100).toFixed(0);
        const action = s.knowledgeCount > s.cognitiveCount
            ? '<span class="action-tag content-review">Content Review</span>'
            : s.cognitiveCount > s.knowledgeCount
                ? '<span class="action-tag technique">Technique Practice</span>'
                : '<span class="action-tag mixed">Mixed</span>';
        return `<tr>
            <td><strong>${i + 1}</strong></td>
            <td>${s.system}</td>
            <td>${s.total}</td>
            <td><div class="score-bar"><div class="score-bar-track"><div class="score-bar-fill" style="width:${pct}%;background:${pct > 66 ? COLORS.red : pct > 33 ? COLORS.yellow : COLORS.green}"></div></div><span class="score-bar-value">${s.score.toFixed(0)}</span></div></td>
            <td><span class="error-badge ${getErrorBadgeClass(s.dominantError[0])}">${s.dominantError[0]}</span></td>
            <td>${action}</td>
        </tr>`;
    }).join('');

    // Repeat topics quick table
    document.getElementById('repeat-quick-tbody').innerHTML = repeats.slice(0, 8).map(t => `
        <tr>
            <td><strong>${t.topic}</strong></td>
            <td><strong>${t.count}</strong></td>
            <td>${[...t.systems].join(', ')}</td>
            <td>${[...t.errors].map(e => `<span class="error-badge ${getErrorBadgeClass(e)}">${e}</span>`).join(' ')}</td>
        </tr>
    `).join('') || '<tr><td colspan="4" style="text-align:center;color:#64748b;">No repeat topics yet</td></tr>';
}

// ============================================================
// IM PROGRESS TRACKER
// ============================================================

function renderIMTracker() {
    // Destroy previous tracker charts so they re-render fresh
    ['uwScore', 'uwQPerDay', 'uwCumulative', 'uwScatter',
     'srgScore', 'srgQPerDay', 'srgCumulative', 'srgScatter',
     'ambScore', 'ambQPerDay', 'ambCumulative', 'ambScatter',
     'compareScore', 'compareError'].forEach(destroyChart);

    // Set up sub-tab switching (idempotent — clones the node to drop any prior listeners)
    document.querySelectorAll('.qbank-tab').forEach(tab => {
        const fresh = tab.cloneNode(true);
        tab.parentNode.replaceChild(fresh, tab);
    });
    document.querySelectorAll('.qbank-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.qbank-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.qbank-panel').forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById('qbank-' + tab.dataset.qbank).classList.add('active');
            // Render the sub-panel charts on first view
            if (tab.dataset.qbank === 'uw' && !charts.uwScore) renderTrackerPanel(getUwImTrackerData(), 'uw', COLORS.blue);
            if (tab.dataset.qbank === 'srg' && !charts.srgScore) renderTrackerPanel(getSrgTrackerData(), 'srg', COLORS.orange);
            if (tab.dataset.qbank === 'amb' && !charts.ambScore) renderTrackerPanel(ambTrackerData, 'amb', COLORS.teal);
            if (tab.dataset.qbank === 'compare' && !charts.compareScore) renderComparison();
        });
    });

    // Render the active panel by default (SRG if it exists since that's the active study block, else UW IM)
    const srgData = getSrgTrackerData();
    if (srgData.length > 0) {
        // Default to SRG since it's the active block
        document.querySelectorAll('.qbank-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.qbank-panel').forEach(p => p.classList.remove('active'));
        const srgTab = document.querySelector('.qbank-tab[data-qbank="srg"]');
        const srgPanel = document.getElementById('qbank-srg');
        if (srgTab && srgPanel) {
            srgTab.classList.add('active');
            srgPanel.classList.add('active');
        }
        renderTrackerPanel(srgData, 'srg', COLORS.orange);
    } else {
        renderTrackerPanel(getUwImTrackerData(), 'uw', COLORS.blue);
    }
}

function bucketByQuestions(data, bucketSize) {
    const buckets = [];
    let remaining = 0;       // weighted correct sum carried into current bucket
    let filled = 0;          // questions accumulated in current bucket
    let startDate = data[0]?.date;

    for (const day of data) {
        if (day.pctCorrect === null || day.qCompleted <= 0) continue;
        let dayLeft = day.qCompleted;
        const dayRate = day.pctCorrect;

        while (dayLeft > 0) {
            const space = bucketSize - filled;
            const take = Math.min(dayLeft, space);
            remaining += take * dayRate;
            filled += take;
            dayLeft -= take;

            if (filled >= bucketSize) {
                const label = startDate === day.date ? day.date : `${startDate}–${day.date}`;
                buckets.push({ label, score: remaining / filled, qCount: filled });
                remaining = 0;
                filled = 0;
                startDate = dayLeft > 0 ? day.date : null;
            }
        }
        if (filled > 0 && !startDate) startDate = day.date;
        if (filled === 0) startDate = null;
    }
    // Final partial bucket
    if (filled > 0) {
        const lastDate = data[data.length - 1].date;
        const label = startDate === lastDate ? lastDate : `${startDate}–${lastDate}`;
        buckets.push({ label, score: remaining / filled, qCount: filled });
    }
    return buckets;
}

const SCORE_BUCKET_SIZE = 40;

function renderTrackerPanel(data, prefix, color) {
    if (!data.length) {
        document.getElementById(prefix + '-total-q').textContent = 'No data';
        return;
    }

    const labels = data.map(d => d.date);
    const scores = data.map(d => d.pctCorrect);
    const qPerDay = data.map(d => d.qCompleted);
    const remaining = data.map(d => d.qRemaining);

    let cumulative = 0;
    const cumulativeData = data.map(d => { cumulative += d.qCompleted; return cumulative; });

    // Volume-normalized buckets for score chart
    const buckets = bucketByQuestions(data, SCORE_BUCKET_SIZE);
    const bucketLabels = buckets.map(b => b.label);
    const bucketScores = buckets.map(b => b.score);
    const bucketRollingAvg = bucketScores.map((_, i) => {
        const w = bucketScores.slice(Math.max(0, i - 4), i + 1).filter(v => v !== null);
        return w.length > 0 ? (w.reduce((a, b) => a + b, 0) / w.length) : null;
    });

    const rollingAvg = scores.map((_, i) => {
        const w = scores.slice(Math.max(0, i - 6), i + 1).filter(v => v !== null);
        return w.length > 0 ? (w.reduce((a, b) => a + b, 0) / w.length) : null;
    });

    const totalQ = cumulativeData[cumulativeData.length - 1] || 0;
    const validScores = scores.filter(v => v !== null);
    const avgScore = validScores.length ? (validScores.reduce((a, b) => a + b, 0) / validScores.length).toFixed(1) : '--';
    const bestDay = Math.max(...qPerDay);
    const avgQPerDay = (totalQ / data.length).toFixed(1);
    const lastRemaining = data[data.length - 1]?.qRemaining ?? '--';
    const recentScores = validScores.slice(-7);
    const recentAvg = recentScores.length ? (recentScores.reduce((a, b) => a + b, 0) / recentScores.length).toFixed(1) : '--';
    const earlyScores = validScores.slice(0, 7);
    const earlyAvg = earlyScores.length ? (earlyScores.reduce((a, b) => a + b, 0) / earlyScores.length).toFixed(1) : '--';

    document.getElementById(prefix + '-total-q').textContent = totalQ;
    document.getElementById(prefix + '-avg-score').textContent = avgScore + '%';
    document.getElementById(prefix + '-avg-qday').textContent = avgQPerDay;
    document.getElementById(prefix + '-best-day').textContent = bestDay;
    document.getElementById(prefix + '-remaining').textContent = lastRemaining;
    document.getElementById(prefix + '-recent-avg').textContent = recentAvg + '%';
    document.getElementById(prefix + '-trend-dir').textContent =
        parseFloat(recentAvg) > parseFloat(earlyAvg) ? 'Improving' :
        parseFloat(recentAvg) < parseFloat(earlyAvg) ? 'Declining' : 'Stable';
    document.getElementById(prefix + '-trend-dir').style.color =
        parseFloat(recentAvg) > parseFloat(earlyAvg) ? COLORS.green :
        parseFloat(recentAvg) < parseFloat(earlyAvg) ? COLORS.red : COLORS.yellow;
    document.getElementById(prefix + '-early-avg').textContent = `First 7 days: ${earlyAvg}% → Last 7 days: ${recentAvg}%`;

    // Score over time (volume-normalized: 1 point per N questions)
    destroyChart(prefix + 'Score');
    charts[prefix + 'Score'] = new Chart(document.getElementById(prefix + '-score-chart'), {
        type: 'line',
        data: {
            labels: bucketLabels,
            datasets: [
                { label: `% Correct (per ${SCORE_BUCKET_SIZE}Q)`, data: bucketScores, borderColor: color, backgroundColor: color + '20', pointRadius: 4, pointBackgroundColor: color, borderWidth: 2, fill: true, spanGaps: true },
                { label: '5-Bucket Rolling Avg', data: bucketRollingAvg, borderColor: COLORS.yellow, borderWidth: 2, borderDash: [6, 3], pointRadius: 0, fill: false, spanGaps: true }
            ]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'bottom', labels: { color: CHART_DEFAULTS.textColor } },
                tooltip: { callbacks: {
                    label: ctx => {
                        const val = ctx.raw !== null ? ctx.raw.toFixed(1) + '%' : 'No data';
                        if (ctx.datasetIndex === 0) {
                            const b = buckets[ctx.dataIndex];
                            return `${ctx.dataset.label}: ${val} (${b.qCount}Q)`;
                        }
                        return `${ctx.dataset.label}: ${val}`;
                    }
                } }
            },
            scales: {
                x: { ticks: { color: CHART_DEFAULTS.textColor, maxRotation: 45, maxTicksLimit: 15 }, grid: { display: false } },
                y: { min: 30, max: 100, ticks: { color: CHART_DEFAULTS.textColor, callback: v => v + '%' }, grid: { color: CHART_DEFAULTS.gridColor } }
            }
        }
    });

    // Questions per day
    destroyChart(prefix + 'QPerDay');
    charts[prefix + 'QPerDay'] = new Chart(document.getElementById(prefix + '-qperday-chart'), {
        type: 'bar',
        data: { labels, datasets: [{ label: 'Questions Completed', data: qPerDay, backgroundColor: qPerDay.map(q => q >= 40 ? COLORS.green : q >= 20 ? color : COLORS.yellow), borderRadius: 3 }] },
        options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: CHART_DEFAULTS.textColor, maxRotation: 45, maxTicksLimit: 15 }, grid: { display: false } }, y: { ticks: { color: CHART_DEFAULTS.textColor }, grid: { color: CHART_DEFAULTS.gridColor } } } }
    });

    // Cumulative progress
    destroyChart(prefix + 'Cumulative');
    charts[prefix + 'Cumulative'] = new Chart(document.getElementById(prefix + '-cumulative-chart'), {
        type: 'line',
        data: { labels, datasets: [
            { label: 'Questions Completed (Cumulative)', data: cumulativeData, borderColor: COLORS.green, backgroundColor: COLORS.green + '15', borderWidth: 2, fill: true, pointRadius: 2 },
            { label: 'Questions Remaining', data: remaining, borderColor: COLORS.red, backgroundColor: COLORS.red + '10', borderWidth: 2, fill: true, pointRadius: 2 }
        ] },
        options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { color: CHART_DEFAULTS.textColor } } }, scales: { x: { ticks: { color: CHART_DEFAULTS.textColor, maxRotation: 45, maxTicksLimit: 15 }, grid: { display: false } }, y: { ticks: { color: CHART_DEFAULTS.textColor }, grid: { color: CHART_DEFAULTS.gridColor } } } }
    });

    // Score vs Volume scatter
    destroyChart(prefix + 'Scatter');
    charts[prefix + 'Scatter'] = new Chart(document.getElementById(prefix + '-scatter-chart'), {
        type: 'scatter',
        data: { datasets: [{ label: 'Score vs Volume', data: data.filter(d => d.pctCorrect !== null).map(d => ({ x: d.qCompleted, y: d.pctCorrect })), backgroundColor: color + '80', borderColor: color, pointRadius: 5 }] },
        options: { responsive: true, plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${ctx.raw.x} questions → ${ctx.raw.y}% correct` } } }, scales: { x: { title: { display: true, text: 'Questions/Day', color: CHART_DEFAULTS.textColor }, ticks: { color: CHART_DEFAULTS.textColor }, grid: { color: CHART_DEFAULTS.gridColor } }, y: { title: { display: true, text: '% Correct', color: CHART_DEFAULTS.textColor }, min: 30, max: 100, ticks: { color: CHART_DEFAULTS.textColor, callback: v => v + '%' }, grid: { color: CHART_DEFAULTS.gridColor } } } }
    });
}

function renderComparison() {
    const container = document.getElementById('compare-content');

    // Three tracker slices: UW IM (frozen), Amb (paused), SRG (active)
    const uwImTracker = getUwImTrackerData();
    const srgTracker = getSrgTrackerData();

    const uwValid = uwImTracker.map(d => d.pctCorrect).filter(v => v !== null);
    const ambValid = ambTrackerData.map(d => d.pctCorrect).filter(v => v !== null);
    const srgValid = srgTracker.map(d => d.pctCorrect).filter(v => v !== null);

    const uwAvg = uwValid.length ? (uwValid.reduce((a, b) => a + b, 0) / uwValid.length) : 0;
    const ambAvg = ambValid.length ? (ambValid.reduce((a, b) => a + b, 0) / ambValid.length) : 0;
    const srgAvg = srgValid.length ? (srgValid.reduce((a, b) => a + b, 0) / srgValid.length) : 0;

    const uwTotal = uwImTracker.reduce((s, d) => s + d.qCompleted, 0);
    const ambTotal = ambTrackerData.reduce((s, d) => s + d.qCompleted, 0);
    const srgTotal = srgTracker.reduce((s, d) => s + d.qCompleted, 0);

    // Build a hero card per source so the section gracefully degrades when one source has no data
    const heroCards = [
        { key: 'uw',  label: 'UW (IM) Average',  avg: uwAvg,  total: uwTotal,  days: uwImTracker.length, color: COLORS.blue,   hasData: uwValid.length > 0 },
        { key: 'srg', label: 'SRG Average',      avg: srgAvg, total: srgTotal, days: srgTracker.length,   color: COLORS.orange, hasData: srgValid.length > 0 },
        { key: 'amb', label: 'Amboss Average',   avg: ambAvg, total: ambTotal, days: ambTrackerData.length, color: COLORS.teal,  hasData: ambValid.length > 0 },
    ];

    // LLJ slices for the weak-area / error-type tables.
    // Note: SRG entries already live inside UW LLJ tagged shelf == 'SRG', so we
    // split the UW source into "UW non-SRG" + "SRG" to get a true 3-way LLJ view
    // without needing a separate SRG LLJ sheet.
    const uwLljNonSrg = rawData.filter(d => d.source === 'UW' && d.shelf !== 'SRG');
    const srgLlj     = rawData.filter(d => d.source === 'UW' && d.shelf === 'SRG');
    const ambLlj     = rawData.filter(d => d.source === 'Amb');

    const uwSystems  = countBy(uwLljNonSrg, 'system');
    const srgSystems = countBy(srgLlj, 'system');
    const ambSystems = countBy(ambLlj, 'system');

    // Union of system names that appear in any of the three sets, ordered by total misses
    const systemUnion = new Set([...Object.keys(uwSystems), ...Object.keys(srgSystems), ...Object.keys(ambSystems)]);
    const weakAreaComparison = [...systemUnion].map(sys => {
        const uwCount  = uwSystems[sys]  || 0;
        const srgCount = srgSystems[sys] || 0;
        const ambCount = ambSystems[sys] || 0;
        const uwRate   = uwLljNonSrg.length > 0 ? ((uwCount  / uwLljNonSrg.length) * 100) : 0;
        const srgRate  = srgLlj.length     > 0 ? ((srgCount / srgLlj.length)     * 100) : 0;
        const ambRate  = ambLlj.length     > 0 ? ((ambCount / ambLlj.length)     * 100) : 0;
        return { system: sys, uwCount, srgCount, ambCount, uwRate, srgRate, ambRate, total: uwCount + srgCount + ambCount };
    }).filter(s => s.total >= 2)
      .sort((a, b) => b.total - a.total);

    // Error type comparison across all three slices
    const uwErrors  = countBy(uwLljNonSrg, 'errorType');
    const srgErrors = countBy(srgLlj, 'errorType');
    const ambErrors = countBy(ambLlj, 'errorType');
    const errorUnion = new Set([...Object.keys(uwErrors), ...Object.keys(srgErrors), ...Object.keys(ambErrors)]);
    const errorComparison = [...errorUnion].map(err => ({
        error: err,
        uwPct:  uwLljNonSrg.length > 0 ? (uwErrors[err]  || 0) / uwLljNonSrg.length * 100 : 0,
        srgPct: srgLlj.length     > 0 ? (srgErrors[err] || 0) / srgLlj.length     * 100 : 0,
        ambPct: ambLlj.length     > 0 ? (ambErrors[err] || 0) / ambLlj.length     * 100 : 0,
        total:  (uwErrors[err] || 0) + (srgErrors[err] || 0) + (ambErrors[err] || 0),
    })).filter(e => e.total > 0)
      .sort((a, b) => b.total - a.total);

    // Verdict copy: rank the three averages
    const ranked = heroCards.filter(c => c.hasData).sort((a, b) => b.avg - a.avg);
    let verdict = '';
    if (ranked.length === 0) {
        verdict = 'No tracker data yet. Log some sessions to see comparison stats.';
    } else if (ranked.length === 1) {
        verdict = `Only <strong>${ranked[0].label}</strong> has data so far (<strong>${ranked[0].avg.toFixed(1)}%</strong>). Other sources will appear once you log sessions.`;
    } else {
        const top = ranked[0], bottom = ranked[ranked.length - 1];
        const spread = (top.avg - bottom.avg).toFixed(1);
        verdict = `<strong>${top.label}</strong> leads at <strong>${top.avg.toFixed(1)}%</strong>, with <strong>${bottom.label}</strong> at <strong>${bottom.avg.toFixed(1)}%</strong> — a <strong>${spread}-point spread</strong> across active study blocks.`;
    }

    container.innerHTML = `
        <!-- Overall Comparison Stats -->
        <div class="compare-hero">
            ${heroCards.map(c => `
                <div class="compare-hero-card">
                    <div class="compare-hero-label">${c.label}</div>
                    <div class="compare-hero-value" style="color:${c.color}">${c.hasData ? c.avg.toFixed(1) + '%' : '—'}</div>
                    <div class="compare-hero-sub">${c.hasData ? `${c.total} questions over ${c.days} days` : 'No data yet'}</div>
                </div>
            `).join('')}
        </div>

        <div class="compare-verdict verdict-improved">${verdict}</div>

        <!-- Score Rolling Average Overlay -->
        <div class="chart-container full-width" style="margin-bottom:24px;">
            <h3>Score Trajectory: UW (IM) vs SRG vs Amboss (per ${SCORE_BUCKET_SIZE} Questions)</h3>
            <canvas id="compare-score-chart"></canvas>
        </div>

        <!-- Weak Area Comparison (3-way LLJ split) -->
        ${weakAreaComparison.length > 0 ? `
        <h3 class="subsection-title">Weak Area Profile by Study Block</h3>
        <p class="section-subtitle">% of misses each system represents within UW (IM), SRG, and Amb. Lower % in a later block = you closed the gap.</p>
        <div class="table-wrapper" style="margin-bottom:24px;">
            <table>
                <thead>
                    <tr>
                        <th>System</th>
                        <th>UW (IM) Misses</th>
                        <th>UW (IM) %</th>
                        <th>SRG Misses</th>
                        <th>SRG %</th>
                        <th>Amb Misses</th>
                        <th>Amb %</th>
                    </tr>
                </thead>
                <tbody>
                    ${weakAreaComparison.map(s => `
                        <tr>
                            <td><strong>${s.system}</strong></td>
                            <td style="text-align:center">${s.uwCount}</td>
                            <td style="text-align:center;color:${s.uwRate >= 10 ? COLORS.red : 'inherit'}">${s.uwRate.toFixed(1)}%</td>
                            <td style="text-align:center">${s.srgCount}</td>
                            <td style="text-align:center;color:${s.srgRate >= 10 ? COLORS.red : 'inherit'}">${s.srgRate.toFixed(1)}%</td>
                            <td style="text-align:center">${s.ambCount}</td>
                            <td style="text-align:center;color:${s.ambRate >= 10 ? COLORS.red : 'inherit'}">${s.ambRate.toFixed(1)}%</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>` : '<p style="color:var(--text-muted);padding:20px;">Weak area comparison will appear once you have LLJ entries in at least one block.</p>'}

        <!-- Error Type Comparison -->
        ${errorComparison.length > 0 ? `
        <h3 class="subsection-title">Error Type Evolution Across Blocks</h3>
        <p class="section-subtitle">How your error pattern shifts from one study block to the next</p>
        <div class="chart-container full-width">
            <canvas id="compare-error-chart"></canvas>
        </div>` : ''}
    `;

    // 3-line score overlay (UW IM / SRG / Amb)
    const sources = [
        { key: 'uw',  label: 'UW (IM)', data: uwImTracker,    color: COLORS.blue,   valid: uwValid.length },
        { key: 'srg', label: 'SRG',     data: srgTracker,     color: COLORS.orange, valid: srgValid.length },
        { key: 'amb', label: 'Amboss',  data: ambTrackerData, color: COLORS.teal,   valid: ambValid.length },
    ];
    const anyData = sources.some(s => s.valid > 0);
    if (anyData) {
        const series = sources.map(s => {
            const buckets = bucketByQuestions(s.data, SCORE_BUCKET_SIZE);
            const scores = buckets.map(b => b.score);
            const rolling = scores.map((_, i) => {
                const w = scores.slice(Math.max(0, i - 4), i + 1).filter(v => v !== null);
                return w.length > 0 ? (w.reduce((a, b) => a + b, 0) / w.length) : null;
            });
            return { ...s, rolling };
        });
        const maxLen = Math.max(...series.map(s => s.rolling.length), 1);
        const xLabels = Array.from({ length: maxLen }, (_, i) => `Q${i * SCORE_BUCKET_SIZE + 1}–${(i + 1) * SCORE_BUCKET_SIZE}`);

        destroyChart('compareScore');
        charts.compareScore = new Chart(document.getElementById('compare-score-chart'), {
            type: 'line',
            data: {
                labels: xLabels,
                datasets: series.map(s => ({
                    label: `${s.label} (${SCORE_BUCKET_SIZE}Q Rolling Avg)`,
                    data: s.rolling,
                    borderColor: s.color,
                    borderWidth: 3,
                    pointRadius: 0,
                    fill: false,
                    spanGaps: true,
                }))
            },
            options: {
                responsive: true,
                plugins: { legend: { position: 'bottom', labels: { color: CHART_DEFAULTS.textColor } }, tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.raw !== null ? ctx.raw.toFixed(1) + '%' : '--'}` } } },
                scales: {
                    x: { ticks: { color: CHART_DEFAULTS.textColor, maxTicksLimit: 15 }, grid: { display: false } },
                    y: { min: 30, max: 100, ticks: { color: CHART_DEFAULTS.textColor, callback: v => v + '%' }, grid: { color: CHART_DEFAULTS.gridColor } }
                }
            }
        });
    }

    // 3-bar error type comparison
    if (errorComparison.length > 0 && document.getElementById('compare-error-chart')) {
        const errLabels = errorComparison.map(e => e.error);
        destroyChart('compareError');
        charts.compareError = new Chart(document.getElementById('compare-error-chart'), {
            type: 'bar',
            data: {
                labels: errLabels,
                datasets: [
                    { label: 'UW (IM) %', data: errorComparison.map(e => parseFloat(e.uwPct.toFixed(1))),  backgroundColor: COLORS.blue   + '90', borderRadius: 4 },
                    { label: 'SRG %',     data: errorComparison.map(e => parseFloat(e.srgPct.toFixed(1))), backgroundColor: COLORS.orange + '90', borderRadius: 4 },
                    { label: 'Amboss %',  data: errorComparison.map(e => parseFloat(e.ambPct.toFixed(1))), backgroundColor: COLORS.teal   + '90', borderRadius: 4 },
                ]
            },
            options: {
                responsive: true,
                plugins: { legend: { position: 'bottom', labels: { color: CHART_DEFAULTS.textColor } } },
                scales: {
                    x: { ticks: { color: CHART_DEFAULTS.textColor, font: { size: 10 } }, grid: { display: false } },
                    y: { ticks: { color: CHART_DEFAULTS.textColor, callback: v => v + '%' }, grid: { color: CHART_DEFAULTS.gridColor } }
                }
            }
        });
    }
}

function computeRollingAvg(scores, window) {
    return scores.map((_, i) => {
        const w = scores.slice(Math.max(0, i - window + 1), i + 1).filter(v => v !== null);
        return w.length > 0 ? (w.reduce((a, b) => a + b, 0) / w.length) : null;
    });
}

// ============================================================
// 2. OVERVIEW
// ============================================================

function renderOverview() {
    const total = rawData.length;
    const errorCounts = countBy(rawData, 'errorType');
    const shelfCounts = countBy(rawData, 'shelf');
    const systemCounts = countBy(rawData, 'system');

    // KPIs
    const knowledgeCount = rawData.filter(d => isKnowledgeError(d.errorType)).length;
    const cognitiveCount = rawData.filter(d => isCognitiveError(d.errorType)).length;
    const kgRatio = ((knowledgeCount / total) * 100).toFixed(0);
    const cogRate = ((cognitiveCount / total) * 100).toFixed(0);
    const repeats = getRepeatTopics();

    // Pareto threshold
    const sortedSystems = sortedEntries(systemCounts);
    let cumulative = 0;
    let paretoCount = 0;
    for (const [, count] of sortedSystems) {
        cumulative += count;
        paretoCount++;
        if (cumulative >= total * 0.8) break;
    }

    // Weakest shelf
    const shelfSorted = sortedEntries(shelfCounts);
    const weakestShelf = shelfSorted[0];
    const weakestShelfData = rawData.filter(d => d.shelf === weakestShelf[0]);
    const weakestShelfError = sortedEntries(countBy(weakestShelfData, 'errorType'))[0];

    document.getElementById('total-entries').textContent = total;
    document.getElementById('knowledge-gap-ratio').textContent = kgRatio + '%';
    document.getElementById('cognitive-error-rate').textContent = cogRate + '%';
    document.getElementById('repeat-topic-count').textContent = repeats.length;
    document.getElementById('pareto-threshold').textContent = `${paretoCount} of ${sortedSystems.length}`;
    document.getElementById('weakest-shelf-stat').textContent = `${weakestShelf[0]} (${weakestShelf[1]})`;
    document.getElementById('weakest-shelf-detail').textContent = `${((weakestShelfError[1] / weakestShelf[1]) * 100).toFixed(0)}% ${weakestShelfError[0]}`;

    // Knowledge vs Reasoning doughnut
    destroyChart('kvReasoning');
    charts.kvReasoning = new Chart(document.getElementById('knowledge-vs-reasoning-chart'), {
        type: 'doughnut',
        data: {
            labels: ['Knowledge Errors', 'Cognitive/Reasoning Errors', 'Other (Dumb Mistakes)'],
            datasets: [{
                data: [knowledgeCount, cognitiveCount, total - knowledgeCount - cognitiveCount],
                backgroundColor: [COLORS.red, COLORS.yellow, COLORS.slate],
                borderWidth: 0,
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'bottom', labels: { color: CHART_DEFAULTS.textColor, padding: 12 } },
                tooltip: {
                    callbacks: {
                        label: (ctx) => `${ctx.label}: ${ctx.raw} (${((ctx.raw / total) * 100).toFixed(1)}%)`
                    }
                }
            }
        }
    });

    // Shelf bar chart
    destroyChart('overviewShelf');
    charts.overviewShelf = new Chart(document.getElementById('overview-shelf-chart'), {
        type: 'bar',
        data: {
            labels: shelfSorted.map(e => e[0]),
            datasets: [{
                label: 'Missed Questions',
                data: shelfSorted.map(e => e[1]),
                backgroundColor: PALETTE.slice(0, shelfSorted.length),
                borderRadius: 6,
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { color: CHART_DEFAULTS.textColor }, grid: { display: false } },
                y: { ticks: { color: CHART_DEFAULTS.textColor }, grid: { color: CHART_DEFAULTS.gridColor } }
            }
        }
    });

    // Error type doughnut
    const sortedErrors = sortedEntries(errorCounts);
    destroyChart('overviewError');
    charts.overviewError = new Chart(document.getElementById('overview-error-chart'), {
        type: 'doughnut',
        data: {
            labels: sortedErrors.map(e => e[0]),
            datasets: [{
                data: sortedErrors.map(e => e[1]),
                backgroundColor: sortedErrors.map(e => ERROR_COLORS[e[0]] || COLORS.slate),
                borderWidth: 0,
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { position: 'right', labels: { color: CHART_DEFAULTS.textColor, font: { size: 11 } } } }
        }
    });

    // Knowledge vs Reasoning by Shelf (100% stacked)
    const shelves = shelfSorted.map(e => e[0]);
    destroyChart('kvReasoningShelf');
    charts.kvReasoningShelf = new Chart(document.getElementById('kv-reasoning-shelf-chart'), {
        type: 'bar',
        data: {
            labels: shelves,
            datasets: [
                {
                    label: 'Knowledge Errors',
                    data: shelves.map(s => rawData.filter(d => d.shelf === s && isKnowledgeError(d.errorType)).length),
                    backgroundColor: COLORS.red,
                    borderRadius: 2,
                },
                {
                    label: 'Cognitive Errors',
                    data: shelves.map(s => rawData.filter(d => d.shelf === s && isCognitiveError(d.errorType)).length),
                    backgroundColor: COLORS.yellow,
                    borderRadius: 2,
                },
                {
                    label: 'Other',
                    data: shelves.map(s => rawData.filter(d => d.shelf === s && !isKnowledgeError(d.errorType) && !isCognitiveError(d.errorType)).length),
                    backgroundColor: COLORS.slate,
                    borderRadius: 2,
                }
            ]
        },
        options: {
            responsive: true,
            plugins: { legend: { position: 'bottom', labels: { color: CHART_DEFAULTS.textColor } } },
            scales: {
                x: { stacked: true, ticks: { color: CHART_DEFAULTS.textColor }, grid: { display: false } },
                y: { stacked: true, ticks: { color: CHART_DEFAULTS.textColor }, grid: { color: CHART_DEFAULTS.gridColor } }
            }
        }
    });
}

// ============================================================
// 3. PARETO ANALYSIS
// ============================================================

function renderPareto() {
    const total = rawData.length;

    // System Pareto
    const systemCounts = sortedEntries(countBy(rawData, 'system'));
    let cumPct = 0;
    const systemCumulative = systemCounts.map(([, count]) => {
        cumPct += (count / total) * 100;
        return cumPct;
    });

    destroyChart('paretoSystem');
    charts.paretoSystem = new Chart(document.getElementById('pareto-system-chart'), {
        type: 'bar',
        data: {
            labels: systemCounts.map(e => e[0]),
            datasets: [
                {
                    label: 'Missed Questions',
                    data: systemCounts.map(e => e[1]),
                    backgroundColor: systemCumulative.map(c => c <= 80 ? COLORS.red : COLORS.slate + '60'),
                    borderRadius: 4,
                    order: 2,
                },
                {
                    label: 'Cumulative %',
                    data: systemCumulative,
                    type: 'line',
                    borderColor: COLORS.yellow,
                    backgroundColor: 'transparent',
                    pointBackgroundColor: COLORS.yellow,
                    pointRadius: 4,
                    borderWidth: 2,
                    yAxisID: 'y1',
                    order: 1,
                }
            ]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'bottom', labels: { color: CHART_DEFAULTS.textColor } },
                tooltip: {
                    callbacks: {
                        label: (ctx) => ctx.dataset.label === 'Cumulative %'
                            ? `Cumulative: ${ctx.raw.toFixed(1)}%`
                            : `${ctx.raw} misses`
                    }
                }
            },
            scales: {
                x: { ticks: { color: CHART_DEFAULTS.textColor, font: { size: 10 }, maxRotation: 45 }, grid: { display: false } },
                y: { ticks: { color: CHART_DEFAULTS.textColor }, grid: { color: CHART_DEFAULTS.gridColor }, title: { display: true, text: 'Count', color: CHART_DEFAULTS.textColor } },
                y1: {
                    position: 'right',
                    min: 0, max: 100,
                    ticks: { color: COLORS.yellow, callback: v => v + '%' },
                    grid: { display: false },
                    title: { display: true, text: 'Cumulative %', color: COLORS.yellow }
                }
            }
        }
    });

    // Category Pareto
    const catCounts = sortedEntries(countBy(rawData, 'category'));
    let catCumPct = 0;
    const catCumulative = catCounts.map(([, count]) => {
        catCumPct += (count / total) * 100;
        return catCumPct;
    });

    // Show top 25 categories
    const topN = 25;
    destroyChart('paretoCategory');
    charts.paretoCategory = new Chart(document.getElementById('pareto-category-chart'), {
        type: 'bar',
        data: {
            labels: catCounts.slice(0, topN).map(e => e[0]),
            datasets: [
                {
                    label: 'Missed Questions',
                    data: catCounts.slice(0, topN).map(e => e[1]),
                    backgroundColor: catCumulative.slice(0, topN).map(c => c <= 80 ? COLORS.blue : COLORS.slate + '60'),
                    borderRadius: 4,
                    order: 2,
                },
                {
                    label: 'Cumulative %',
                    data: catCumulative.slice(0, topN),
                    type: 'line',
                    borderColor: COLORS.yellow,
                    backgroundColor: 'transparent',
                    pointBackgroundColor: COLORS.yellow,
                    pointRadius: 3,
                    borderWidth: 2,
                    yAxisID: 'y1',
                    order: 1,
                }
            ]
        },
        options: {
            responsive: true,
            plugins: { legend: { position: 'bottom', labels: { color: CHART_DEFAULTS.textColor } } },
            scales: {
                x: { ticks: { color: CHART_DEFAULTS.textColor, font: { size: 9 }, maxRotation: 60 }, grid: { display: false } },
                y: { ticks: { color: CHART_DEFAULTS.textColor }, grid: { color: CHART_DEFAULTS.gridColor } },
                y1: { position: 'right', min: 0, max: 100, ticks: { color: COLORS.yellow, callback: v => v + '%' }, grid: { display: false } }
            }
        }
    });
}

// ============================================================
// 4. ERROR ANALYSIS
// ============================================================

function renderErrorAnalysis() {
    const errorCounts = countBy(rawData, 'errorType');
    const sortedErrors = sortedEntries(errorCounts);

    // Pie chart
    destroyChart('errorPie');
    charts.errorPie = new Chart(document.getElementById('error-pie-chart'), {
        type: 'pie',
        data: {
            labels: sortedErrors.map(e => e[0]),
            datasets: [{
                data: sortedErrors.map(e => e[1]),
                backgroundColor: sortedErrors.map(e => ERROR_COLORS[e[0]] || COLORS.slate),
                borderWidth: 0,
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { position: 'bottom', labels: { color: CHART_DEFAULTS.textColor, padding: 10, font: { size: 11 } } } }
        }
    });

    // 100% Stacked bar by shelf
    const shelves = [...new Set(rawData.map(d => d.shelf))].sort();
    const errorTypes = sortedErrors.map(e => e[0]);
    const datasets = errorTypes.map(errorType => ({
        label: errorType,
        data: shelves.map(shelf => {
            const shelfTotal = rawData.filter(d => d.shelf === shelf).length || 1;
            const count = rawData.filter(d => d.shelf === shelf && d.errorType === errorType).length;
            return ((count / shelfTotal) * 100).toFixed(1);
        }),
        backgroundColor: ERROR_COLORS[errorType] || COLORS.slate,
    }));

    destroyChart('errorByShelf');
    charts.errorByShelf = new Chart(document.getElementById('error-by-shelf-chart'), {
        type: 'bar',
        data: { labels: shelves, datasets },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'bottom', labels: { color: CHART_DEFAULTS.textColor, font: { size: 10 } } },
                tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.raw}%` } }
            },
            scales: {
                x: { stacked: true, ticks: { color: CHART_DEFAULTS.textColor }, grid: { display: false } },
                y: { stacked: true, max: 100, ticks: { color: CHART_DEFAULTS.textColor, callback: v => v + '%' }, grid: { color: CHART_DEFAULTS.gridColor } }
            }
        }
    });

    // HTML Heatmap
    renderHeatmap();

    // Insight cards
    const container = document.getElementById('error-insights');
    container.innerHTML = sortedErrors.map(([type, count]) => {
        const pct = ((count / rawData.length) * 100).toFixed(1);
        const topSystems = rawData.filter(d => d.errorType === type);
        const systemCounts = countBy(topSystems, 'system');
        const topSystem = sortedEntries(systemCounts)[0];
        const isKnowledge = isKnowledgeError(type);
        return `
            <div class="insight-card">
                <h4>${type} ${isKnowledge ? '<span class="action-tag content-review">Content</span>' : '<span class="action-tag technique">Technique</span>'}</h4>
                <p class="count">${count} <span style="font-size:0.8rem;color:#94a3b8">(${pct}%)</span></p>
                <p>Most common in: <strong>${topSystem ? topSystem[0] : 'N/A'}</strong> (${topSystem ? topSystem[1] : 0} times)</p>
            </div>
        `;
    }).join('');
}

function renderHeatmap() {
    const systemCounts = sortedEntries(countBy(rawData, 'system'));
    const systems = systemCounts.map(e => e[0]);
    const errorTypes = sortedEntries(countBy(rawData, 'errorType')).map(e => e[0]);

    // Build count matrix
    const matrix = {};
    let maxCount = 0;
    errorTypes.forEach(error => {
        matrix[error] = {};
        systems.forEach(system => {
            const count = rawData.filter(d => d.errorType === error && d.system === system).length;
            matrix[error][system] = count;
            if (count > maxCount) maxCount = count;
        });
    });

    const cols = systems.length + 1;
    let html = `<div class="heatmap-grid" style="grid-template-columns: 160px repeat(${systems.length}, 1fr);">`;

    // Header row
    html += `<div class="heatmap-cell heatmap-header"></div>`;
    systems.forEach(s => {
        html += `<div class="heatmap-cell heatmap-header">${s}</div>`;
    });

    // Data rows
    errorTypes.forEach(error => {
        html += `<div class="heatmap-cell heatmap-row-label">${error}</div>`;
        systems.forEach(system => {
            const count = matrix[error][system];
            const intensity = maxCount > 0 ? count / maxCount : 0;
            const bg = count === 0
                ? 'rgba(51, 65, 85, 0.3)'
                : `rgba(239, 68, 68, ${0.1 + intensity * 0.7})`;
            const textColor = intensity > 0.5 ? '#fff' : '#94a3b8';
            html += `<div class="heatmap-cell" style="background:${bg};color:${textColor}">${count || ''}</div>`;
        });
    });

    html += '</div>';
    document.getElementById('heatmap-container').innerHTML = html;
}

// ============================================================
// 5. SYSTEMS BREAKDOWN
// ============================================================

function renderSystems() {
    const systemCounts = countBy(rawData, 'system');
    const sorted = sortedEntries(systemCounts);
    const systems = sorted.map(e => e[0]);
    const errorTypes = [...new Set(rawData.map(d => d.errorType))];

    // Stacked bar with error breakdown
    const datasets = errorTypes.map(errorType => ({
        label: errorType,
        data: systems.map(system =>
            rawData.filter(d => d.system === system && d.errorType === errorType).length
        ),
        backgroundColor: ERROR_COLORS[errorType] || COLORS.slate,
        borderRadius: 2,
    }));

    destroyChart('systemStacked');
    charts.systemStacked = new Chart(document.getElementById('system-stacked-chart'), {
        type: 'bar',
        data: { labels: systems, datasets },
        options: {
            indexAxis: 'y',
            responsive: true,
            plugins: { legend: { position: 'bottom', labels: { color: CHART_DEFAULTS.textColor, font: { size: 10 } } } },
            scales: {
                x: { stacked: true, ticks: { color: CHART_DEFAULTS.textColor }, grid: { color: CHART_DEFAULTS.gridColor } },
                y: { stacked: true, ticks: { color: CHART_DEFAULTS.textColor, font: { size: 11 } }, grid: { display: false } }
            }
        }
    });

    // Populate drill-down selector
    const select = document.getElementById('system-drilldown-select');
    select.innerHTML = '<option value="">Select a system...</option>' +
        systems.map(s => `<option value="${s}">${s} (${systemCounts[s]})</option>`).join('');
    select.addEventListener('change', () => {
        if (select.value) renderSystemDrilldown(select.value);
        else document.getElementById('system-drilldown-container').style.display = 'none';
    });

    // Insight cards
    const container = document.getElementById('system-insights');
    const top5 = sorted.slice(0, 5);
    container.innerHTML = top5.map(([system, count]) => {
        const sysData = rawData.filter(d => d.system === system);
        const errors = countBy(sysData, 'errorType');
        const topError = sortedEntries(errors)[0];
        const categories = countBy(sysData, 'category');
        const topCat = sortedEntries(categories)[0];
        const score = calcPriorityScore(sysData);
        return `
            <div class="insight-card">
                <h4>${system}</h4>
                <p class="count">${count} <span style="font-size:0.8rem;color:#94a3b8">Score: ${score.toFixed(0)}</span></p>
                <p>Top error: <strong>${topError[0]}</strong> (${topError[1]})</p>
                <p>Top category: <strong>${topCat[0]}</strong> (${topCat[1]})</p>
            </div>
        `;
    }).join('');
}

function renderSystemDrilldown(system) {
    const container = document.getElementById('system-drilldown-container');
    container.style.display = 'block';
    document.getElementById('drilldown-system-name').textContent = system;
    document.getElementById('drilldown-system-name2').textContent = system;

    const sysData = rawData.filter(d => d.system === system);
    const catCounts = sortedEntries(countBy(sysData, 'category'));
    const errCounts = sortedEntries(countBy(sysData, 'errorType'));

    // Category bar
    destroyChart('systemCategory');
    charts.systemCategory = new Chart(document.getElementById('system-category-chart'), {
        type: 'bar',
        data: {
            labels: catCounts.map(e => e[0]),
            datasets: [{
                data: catCounts.map(e => e[1]),
                backgroundColor: COLORS.blue,
                borderRadius: 4,
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { color: CHART_DEFAULTS.textColor }, grid: { color: CHART_DEFAULTS.gridColor } },
                y: { ticks: { color: CHART_DEFAULTS.textColor, font: { size: 11 } }, grid: { display: false } }
            }
        }
    });

    // Error type pie for this system
    destroyChart('systemDrilldownError');
    charts.systemDrilldownError = new Chart(document.getElementById('system-drilldown-error-chart'), {
        type: 'doughnut',
        data: {
            labels: errCounts.map(e => e[0]),
            datasets: [{
                data: errCounts.map(e => e[1]),
                backgroundColor: errCounts.map(e => ERROR_COLORS[e[0]] || COLORS.slate),
                borderWidth: 0,
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { position: 'bottom', labels: { color: CHART_DEFAULTS.textColor, font: { size: 10 } } } }
        }
    });

    // Detail table
    document.getElementById('system-drilldown-tbody').innerHTML = sysData.map(d => `
        <tr>
            <td>${d.category}</td>
            <td>${d.topic}</td>
            <td><span class="error-badge ${getErrorBadgeClass(d.errorType)}">${d.errorType}</span></td>
            <td>${d.notes}</td>
            <td>${d.strategy}</td>
        </tr>
    `).join('');
}

// ============================================================
// 6. SHELF PERFORMANCE
// ============================================================

function renderShelves() {
    const shelfCounts = countBy(rawData, 'shelf');
    const sorted = sortedEntries(shelfCounts);
    const shelves = sorted.map(e => e[0]);
    const errorTypes = Object.keys(ERROR_COLORS);

    // 100% stacked bar
    const stackedDatasets = errorTypes.map(errorType => ({
        label: errorType,
        data: shelves.map(shelf => {
            const shelfTotal = rawData.filter(d => d.shelf === shelf).length || 1;
            return ((rawData.filter(d => d.shelf === shelf && d.errorType === errorType).length / shelfTotal) * 100).toFixed(1);
        }),
        backgroundColor: ERROR_COLORS[errorType],
    }));

    destroyChart('shelf100Stacked');
    charts.shelf100Stacked = new Chart(document.getElementById('shelf-100-stacked-chart'), {
        type: 'bar',
        data: { labels: shelves, datasets: stackedDatasets },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'bottom', labels: { color: CHART_DEFAULTS.textColor, font: { size: 10 } } },
                tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.raw}%` } }
            },
            scales: {
                x: { stacked: true, ticks: { color: CHART_DEFAULTS.textColor }, grid: { display: false } },
                y: { stacked: true, max: 100, ticks: { color: CHART_DEFAULTS.textColor, callback: v => v + '%' }, grid: { color: CHART_DEFAULTS.gridColor } }
            }
        }
    });

    // Small multiple radar charts (one per shelf)
    const container = document.getElementById('shelf-radars-container');
    container.innerHTML = '';
    shelves.forEach((shelf, i) => {
        const card = document.createElement('div');
        card.className = 'small-multiple-card';
        const shelfData = rawData.filter(d => d.shelf === shelf);
        const shelfTotal = shelfData.length;
        card.innerHTML = `
            <h4>${shelf}</h4>
            <p class="shelf-count">${shelfTotal} missed questions</p>
            <canvas id="shelf-radar-${i}" width="250" height="250"></canvas>
        `;
        container.appendChild(card);

        const radarData = errorTypes.map(e =>
            ((shelfData.filter(d => d.errorType === e).length / (shelfTotal || 1)) * 100).toFixed(1)
        );

        charts[`shelfRadar${i}`] = new Chart(document.getElementById(`shelf-radar-${i}`), {
            type: 'radar',
            data: {
                labels: errorTypes.map(e => e.length > 15 ? e.substring(0, 15) + '...' : e),
                datasets: [{
                    data: radarData,
                    borderColor: PALETTE[i],
                    backgroundColor: PALETTE[i] + '20',
                    pointBackgroundColor: PALETTE[i],
                    borderWidth: 2,
                }]
            },
            options: {
                responsive: true,
                plugins: { legend: { display: false } },
                scales: {
                    r: {
                        ticks: { color: CHART_DEFAULTS.textColor, backdropColor: 'transparent', font: { size: 8 } },
                        grid: { color: CHART_DEFAULTS.gridColor },
                        angleLines: { color: CHART_DEFAULTS.gridColor },
                        pointLabels: { color: CHART_DEFAULTS.textColor, font: { size: 8 } }
                    }
                }
            }
        });
    });

    // Shelf selector for drill-down
    const select = document.getElementById('shelf-select');
    select.innerHTML = '<option value="all">All Shelves</option>' +
        shelves.map(s => `<option value="${s}">${s}</option>`).join('');
    select.addEventListener('change', () => renderShelfDetail(select.value));
    renderShelfDetail('all');
}

function renderShelfDetail(shelf) {
    const filtered = shelf === 'all' ? rawData : rawData.filter(d => d.shelf === shelf);
    const systemCounts = countBy(filtered, 'system');
    const sorted = sortedEntries(systemCounts);

    destroyChart('shelfSystems');
    charts.shelfSystems = new Chart(document.getElementById('shelf-systems-chart'), {
        type: 'bar',
        data: {
            labels: sorted.map(e => e[0]),
            datasets: [{
                label: 'Missed Questions',
                data: sorted.map(e => e[1]),
                backgroundColor: COLORS.blue,
                borderRadius: 4,
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { color: CHART_DEFAULTS.textColor }, grid: { color: CHART_DEFAULTS.gridColor } },
                y: { ticks: { color: CHART_DEFAULTS.textColor, font: { size: 11 } }, grid: { display: false } }
            }
        }
    });
}

// ============================================================
// 7. REPEAT TOPICS
// ============================================================

function renderRepeatTopics() {
    const repeats = getRepeatTopics();

    // Bar chart
    destroyChart('repeatTopics');
    if (repeats.length > 0) {
        charts.repeatTopics = new Chart(document.getElementById('repeat-topics-chart'), {
            type: 'bar',
            data: {
                labels: repeats.map(t => t.topic),
                datasets: [{
                    label: 'Times Missed',
                    data: repeats.map(t => t.count),
                    backgroundColor: repeats.map(t => t.count >= 3 ? COLORS.red : COLORS.yellow),
                    borderRadius: 4,
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                plugins: { legend: { display: false } },
                scales: {
                    x: { ticks: { color: CHART_DEFAULTS.textColor, stepSize: 1 }, grid: { color: CHART_DEFAULTS.gridColor } },
                    y: { ticks: { color: CHART_DEFAULTS.textColor, font: { size: 11 } }, grid: { display: false } }
                }
            }
        });
    }

    // Clickable topic cards grid
    const grid = document.getElementById('depth-topic-grid');
    grid.innerHTML = repeats.map((t, i) => {
        const knowledgeCount = t.entries.filter(e => isKnowledgeError(e.errorType)).length;
        const cognitiveCount = t.entries.filter(e => isCognitiveError(e.errorType)).length;
        const severity = t.count >= 3 ? 'high' : 'medium';
        return `
            <div class="depth-topic-card depth-severity-${severity} animate-in" data-topic-index="${i}">
                <div class="depth-topic-card-top">
                    <span class="depth-miss-count">${t.count}x</span>
                    <span class="depth-severity-tag">${t.count >= 3 ? 'Critical' : 'Review'}</span>
                </div>
                <h4 class="depth-topic-name">${t.topic}</h4>
                <div class="depth-topic-tags">
                    ${[...t.systems].map(s => `<span class="depth-sys-tag">${s}</span>`).join('')}
                </div>
                <div class="depth-topic-split">
                    <span class="depth-split-kg" title="Knowledge gaps">${knowledgeCount} knowledge</span>
                    <span class="depth-split-cog" title="Cognitive errors">${cognitiveCount} reasoning</span>
                </div>
                <div class="depth-topic-cta">View Depth Report &rarr;</div>
            </div>
        `;
    }).join('') || '<p style="color:var(--text-muted);text-align:center;padding:40px;">No repeat topics found yet. Topics missed 2+ times will appear here with depth reports.</p>';

    // Attach click handlers
    grid.querySelectorAll('.depth-topic-card').forEach(card => {
        card.addEventListener('click', () => {
            const idx = parseInt(card.dataset.topicIndex);
            showDepthReport(repeats[idx]);
        });
    });

    // Back button
    document.getElementById('depth-back-btn').addEventListener('click', () => {
        document.getElementById('depth-report-panel').style.display = 'none';
        grid.style.display = '';
    });
}

function showDepthReport(topic) {
    const grid = document.getElementById('depth-topic-grid');
    const panel = document.getElementById('depth-report-panel');
    grid.style.display = 'none';
    panel.style.display = 'block';

    // Header
    document.getElementById('depth-report-title').textContent = topic.topic;
    document.getElementById('depth-report-meta').innerHTML = `
        <span class="depth-meta-badge depth-meta-count">${topic.count} times missed</span>
        ${[...topic.shelves].map(s => `<span class="depth-meta-badge">${s}</span>`).join('')}
        ${[...topic.systems].map(s => `<span class="depth-meta-badge depth-meta-system">${s}</span>`).join('')}
    `;

    const content = document.getElementById('depth-report-content');
    const entries = topic.entries;
    const knowledgeEntries = entries.filter(e => isKnowledgeError(e.errorType));
    const cognitiveEntries = entries.filter(e => isCognitiveError(e.errorType));

    // 1. YOUR KNOWLEDGE GAPS — what you missed and why
    const notesWithContent = entries.filter(e => e.notes && e.notes.trim());
    const strategiesWithContent = entries.filter(e => e.strategy && e.strategy.trim());

    // 2. RELATED TOPICS — other topics in same system/category they might also be weak on
    const relatedTopics = findRelatedTopics(topic);

    // 3. BUILD the report
    content.innerHTML = `
        <!-- Section 1: Your Documented Knowledge Gaps -->
        <div class="depth-section">
            <h4 class="depth-section-title depth-title-red">Your Knowledge Gaps</h4>
            <p class="depth-section-desc">Every time you missed this topic — what went wrong and what you noted</p>
            <div class="depth-entries-list">
                ${entries.map((e, i) => `
                    <div class="depth-entry-card">
                        <div class="depth-entry-header">
                            <span class="depth-entry-num">Miss #${i + 1}</span>
                            <span class="error-badge ${getErrorBadgeClass(e.errorType)}">${e.errorType}</span>
                            <span class="depth-entry-context">${e.shelf} / ${e.system} / ${e.category}</span>
                        </div>
                        ${e.notes && e.notes.trim() ? `<div class="depth-entry-notes"><strong>What you didn't know:</strong> ${e.notes}</div>` : '<div class="depth-entry-notes" style="color:var(--text-muted);">No notes recorded</div>'}
                        ${e.strategy && e.strategy.trim() ? `<div class="depth-entry-strategy"><strong>Strategy:</strong> ${e.strategy}</div>` : ''}
                    </div>
                `).join('')}
            </div>
        </div>

        <!-- Section 2: Error Pattern Analysis -->
        <div class="depth-section">
            <h4 class="depth-section-title depth-title-yellow">Error Pattern Analysis</h4>
            <p class="depth-section-desc">How your misses break down — helps you target the right fix</p>
            <div class="depth-pattern-grid">
                <div class="depth-pattern-card">
                    <div class="depth-pattern-number" style="color:${COLORS.red}">${knowledgeEntries.length}</div>
                    <div class="depth-pattern-label">Knowledge Gaps</div>
                    <div class="depth-pattern-hint">${knowledgeEntries.length > 0 ? 'You need content review' : 'Not a content problem'}</div>
                </div>
                <div class="depth-pattern-card">
                    <div class="depth-pattern-number" style="color:${COLORS.yellow}">${cognitiveEntries.length}</div>
                    <div class="depth-pattern-label">Reasoning Errors</div>
                    <div class="depth-pattern-hint">${cognitiveEntries.length > 0 ? 'Practice question technique' : 'Not a reasoning problem'}</div>
                </div>
                <div class="depth-pattern-card">
                    <div class="depth-pattern-number" style="color:${COLORS.purple}">${topic.systems.size}</div>
                    <div class="depth-pattern-label">Systems Affected</div>
                    <div class="depth-pattern-hint">${topic.systems.size > 1 ? 'Cross-system gap — foundational concept' : 'Isolated to one system'}</div>
                </div>
                <div class="depth-pattern-card">
                    <div class="depth-pattern-number" style="color:${COLORS.blue}">${topic.categories.size}</div>
                    <div class="depth-pattern-label">Categories</div>
                    <div class="depth-pattern-hint">${[...topic.categories].join(', ')}</div>
                </div>
            </div>
            ${knowledgeEntries.length > cognitiveEntries.length
                ? `<div class="depth-verdict verdict-knowledge">This topic is primarily a <strong>content gap</strong>. You need to study the material — doing more practice questions without reviewing content first will not fix this.</div>`
                : cognitiveEntries.length > knowledgeEntries.length
                ? `<div class="depth-verdict verdict-cognitive">This topic is primarily a <strong>reasoning problem</strong>. You likely know some of the material but are making technique errors. Practice slowing down and reading the full vignette before answering.</div>`
                : `<div class="depth-verdict verdict-mixed">This topic has a <strong>mixed pattern</strong> — both knowledge gaps and reasoning errors. Review the content AND practice deliberate question technique.</div>`
            }
        </div>

        <!-- Section 3: Consolidated Study Notes -->
        ${notesWithContent.length > 0 || strategiesWithContent.length > 0 ? `
        <div class="depth-section">
            <h4 class="depth-section-title depth-title-green">Consolidated Study Guide</h4>
            <p class="depth-section-desc">All your notes and strategies for this topic in one place — review before your next session</p>
            ${notesWithContent.length > 0 ? `
            <div class="depth-study-block">
                <h5>What You Need to Know</h5>
                <ul class="depth-study-list">
                    ${notesWithContent.map(e => `<li>${e.notes}</li>`).join('')}
                </ul>
            </div>` : ''}
            ${strategiesWithContent.length > 0 ? `
            <div class="depth-study-block">
                <h5>How to Approach It Next Time</h5>
                <ul class="depth-study-list">
                    ${strategiesWithContent.map(e => `<li>${e.strategy}</li>`).join('')}
                </ul>
            </div>` : ''}
        </div>` : ''}

        <!-- Section 4: Potential Blind Spots -->
        <div class="depth-section">
            <h4 class="depth-section-title depth-title-purple">Potential Blind Spots</h4>
            <p class="depth-section-desc">Other topics in the same system and category that you've also missed — if you're weak here, you might be weak on these too</p>
            ${relatedTopics.length > 0 ? `
            <div class="depth-related-grid">
                ${relatedTopics.map(r => `
                    <div class="depth-related-card">
                        <div class="depth-related-header">
                            <strong>${r.topic}</strong>
                            <span class="depth-related-count">${r.count}x missed</span>
                        </div>
                        <div class="depth-related-context">${r.system} / ${r.category}</div>
                        <div class="depth-related-errors">${[...r.errors].map(e => `<span class="error-badge ${getErrorBadgeClass(e)}">${e}</span>`).join(' ')}</div>
                        ${r.hasNotes ? `<div class="depth-related-note">${r.sampleNote}</div>` : ''}
                    </div>
                `).join('')}
            </div>
            <div class="depth-blindspot-tip">These topics share the same system or category. If the board tests you on <strong>${topic.topic}</strong>, they could just as easily test you on any of these. Consider reviewing them together as a block.</div>
            ` : '<p style="color:var(--text-muted);">No closely related topics found in your missed questions. This topic may be more isolated.</p>'}
        </div>

        <!-- Section 5: Board Strategy -->
        <div class="depth-section">
            <h4 class="depth-section-title depth-title-blue">Board Strategy</h4>
            <p class="depth-section-desc">How to leverage this for the exam and real clinical use</p>
            <div class="depth-board-tips">
                ${generateBoardStrategy(topic, relatedTopics)}
            </div>
        </div>
    `;

    // Scroll to top of panel
    document.querySelector('.content').scrollTo({ top: 0, behavior: 'smooth' });
}

function findRelatedTopics(topic) {
    const topicKey = topic.topic.toLowerCase();
    const systems = [...topic.systems];
    const categories = [...topic.categories];

    // Find other entries that share the same system or category but are different topics
    const related = {};
    rawData.forEach(d => {
        const dKey = d.topic.toLowerCase();
        if (dKey === topicKey) return; // skip self
        if (systems.includes(d.system) || categories.includes(d.category)) {
            if (!related[dKey]) {
                related[dKey] = { topic: d.topic, count: 0, system: d.system, category: d.category, errors: new Set(), notes: [], hasNotes: false, sampleNote: '' };
            }
            related[dKey].count++;
            related[dKey].errors.add(d.errorType);
            if (d.notes && d.notes.trim()) {
                related[dKey].hasNotes = true;
                if (!related[dKey].sampleNote) related[dKey].sampleNote = d.notes;
            }
        }
    });

    return Object.values(related)
        .sort((a, b) => b.count - a.count)
        .slice(0, 8);
}

function generateBoardStrategy(topic, relatedTopics) {
    const tips = [];
    const entries = topic.entries;
    const knowledgeEntries = entries.filter(e => isKnowledgeError(e.errorType));
    const cognitiveEntries = entries.filter(e => isCognitiveError(e.errorType));
    const systems = [...topic.systems];
    const categories = [...topic.categories];

    // Severity-based tips
    if (topic.count >= 4) {
        tips.push({ icon: '!!', cls: 'tip-critical', text: `You've missed this <strong>${topic.count} times</strong>. This is a critical gap. Block out dedicated time to master this topic — don't just re-read, actively test yourself until you can explain it without notes.` });
    } else if (topic.count >= 3) {
        tips.push({ icon: '!', cls: 'tip-warning', text: `Missed <strong>${topic.count} times</strong>. This is beyond a one-off mistake. It's a pattern that needs targeted intervention before exam day.` });
    }

    // Knowledge-specific tips
    if (knowledgeEntries.length > 0) {
        tips.push({ icon: 'K', cls: 'tip-knowledge', text: `<strong>Content to master:</strong> Review the core pathophysiology, presentation, and management of ${topic.topic}. Focus on the details you got wrong: ${knowledgeEntries.filter(e => e.notes?.trim()).map(e => `"${e.notes}"`).join('; ') || 'review your notes from each miss above'}.` });
    }

    // Cognitive-specific tips
    if (cognitiveEntries.length > 0) {
        const cogTypes = [...new Set(cognitiveEntries.map(e => e.errorType))];
        const cogAdvice = {
            'Anchoring Bias': 'read the ENTIRE vignette before committing to a diagnosis',
            'Premature Conclusion': 'use process of elimination — cross out wrong answers before picking right ones',
            "Didn't Recognize Presentation": 'slow down and re-read the vignette — identify the classic presentation pattern before answering',
        };
        tips.push({ icon: 'T', cls: 'tip-technique', text: `<strong>Technique fix:</strong> For ${topic.topic}, your reasoning errors were: ${cogTypes.join(', ')}. Next time: ${cogTypes.map(t => cogAdvice[t] || 'apply systematic question technique').join('; ')}.` });
    }

    // Cross-system tip
    if (topic.systems.size > 1) {
        tips.push({ icon: 'X', cls: 'tip-cross', text: `This topic spans <strong>${systems.join(' and ')}</strong>. Expect the board to test it from different angles. Make sure you understand how ${topic.topic} presents differently across systems.` });
    }

    // Related topics tip
    if (relatedTopics.length > 2) {
        tips.push({ icon: 'R', cls: 'tip-related', text: `You have <strong>${relatedTopics.length} related weak topics</strong> in the same area. Consider studying this as a topical block: ${topic.topic}, ${relatedTopics.slice(0, 3).map(r => r.topic).join(', ')}. The board often tests related concepts back-to-back.` });
    }

    // What other questions might look like
    tips.push({ icon: 'Q', cls: 'tip-questions', text: `<strong>Expect questions like:</strong> The board can test ${topic.topic} as a diagnosis question (classic presentation), a next-best-step question (management), a "what's the mechanism" question (pathophysiology), or a "what complication would you expect" question. If you've only seen it one way, practice approaching it from the other angles.` });

    return tips.map(t => `
        <div class="depth-tip ${t.cls}">
            <span class="depth-tip-icon">${t.icon}</span>
            <div class="depth-tip-text">${t.text}</div>
        </div>
    `).join('');
}

// ============================================================
// 8. TRENDS & INSIGHTS
// ============================================================

function renderTrends() {
    const total = rawData.length;
    const errorCounts = countBy(rawData, 'errorType');
    const systemCounts = countBy(rawData, 'system');
    const sortedSystems = sortedEntries(systemCounts);

    // High priority: system + error combos weighted by score
    const combos = {};
    rawData.forEach(d => {
        const key = `${d.system} | ${d.errorType}`;
        if (!combos[key]) combos[key] = { items: [], system: d.system, error: d.errorType };
        combos[key].items.push(d);
    });
    const rankedCombos = Object.values(combos)
        .map(c => ({ ...c, score: calcPriorityScore(c.items), count: c.items.length }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 6);

    document.getElementById('high-priority-list').innerHTML = rankedCombos.map(c =>
        `<li><strong>${c.system}</strong> + ${c.error} (${c.count} misses, score: ${c.score.toFixed(0)})</li>`
    ).join('');

    // Patterns
    const patterns = [];
    const kgPct = ((rawData.filter(d => isKnowledgeError(d.errorType)).length / total) * 100).toFixed(0);
    const cogPct = ((rawData.filter(d => isCognitiveError(d.errorType)).length / total) * 100).toFixed(0);

    if (kgPct > 30) patterns.push(`Knowledge gaps are ${kgPct}% of all errors — content review is your #1 priority`);
    if (cogPct > 30) patterns.push(`Cognitive errors are ${cogPct}% of misses — invest in test-taking strategy, not just studying more`);

    const biasPct = (((errorCounts['Anchoring Bias'] || 0) + (errorCounts['Premature Conclusion'] || 0)) / total * 100).toFixed(0);
    if (biasPct > 15) patterns.push(`Anchoring + premature conclusions = ${biasPct}% — practice reading full vignettes before answering`);

    const top3 = sortedSystems.slice(0, 3);
    const top3Pct = ((top3.reduce((s, e) => s + e[1], 0) / total) * 100).toFixed(0);
    patterns.push(`Top 3 systems (${top3.map(e => e[0]).join(', ')}) = ${top3Pct}% of all misses`);

    const repeats = getRepeatTopics();
    if (repeats.length > 0) {
        patterns.push(`${repeats.length} topics missed 2+ times — these are your highest-yield review targets`);
    }

    document.getElementById('pattern-list').innerHTML = patterns.map(p => `<li>${p}</li>`).join('');

    // Strategies
    const strategies = [];
    if ((errorCounts['Knowledge Gap'] || 0) > 20) strategies.push('Review depth reports for your knowledge gap topics — use the consolidated study guide to master the content before doing more questions');
    if ((errorCounts['Anchoring Bias'] || 0) > 10) strategies.push('Before selecting an answer, ask: "What else could explain ALL findings?" — break the anchor');
    if ((errorCounts['Premature Conclusion'] || 0) > 5) strategies.push('Use process of elimination on every question — cross out wrong answers before picking the right one');
    if ((errorCounts["Didn't Recognize Presentation"] || 0) > 5) strategies.push("Slow down and re-read the vignette — identify the classic presentation pattern before jumping to an answer");
    if ((errorCounts['Mixed Up Dx'] || 0) > 5) strategies.push('Make a quick differential list before picking — Mixed Up Dx errors mean you knew the right disease but picked the wrong one');
    strategies.push(`Focus study time on: ${top3.map(e => e[0]).join(', ')}`);
    if (repeats.length > 0) strategies.push(`Review depth reports for repeat topics: ${repeats.slice(0, 3).map(t => t.topic).join(', ')} — see Topic Depth Reports tab`);

    document.getElementById('strategy-list').innerHTML = strategies.map(s => `<li>${s}</li>`).join('');
}

// ============================================================
// 9. ALL ENTRIES
// ============================================================

function renderEntries(data) {
    const filtered = data || rawData;
    document.getElementById('entries-tbody').innerHTML = filtered.map(d => `
        <tr>
            <td><strong>${d.shelf}</strong></td>
            <td>${d.system}</td>
            <td>${d.category}</td>
            <td>${d.topic}</td>
            <td><span class="error-badge ${getErrorBadgeClass(d.errorType)}">${d.errorType}</span></td>
            <td>${d.notes}</td>
            <td>${d.strategy}</td>
        </tr>
    `).join('');

    document.getElementById('showing-count').textContent = filtered.length;
    document.getElementById('total-count').textContent = rawData.length;
}

function populateFilters() {
    const shelves = [...new Set(rawData.map(d => d.shelf))].sort();
    const systems = [...new Set(rawData.map(d => d.system))].sort();
    const errors = [...new Set(rawData.map(d => d.errorType))].sort();

    document.getElementById('filter-shelf').innerHTML = '<option value="">All Shelves</option>' + shelves.map(s => `<option value="${s}">${s}</option>`).join('');
    document.getElementById('filter-system').innerHTML = '<option value="">All Systems</option>' + systems.map(s => `<option value="${s}">${s}</option>`).join('');
    document.getElementById('filter-error').innerHTML = '<option value="">All Error Types</option>' + errors.map(e => `<option value="${e}">${e}</option>`).join('');
}

function applyFilters() {
    const shelf = document.getElementById('filter-shelf').value;
    const system = document.getElementById('filter-system').value;
    const error = document.getElementById('filter-error').value;
    const search = document.getElementById('filter-search').value.toLowerCase();

    let filtered = rawData;
    if (shelf) filtered = filtered.filter(d => d.shelf === shelf);
    if (system) filtered = filtered.filter(d => d.system === system);
    if (error) filtered = filtered.filter(d => d.errorType === error);
    if (search) {
        filtered = filtered.filter(d =>
            d.topic.toLowerCase().includes(search) ||
            d.notes.toLowerCase().includes(search) ||
            d.category.toLowerCase().includes(search) ||
            d.strategy.toLowerCase().includes(search)
        );
    }
    renderEntries(filtered);
}

document.getElementById('filter-shelf').addEventListener('change', applyFilters);
document.getElementById('filter-system').addEventListener('change', applyFilters);
document.getElementById('filter-error').addEventListener('change', applyFilters);
document.getElementById('filter-search').addEventListener('input', applyFilters);

// ============================================================
// 9b. PRE-EXAM REVIEW (System -> Topic grouped view)
// ============================================================

function escReview(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function populateReviewFilters() {
    const shelfSel = document.getElementById('review-shelf-filter');
    if (!shelfSel || shelfSel.options.length > 1) return;
    const shelves = [...new Set(rawData.map(d => d.shelf))].sort();
    shelves.forEach(s => {
        shelfSel.insertAdjacentHTML('beforeend', `<option value="${escReview(s)}">${escReview(s)}</option>`);
    });
}

function getFilteredReviewData() {
    const shelf = document.getElementById('review-shelf-filter').value;
    const source = document.getElementById('review-source-filter').value;
    const search = (document.getElementById('review-search').value || '').toLowerCase();
    return rawData.filter(d => {
        if (shelf && d.shelf !== shelf) return false;
        if (source && d.source !== source) return false;
        if (search) {
            const hay = `${d.topic} ${d.notes} ${d.strategy} ${d.category} ${d.system}`.toLowerCase();
            if (!hay.includes(search)) return false;
        }
        return true;
    });
}

function groupBySystemTopic(entries) {
    const systems = new Map();
    entries.forEach(d => {
        if (!systems.has(d.system)) systems.set(d.system, new Map());
        const topics = systems.get(d.system);
        if (!topics.has(d.topic)) topics.set(d.topic, { category: d.category, entries: [] });
        topics.get(d.topic).entries.push(d);
    });
    return systems;
}

function sumTopicEntries(topicMap) {
    let n = 0;
    topicMap.forEach(v => { n += v.entries.length; });
    return n;
}

function renderReviewEntry(e) {
    const errClass = getErrorBadgeClass(e.errorType);
    const sourceClass = (e.source || '').toLowerCase();
    return `
        <li class="review-entry">
            <div class="review-entry-meta">
                <span class="shelf-tag">${escReview(e.shelf)}</span>
                <span class="source-tag source-${escReview(sourceClass)}">${escReview(e.source)}</span>
                ${e.errorType ? `<span class="error-badge ${errClass}">${escReview(e.errorType)}</span>` : ''}
            </div>
            ${e.notes ? `<div class="review-entry-section"><strong>Why I missed it:</strong> ${escReview(e.notes)}</div>` : ''}
            ${e.strategy ? `<div class="review-entry-section"><strong>Strategy:</strong> ${escReview(e.strategy)}</div>` : ''}
        </li>`;
}

function renderReviewTopic(topic, data) {
    const { category, entries } = data;
    return `
        <div class="review-topic">
            <div class="review-topic-header">
                <h4 class="review-topic-name">${escReview(topic)}</h4>
                ${category ? `<span class="review-topic-category">${escReview(category)}</span>` : ''}
                <span class="review-topic-count">${entries.length}×</span>
            </div>
            <ul class="review-entries">
                ${entries.map(renderReviewEntry).join('')}
            </ul>
        </div>`;
}

function renderExamReview() {
    const body = document.getElementById('review-body');
    if (!body) return;
    const data = getFilteredReviewData();
    const systemsSet = new Set(data.map(d => d.system));
    const countEl = document.getElementById('review-count');
    if (countEl) {
        countEl.textContent = data.length
            ? `${data.length} ${data.length === 1 ? 'entry' : 'entries'} across ${systemsSet.size} ${systemsSet.size === 1 ? 'system' : 'systems'}`
            : '';
    }

    if (!data.length) {
        body.innerHTML = '<p class="empty-state">No entries match these filters.</p>';
        return;
    }

    const grouped = groupBySystemTopic(data);
    const sortedSystems = [...grouped.entries()].sort((a, b) => sumTopicEntries(b[1]) - sumTopicEntries(a[1]));

    body.innerHTML = sortedSystems.map(([system, topics]) => {
        const total = sumTopicEntries(topics);
        const sortedTopics = [...topics.entries()].sort((a, b) => b[1].entries.length - a[1].entries.length);
        return `
            <details class="review-system" open>
                <summary>
                    <span class="review-system-name">${escReview(system)}</span>
                    <span class="review-system-count">${total} ${total === 1 ? 'miss' : 'misses'}</span>
                </summary>
                <div class="review-topics">
                    ${sortedTopics.map(([topic, d]) => renderReviewTopic(topic, d)).join('')}
                </div>
            </details>`;
    }).join('');
}

document.getElementById('review-shelf-filter').addEventListener('change', renderExamReview);
document.getElementById('review-source-filter').addEventListener('change', renderExamReview);
document.getElementById('review-search').addEventListener('input', renderExamReview);
document.getElementById('review-expand-all').addEventListener('click', () => {
    document.querySelectorAll('#review-body details.review-system').forEach(d => { d.open = true; });
});
document.getElementById('review-collapse-all').addEventListener('click', () => {
    document.querySelectorAll('#review-body details.review-system').forEach(d => { d.open = false; });
});
document.getElementById('review-print-btn').addEventListener('click', () => {
    document.querySelectorAll('#review-body details.review-system').forEach(d => { d.open = true; });
    window.print();
});

// ============================================================
// 10. ADD ENTRY FORMS
// ============================================================

// Form tab switching
document.querySelectorAll('.form-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.form-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.form-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('form-' + tab.dataset.form).classList.add('active');
    });
});

// Set default date to today on the tracker form
document.getElementById('tracker-date').valueAsDate = new Date();

function ensureAppsScriptUrl(msgEl) {
    if (!APPS_SCRIPT_URL) {
        const url = prompt('Enter your Google Apps Script Web App URL.\n\nSee SETUP.md for deployment instructions.');
        if (url) {
            APPS_SCRIPT_URL = url;
            localStorage.setItem('appsScriptUrl', url);
        } else {
            msgEl.className = 'form-message error';
            msgEl.textContent = 'Apps Script URL required. See SETUP.md.';
            return false;
        }
    }
    return true;
}

// Missed Question form
document.getElementById('entry-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msgEl = document.getElementById('form-message');
    const btn = document.getElementById('submit-btn');
    if (!ensureAppsScriptUrl(msgEl)) return;

    const lljSource = document.getElementById('form-llj-source').value;
    const entry = {
        type: lljSource === 'amb' ? 'amb-missed-question' : 'missed-question',
        shelf: document.getElementById('form-shelf').value,
        system: document.getElementById('form-system').value,
        category: document.getElementById('form-category').value,
        topic: document.getElementById('form-topic').value,
        errorType: document.getElementById('form-error').value,
        notes: document.getElementById('form-notes').value,
        strategy: document.getElementById('form-strategy').value,
    };

    btn.disabled = true;
    btn.textContent = 'Adding...';

    try {
        await fetch(APPS_SCRIPT_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(entry),
        });
        msgEl.className = 'form-message success';
        msgEl.textContent = 'Missed question added! Refreshing data...';
        document.getElementById('entry-form').reset();
        setTimeout(async () => {
            await fetchData();
            renderAll();
            msgEl.style.display = 'none';
        }, 2000);
    } catch (err) {
        msgEl.className = 'form-message error';
        msgEl.textContent = 'Error: ' + err.message;
    } finally {
        btn.disabled = false;
        btn.textContent = 'Add Missed Question';
    }
});

// IM Tracker form
document.getElementById('tracker-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msgEl = document.getElementById('tracker-form-message');
    const btn = document.getElementById('tracker-submit-btn');
    if (!ensureAppsScriptUrl(msgEl)) return;

    const dateInput = document.getElementById('tracker-date').value;
    // Format date as M/D/YY to match the sheet format
    const d = new Date(dateInput + 'T00:00:00');
    const dateFormatted = `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`;

    const trackerType = document.getElementById('tracker-qbank-select').value;
    const shelfEl = document.getElementById('tracker-shelf');
    const shelfVal = shelfEl ? shelfEl.value : '';
    const entry = {
        type: trackerType === 'amb' ? 'amb-tracker' : 'uw-tracker',
        date: dateFormatted,
        qCompleted: parseInt(document.getElementById('tracker-q-completed').value) || 0,
        pctCorrect: document.getElementById('tracker-pct-correct').value + '%',
        qRemaining: parseInt(document.getElementById('tracker-q-remaining').value) || 0,
        shelf: shelfVal,
    };

    btn.disabled = true;
    btn.textContent = 'Adding...';

    try {
        await fetch(APPS_SCRIPT_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(entry),
        });
        msgEl.className = 'form-message success';
        msgEl.textContent = 'Tracker entry added! Refreshing data...';
        document.getElementById('tracker-form').reset();
        document.getElementById('tracker-date').valueAsDate = new Date();
        setTimeout(async () => {
            await fetchData();
            renderAll();
            msgEl.style.display = 'none';
        }, 2000);
    } catch (err) {
        msgEl.className = 'form-message error';
        msgEl.textContent = 'Error: ' + err.message;
    } finally {
        btn.disabled = false;
        btn.textContent = 'Add Tracker Entry';
    }
});

// ============================================================
// SECTION CONCLUSIONS
// ============================================================

function setConclusion(id, title, bodyHtml) {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = `
        <div class="conclusion-title">Key Takeaway</div>
        <div class="conclusion-body">${bodyHtml}</div>
    `;
}

function renderConclusion(sectionId) {
    const total = rawData.length;
    const errorCounts = countBy(rawData, 'errorType');
    const systemCounts = countBy(rawData, 'system');
    const shelfCounts = countBy(rawData, 'shelf');
    const sortedSystems = sortedEntries(systemCounts);
    const sortedErrors = sortedEntries(errorCounts);
    const repeats = getRepeatTopics();
    const knowledgeCount = rawData.filter(d => isKnowledgeError(d.errorType)).length;
    const cognitiveCount = rawData.filter(d => isCognitiveError(d.errorType)).length;
    const kgPct = ((knowledgeCount / total) * 100).toFixed(0);
    const cogPct = ((cognitiveCount / total) * 100).toFixed(0);

    switch (sectionId) {
        case 'study-today': {
            const topSys = sortedSystems[0];
            const actionType = knowledgeCount > cognitiveCount ? 'content review (Anki, First Aid, reading)' : 'test-taking technique (slowing down, process of elimination)';
            setConclusion('conclusion-study-today', 'Key Takeaway',
                `<p>Out of <strong>${total}</strong> missed questions, the data says your biggest opportunity is in <strong>${topSys[0]}</strong> (${topSys[1]} misses). ` +
                `Your errors lean toward ${knowledgeCount > cognitiveCount ? 'knowledge gaps' : 'cognitive/reasoning mistakes'}, meaning the most effective use of your study time right now is <strong>${actionType}</strong>.</p>` +
                `${repeats.length > 0 ? `<p><strong>${repeats.length} topics</strong> have come up multiple times — these are your single highest-yield review targets because they represent persistent gaps, not one-off mistakes.</p>` : ''}` +
                `<div class="takeaway">Bottom line: Focus your next study session on ${topSys[0]}, prioritize repeat topics, and ${knowledgeCount > cognitiveCount ? 'fill knowledge gaps with targeted content review' : 'practice systematic question approaches to reduce reasoning errors'}.</div>`
            );
            break;
        }
        case 'im-tracker': {
            const uwImTracker = getUwImTrackerData();
            const srgTracker = getSrgTrackerData();
            if (!uwImTracker.length && !ambTrackerData.length && !srgTracker.length) {
                setConclusion('conclusion-im-tracker', 'Key Takeaway', '<p>No tracker data available yet.</p>');
                break;
            }
            const uwValid  = uwImTracker.map(d => d.pctCorrect).filter(v => v !== null);
            const ambValid = ambTrackerData.map(d => d.pctCorrect).filter(v => v !== null);
            const srgValid = srgTracker.map(d => d.pctCorrect).filter(v => v !== null);
            const uwAvg  = uwValid.length  ? (uwValid.reduce((a, b)  => a + b, 0) / uwValid.length)  : 0;
            const ambAvg = ambValid.length ? (ambValid.reduce((a, b) => a + b, 0) / ambValid.length) : 0;
            const srgAvg = srgValid.length ? (srgValid.reduce((a, b) => a + b, 0) / srgValid.length) : 0;
            const uwTotal  = uwImTracker.reduce((s, d) => s + d.qCompleted, 0);
            const ambTotal = ambTrackerData.reduce((s, d) => s + d.qCompleted, 0);
            const srgTotal = srgTracker.reduce((s, d) => s + d.qCompleted, 0);

            let body = `<p>Total questions tracked: <strong>${uwTotal + srgTotal + ambTotal}</strong> (${uwTotal} UW IM · ${srgTotal} SRG · ${ambTotal} Amboss).</p>`;
            if (srgValid.length > 0) {
                body += `<p><strong>SRG (active block)</strong>: ${srgAvg.toFixed(1)}% over ${srgTracker.length} sessions. `;
                if (uwValid.length > 0) {
                    const diff = srgAvg - uwAvg;
                    body += diff > 0
                        ? `Running <strong>${diff.toFixed(1)} points above</strong> your UW (IM) baseline.`
                        : diff < -3
                        ? `Running ${Math.abs(diff).toFixed(1)} points below UW (IM) — expected ramp-up on a new shelf.`
                        : `Holding steady against your UW (IM) baseline.`;
                }
                body += '</p>';
            }
            if (uwValid.length > 0) body += `<p><strong>UW (IM)</strong>: ${uwAvg.toFixed(1)}% over ${uwImTracker.length} sessions (frozen — IM exam done).</p>`;
            if (ambValid.length > 0) body += `<p><strong>Amboss</strong>: ${ambAvg.toFixed(1)}% over ${ambTrackerData.length} sessions${srgTracker.length > 0 ? ' (paused while you complete SRG)' : ''}.</p>`;
            body += `<div class="takeaway">Use the Compare tab to overlay all three blocks on the same question-count axis and see how SRG is tracking against your prior UW (IM) and Amboss performance.</div>`;
            setConclusion('conclusion-im-tracker', 'Key Takeaway', body);
            break;
        }
        case 'overview': {
            const topError = sortedErrors[0];
            const topSys = sortedSystems[0];
            setConclusion('conclusion-overview', 'Key Takeaway',
                `<p>Across <strong>${total}</strong> missed questions, <strong>${kgPct}% are knowledge gaps</strong> (you didn't know the content) and <strong>${cogPct}% are cognitive errors</strong> (you knew the content but reasoned incorrectly). ` +
                `These require fundamentally different fixes — content review vs. test-taking technique.</p>` +
                `<p>The most common error type is <strong>${topError[0]}</strong> (${topError[1]} times, ${((topError[1] / total) * 100).toFixed(0)}% of all misses), and the weakest system is <strong>${topSys[0]}</strong> (${topSys[1]} misses).</p>` +
                `<div class="takeaway">${parseInt(kgPct) > 50 ? 'More than half your errors are pure knowledge gaps — prioritize content review (Anki, First Aid, OME) over doing more practice questions.' : 'Your errors are spread across reasoning and knowledge — balance content review with deliberate practice on question technique.'}</div>`
            );
            break;
        }
        case 'pareto': {
            let cumulative = 0, paretoCount = 0;
            for (const [, count] of sortedSystems) {
                cumulative += count;
                paretoCount++;
                if (cumulative >= total * 0.8) break;
            }
            const paretoSystems = sortedSystems.slice(0, paretoCount).map(e => e[0]);
            const catCounts = sortedEntries(countBy(rawData, 'category'));
            let catCum = 0, catPareto = 0;
            for (const [, count] of catCounts) {
                catCum += count;
                catPareto++;
                if (catCum >= total * 0.8) break;
            }
            setConclusion('conclusion-pareto', 'Key Takeaway',
                `<p>The 80/20 rule is clear in your data: just <strong>${paretoCount} out of ${sortedSystems.length} systems</strong> account for 80% of all missed questions. ` +
                `These are: <strong>${paretoSystems.join(', ')}</strong>.</p>` +
                `<p>At the category level, <strong>${catPareto} out of ${catCounts.length} categories</strong> drive 80% of misses. The red bars in the charts above show what falls within the 80% threshold.</p>` +
                `<div class="takeaway">If you have limited study time, concentrate exclusively on these ${paretoCount} systems. Everything else is lower yield. This is the single most efficient way to allocate your remaining study hours.</div>`
            );
            break;
        }
        case 'error-analysis': {
            const topError = sortedErrors[0];
            const biasCount = (errorCounts['Anchoring Bias'] || 0) + (errorCounts['Premature Conclusion'] || 0);
            const biasPct = ((biasCount / total) * 100).toFixed(0);
            // Find which system has the most concentrated error type
            const errorSystemPairs = [];
            sortedErrors.forEach(([error]) => {
                const bySystem = rawData.filter(d => d.errorType === error);
                const sysCounts = sortedEntries(countBy(bySystem, 'system'));
                if (sysCounts[0]) errorSystemPairs.push({ error, system: sysCounts[0][0], count: sysCounts[0][1] });
            });
            setConclusion('conclusion-error-analysis', 'Key Takeaway',
                `<p><strong>${topError[0]}</strong> is your most frequent error at <strong>${((topError[1] / total) * 100).toFixed(0)}%</strong> of all misses. ` +
                `${parseInt(biasPct) > 15 ? `Cognitive biases (anchoring + premature conclusions) together account for <strong>${biasPct}%</strong> — this is a significant pattern worth addressing with a systematic question approach.` : ''}</p>` +
                `<p>The heatmap above reveals where specific errors cluster with specific systems. Key hotspots: ` +
                `${errorSystemPairs.slice(0, 3).map(p => `<strong>${p.error}</strong> in ${p.system} (${p.count}x)`).join(', ')}.</p>` +
                `<div class="takeaway">Each error type needs a different fix. Knowledge gaps need content review. Anchoring bias needs full-vignette reading. Premature conclusions need process of elimination. Use the heatmap to target which fix applies to which system.</div>`
            );
            break;
        }
        case 'systems': {
            const top3 = sortedSystems.slice(0, 3);
            const top3Pct = ((top3.reduce((s, e) => s + e[1], 0) / total) * 100).toFixed(0);
            const systemDetails = top3.map(([sys, count]) => {
                const sysData = rawData.filter(d => d.system === sys);
                const topErr = sortedEntries(countBy(sysData, 'errorType'))[0];
                const topCat = sortedEntries(countBy(sysData, 'category'))[0];
                return { sys, count, topErr, topCat };
            });
            setConclusion('conclusion-systems', 'Key Takeaway',
                `<p>Your top 3 weakest systems account for <strong>${top3Pct}%</strong> of all missed questions:</p>` +
                `<p>${systemDetails.map(s => `<strong>${s.sys}</strong> (${s.count} misses): primarily ${s.topErr[0]} errors, concentrated in ${s.topCat[0]}`).join('<br>')}</p>` +
                `<p>Use the drill-down selector above to explore categories and specific missed questions within each system.</p>` +
                `<div class="takeaway">The error type breakdown per system matters: a system dominated by knowledge gaps needs content review, while one dominated by anchoring bias needs question practice. Check the stacked bars to see the difference.</div>`
            );
            break;
        }
        case 'shelves': {
            const shelfSorted = sortedEntries(shelfCounts);
            const weakest = shelfSorted[0];
            const strongest = shelfSorted[shelfSorted.length - 1];
            const shelfProfiles = shelfSorted.slice(0, 3).map(([shelf, count]) => {
                const sd = rawData.filter(d => d.shelf === shelf);
                const kg = sd.filter(d => isKnowledgeError(d.errorType)).length;
                const cog = sd.filter(d => isCognitiveError(d.errorType)).length;
                return { shelf, count, dominant: kg > cog ? 'knowledge gaps' : 'cognitive errors', dominantPct: ((Math.max(kg, cog) / count) * 100).toFixed(0) };
            });
            setConclusion('conclusion-shelves', 'Key Takeaway',
                `<p><strong>${weakest[0]}</strong> is the weakest shelf with <strong>${weakest[1]}</strong> missed questions, while <strong>${strongest[0]}</strong> is the strongest with only ${strongest[1]}.</p>` +
                `<p>The radar charts above show each shelf's error "fingerprint." Key patterns:<br>` +
                `${shelfProfiles.map(s => `<strong>${s.shelf}</strong>: ${s.dominantPct}% ${s.dominant}`).join('<br>')}</p>` +
                `<div class="takeaway">Different shelves need different study strategies. ${shelfProfiles[0].dominant === 'knowledge gaps' ? `${shelfProfiles[0].shelf} is primarily a content problem — study the material.` : `${shelfProfiles[0].shelf} is primarily a reasoning problem — practice questions with deliberate technique focus.`}</div>`
            );
            break;
        }
        case 'repeat-topics': {
            if (repeats.length === 0) {
                setConclusion('conclusion-repeat-topics', 'Key Takeaway', '<p>No repeat topics found yet. As you log more missed questions, topics that come up multiple times will appear here with full depth reports.</p>');
                break;
            }
            const topRepeat = repeats[0];
            const multiSystemRepeats = repeats.filter(t => t.systems.size > 1);
            const totalRelatedGaps = repeats.reduce((sum, t) => sum + findRelatedTopics(t).length, 0);
            setConclusion('conclusion-repeat-topics', 'Key Takeaway',
                `<p><strong>${repeats.length} topics</strong> have been missed 2 or more times. The most repeated is <strong>${topRepeat.topic}</strong> (${topRepeat.count} times across ${[...topRepeat.shelves].join(', ')}). ` +
                `${multiSystemRepeats.length > 0 ? `<strong>${multiSystemRepeats.length}</strong> repeat topics span multiple systems, suggesting foundational concept gaps.` : ''}</p>` +
                `<p>Click any topic card below for a full depth report — your specific knowledge gaps, error patterns, related blind spots you might also be weak on, and board strategy.</p>` +
                `<div class="takeaway">These are not just flashcard targets — they're your highest-yield deep-review topics. Each depth report consolidates everything you need to master the topic and cover related blind spots the practice questions haven't tested yet.</div>`
            );
            break;
        }
        case 'trends': {
            const topCombo = {};
            rawData.forEach(d => {
                const key = `${d.system}|${d.errorType}`;
                topCombo[key] = (topCombo[key] || 0) + 1;
            });
            const topCombos = sortedEntries(topCombo).slice(0, 3).map(([key, count]) => {
                const [sys, err] = key.split('|');
                return { sys, err, count };
            });
            setConclusion('conclusion-trends', 'Key Takeaway',
                `<p>The most dangerous combination in your data is <strong>${topCombos[0].sys} + ${topCombos[0].err}</strong> (${topCombos[0].count} occurrences). ` +
                `This is followed by ${topCombos.slice(1).map(c => `${c.sys} + ${c.err} (${c.count})`).join(' and ')}.</p>` +
                `<p>The patterns above reveal whether your primary bottleneck is content knowledge or test-taking technique, and which specific system-error combinations to target for maximum improvement.</p>` +
                `<div class="takeaway">Use the strategy recommendations above as your study plan. The data has spoken — trust it over gut feeling about what to study next.</div>`
            );
            break;
        }
    }
}

// ============================================================
// Refresh & Render All
// ============================================================

document.getElementById('refresh-btn').addEventListener('click', async () => {
    const btn = document.getElementById('refresh-btn');
    btn.textContent = 'Loading...';
    btn.disabled = true;
    showLoading();
    await fetchData();
    renderAll();
    hideLoading();
    btn.textContent = 'Refresh Data';
    btn.disabled = false;
});

function renderAll() {
    // Clear rendered tracking so everything re-renders
    renderedSections.clear();
    // Only render the currently active section
    const activeSection = document.querySelector('.section.active');
    const activeId = activeSection ? activeSection.id : 'study-today';
    renderSection(activeId);
    updateContentHeader(activeId);
}

(async function init() {
    await fetchData();
    if (rawData.length > 0) renderAll();
    hideLoading();
})();
