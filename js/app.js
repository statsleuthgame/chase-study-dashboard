// ============================================================
// Step 2 CK Study Dashboard - Main Application (v2)
// ============================================================

const SHEET_ID = 'REDACTED_SHEET_ID';
const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv`;

let APPS_SCRIPT_URL = localStorage.getItem('appsScriptUrl') || '';

const COLORS = {
    blue: '#3b82f6', red: '#ef4444', yellow: '#f59e0b', green: '#22c55e',
    purple: '#a855f7', pink: '#ec4899', teal: '#14b8a6', orange: '#f97316',
    indigo: '#6366f1', cyan: '#06b6d4', lime: '#84cc16', rose: '#f43f5e',
    slate: '#64748b', amber: '#d97706', emerald: '#10b981', sky: '#0ea5e9',
};
const PALETTE = Object.values(COLORS);

const ERROR_COLORS = {
    'Knowledge gap': COLORS.red,
    'Anchoring Bias': COLORS.yellow,
    'Premature conclusion': COLORS.purple,
    'Hidden Hook Failure': COLORS.blue,
    'Right map / wrong order': COLORS.teal,
    'Wrong Algorithm': COLORS.pink,
    'Dumb mistake': COLORS.slate,
    'Misunderstood vinnet': COLORS.orange,
};

// Knowledge errors vs cognitive/reasoning errors
const KNOWLEDGE_ERRORS = ['Knowledge gap', 'Wrong Algorithm'];
const COGNITIVE_ERRORS = ['Anchoring Bias', 'Premature conclusion', 'Hidden Hook Failure',
    'Right map / wrong order', 'Misunderstood vinnet'];
const LOW_WEIGHT_ERRORS = ['Dumb mistake'];

// Severity weights for priority scoring
const ERROR_WEIGHTS = {
    'Knowledge gap': 3,
    'Wrong Algorithm': 3,
    'Hidden Hook Failure': 2,
    'Anchoring Bias': 1.5,
    'Premature conclusion': 1.5,
    'Misunderstood vinnet': 1.5,
    'Right map / wrong order': 1.5,
    'Dumb mistake': 0.5,
};

let rawData = [];
let charts = {};

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

async function fetchData() {
    try {
        const response = await fetch(SHEET_CSV_URL);
        if (!response.ok) throw new Error('Failed to fetch');
        const csv = await response.text();
        const rows = parseCSV(csv);

        rawData = rows.slice(1)
            .filter(row => row[0] && row[0].trim())
            .map(row => ({
                shelf: (row[0] || '').trim(),
                system: normalizeSystem((row[1] || '').trim()),
                category: (row[2] || '').trim(),
                topic: (row[3] || '').trim(),
                errorType: (row[4] || '').trim(),
                notes: (row[5] || '').trim(),
                strategy: (row[6] || '').trim(),
            }));

        document.getElementById('last-updated').textContent = new Date().toLocaleTimeString();
        return rawData;
    } catch (err) {
        console.error('Error fetching data:', err);
        document.getElementById('last-updated').textContent = 'Error';
        return [];
    }
}

function normalizeSystem(system) {
    const lower = system.toLowerCase();
    const map = {
        'gastrointestinal and nutrition': 'Gastrointestinal and Nutrition',
        'renal, urinary systems and electrolytes': 'Renal & Electrolytes',
        'rheumatology / orthopedics and sports': 'Rheumatology & Ortho',
        'nervous system': 'Nervous System',
        'pulmonary and critical care': 'Pulmonary & Critical Care',
        'endocrine, diabetes and metabolism': 'Endocrine & Metabolism',
        'cardiovascular system': 'Cardiovascular',
        'hematology and oncology': 'Hematology & Oncology',
        'infectious diseases': 'Infectious Diseases',
        'allergy and immunology': 'Allergy & Immunology',
        'dermatology': 'Dermatology',
        'ear, nose, throat (ent)': 'ENT',
        'male reproductive system': 'Male Reproductive',
        'social sciences (ethics/legal/prof)': 'Social Sciences',
        'social sciences (ethics/legal/prof...)': 'Social Sciences',
        'poisening and environmental exposure': 'Poisoning & Environmental',
        'miscellaneous': 'Miscellaneous',
        'pregnancy, childbirth & puerperium': 'Pregnancy & Childbirth',
    };
    return map[lower] || system;
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
        'Knowledge gap': 'knowledge-gap', 'Anchoring Bias': 'anchoring-bias',
        'Premature conclusion': 'premature-conclusion', 'Hidden Hook Failure': 'hidden-hook',
        'Right map / wrong order': 'wrong-order', 'Wrong Algorithm': 'wrong-algorithm',
        'Dumb mistake': 'dumb-mistake', 'Misunderstood vinnet': 'misunderstood',
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
            topicCounts[key] = { topic: d.topic, count: 0, shelves: new Set(), systems: new Set(), errors: new Set(), categories: new Set() };
        }
        topicCounts[key].count++;
        topicCounts[key].shelves.add(d.shelf);
        topicCounts[key].systems.add(d.system);
        topicCounts[key].errors.add(d.errorType);
        topicCounts[key].categories.add(d.category);
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
    'overview': 'Overview',
    'pareto': 'Pareto Analysis',
    'error-analysis': 'Error Analysis',
    'systems': 'Systems Breakdown',
    'shelves': 'Shelf Performance',
    'repeat-topics': 'Repeat Topics',
    'trends': 'Trends & Insights',
    'entries': 'All Entries',
    'add-entry': 'Add New Entry',
};

// ============================================================
// Intersection Observer for scroll-in animations
// ============================================================

const animationObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('visible');
        }
    });
}, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });

function observeAnimations(container) {
    const root = container || document;
    root.querySelectorAll('.animate-in:not(.visible)').forEach(el => {
        animationObserver.observe(el);
    });
}

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
        // Observe animations only within this section
        setTimeout(() => observeAnimations(document.getElementById(section)), 50);
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
        case 'overview': renderOverview(); break;
        case 'pareto': renderPareto(); break;
        case 'error-analysis': renderErrorAnalysis(); break;
        case 'systems': renderSystems(); break;
        case 'shelves': renderShelves(); break;
        case 'repeat-topics': renderRepeatTopics(); break;
        case 'trends': renderTrends(); break;
        case 'entries': populateFilters(); renderEntries(); break;
        case 'add-entry': break; // static form, nothing to render
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

    // Detail table
    document.getElementById('repeat-topics-tbody').innerHTML = repeats.map(t => `
        <tr>
            <td><strong>${t.topic}</strong></td>
            <td style="text-align:center;"><strong style="color:${t.count >= 3 ? COLORS.red : COLORS.yellow}">${t.count}</strong></td>
            <td>${[...t.shelves].join(', ')}</td>
            <td>${[...t.systems].join(', ')}</td>
            <td>${[...t.errors].map(e => `<span class="error-badge ${getErrorBadgeClass(e)}">${e}</span>`).join(' ')}</td>
            <td>${[...t.categories].join(', ')}</td>
        </tr>
    `).join('') || '<tr><td colspan="6" style="text-align:center;color:#64748b;">No repeat topics found yet</td></tr>';
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
    const kgPct = ((errorCounts['Knowledge gap'] || 0) / total * 100).toFixed(0);
    const cogPct = ((rawData.filter(d => isCognitiveError(d.errorType)).length / total) * 100).toFixed(0);

    if (kgPct > 30) patterns.push(`Knowledge gaps are ${kgPct}% of all errors — content review is your #1 priority`);
    if (cogPct > 30) patterns.push(`Cognitive errors are ${cogPct}% of misses — invest in test-taking strategy, not just studying more`);

    const biasPct = (((errorCounts['Anchoring Bias'] || 0) + (errorCounts['Premature conclusion'] || 0)) / total * 100).toFixed(0);
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
    if ((errorCounts['Knowledge gap'] || 0) > 20) strategies.push('Make Anki cards for every knowledge gap topic — spaced repetition is the most efficient way to fill content gaps');
    if ((errorCounts['Anchoring Bias'] || 0) > 10) strategies.push('Before selecting an answer, ask: "What else could explain ALL findings?" — break the anchor');
    if ((errorCounts['Premature conclusion'] || 0) > 5) strategies.push('Use process of elimination on every question — cross out wrong answers before picking the right one');
    if ((errorCounts['Hidden Hook Failure'] || 0) > 5) strategies.push('Circle unusual lab values and unexpected findings — these are often the key to the question');
    if ((errorCounts['Wrong Algorithm'] || 0) > 5) strategies.push('Review clinical decision algorithms for your top systems (treatment hierarchies, diagnostic workups)');
    strategies.push(`Focus study time on: ${top3.map(e => e[0]).join(', ')}`);
    if (repeats.length > 0) strategies.push(`Make dedicated flashcards for repeat topics: ${repeats.slice(0, 3).map(t => t.topic).join(', ')}`);

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
// 10. ADD ENTRY FORM
// ============================================================

document.getElementById('entry-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msgEl = document.getElementById('form-message');
    const btn = document.getElementById('submit-btn');

    if (!APPS_SCRIPT_URL) {
        const url = prompt('Enter your Google Apps Script Web App URL.\n\nSee SETUP.md for deployment instructions.');
        if (url) {
            APPS_SCRIPT_URL = url;
            localStorage.setItem('appsScriptUrl', url);
        } else {
            msgEl.className = 'form-message error';
            msgEl.textContent = 'Apps Script URL required. See SETUP.md.';
            return;
        }
    }

    const entry = {
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
        msgEl.textContent = 'Entry added! Refreshing data...';
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
        btn.textContent = 'Add Entry';
    }
});

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
    setTimeout(() => observeAnimations(activeSection), 100);
}

(async function init() {
    await fetchData();
    if (rawData.length > 0) renderAll();
    hideLoading();
})();
