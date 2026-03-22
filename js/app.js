// ============================================================
// Step 2 CK Study Dashboard - Main Application (v2)
// ============================================================

const SHEET_ID = 'REDACTED_SHEET_ID';
const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv`;
const TRACKER_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=IM%20Tracker`;

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
let trackerData = [];
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

        // Fetch IM Tracker (second tab)
        // Try multiple sheet name formats since Google Sheets can be picky
        const trackerUrls = [
            `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=IM+Tracker`,
            `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=IM%20Tracker`,
        ];
        for (const url of trackerUrls) {
            try {
                const trackerResp = await fetch(url);
                if (!trackerResp.ok) continue;
                const trackerCsv = await trackerResp.text();
                const trackerRows = parseCSV(trackerCsv);
                // Check if this is actually the tracker (header should have "Date" or "Q Completed")
                const header = (trackerRows[0] || []).join(' ').toLowerCase();
                if (!header.includes('date') && !header.includes('completed')) continue;

                trackerData = trackerRows.slice(1)
                    .filter(row => {
                        const dateVal = (row[0] || '').trim();
                        const qVal = (row[1] || '').trim();
                        // Must have a date-like value and a numeric question count
                        return dateVal && /\d/.test(dateVal) && qVal && /^\d+$/.test(qVal);
                    })
                    .map(row => {
                        const pctStr = (row[2] || '').replace(/%/g, '').replace(/[—–-]/g, '').trim();
                        const pct = pctStr && !isNaN(parseFloat(pctStr)) ? parseFloat(pctStr) : null;
                        const qCompleted = parseInt(row[1]) || 0;
                        const qRemaining = parseInt(row[3]) || 0;
                        return {
                            date: (row[0] || '').trim(),
                            qCompleted,
                            pctCorrect: pct,
                            qRemaining,
                        };
                    })
                    .filter(r => r.qCompleted > 0);

                console.log('IM Tracker loaded:', trackerData.length, 'rows');
                break; // success, stop trying
            } catch (e) {
                console.warn('Tracker fetch attempt failed:', url, e);
            }
        }

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
    'im-tracker': 'IM Progress Tracker',
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
        case 'add-entry': break; // static form, nothing to render
    }
    // Generate data-driven conclusion for this section
    renderConclusion(sectionId);
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
    if (!trackerData.length) {
        console.warn('No tracker data available. trackerData:', trackerData);
        document.getElementById('tracker-total-q').textContent = 'No data';
        return;
    }

    const labels = trackerData.map(d => d.date);
    const scores = trackerData.map(d => d.pctCorrect);
    const qPerDay = trackerData.map(d => d.qCompleted);
    const remaining = trackerData.map(d => d.qRemaining);

    // Compute cumulative questions done
    let cumulative = 0;
    const cumulativeData = trackerData.map(d => { cumulative += d.qCompleted; return cumulative; });

    // 7-day rolling average of % correct
    const rollingAvg = scores.map((_, i) => {
        const window = scores.slice(Math.max(0, i - 6), i + 1).filter(v => v !== null);
        return window.length > 0 ? (window.reduce((a, b) => a + b, 0) / window.length) : null;
    });

    // Stats
    const totalQ = cumulativeData[cumulativeData.length - 1] || 0;
    const validScores = scores.filter(v => v !== null);
    const avgScore = validScores.length ? (validScores.reduce((a, b) => a + b, 0) / validScores.length).toFixed(1) : '--';
    const bestDay = Math.max(...qPerDay);
    const avgQPerDay = (totalQ / trackerData.length).toFixed(1);
    const lastRemaining = trackerData[trackerData.length - 1]?.qRemaining ?? '--';
    const recentScores = validScores.slice(-7);
    const recentAvg = recentScores.length ? (recentScores.reduce((a, b) => a + b, 0) / recentScores.length).toFixed(1) : '--';
    const earlyScores = validScores.slice(0, 7);
    const earlyAvg = earlyScores.length ? (earlyScores.reduce((a, b) => a + b, 0) / earlyScores.length).toFixed(1) : '--';

    document.getElementById('tracker-total-q').textContent = totalQ;
    document.getElementById('tracker-avg-score').textContent = avgScore + '%';
    document.getElementById('tracker-avg-qday').textContent = avgQPerDay;
    document.getElementById('tracker-best-day').textContent = bestDay;
    document.getElementById('tracker-remaining').textContent = lastRemaining;
    document.getElementById('tracker-recent-avg').textContent = recentAvg + '%';
    document.getElementById('tracker-trend-dir').textContent =
        parseFloat(recentAvg) > parseFloat(earlyAvg) ? 'Improving' :
        parseFloat(recentAvg) < parseFloat(earlyAvg) ? 'Declining' : 'Stable';
    document.getElementById('tracker-trend-dir').style.color =
        parseFloat(recentAvg) > parseFloat(earlyAvg) ? COLORS.green :
        parseFloat(recentAvg) < parseFloat(earlyAvg) ? COLORS.red : COLORS.yellow;
    document.getElementById('tracker-early-avg').textContent = `First 7 days: ${earlyAvg}% → Last 7 days: ${recentAvg}%`;

    // Score over time chart (line + rolling avg)
    destroyChart('trackerScore');
    charts.trackerScore = new Chart(document.getElementById('tracker-score-chart'), {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: '% Correct',
                    data: scores,
                    borderColor: COLORS.blue,
                    backgroundColor: COLORS.blue + '20',
                    pointRadius: 3,
                    pointBackgroundColor: COLORS.blue,
                    borderWidth: 2,
                    fill: true,
                    spanGaps: true,
                },
                {
                    label: '7-Day Rolling Avg',
                    data: rollingAvg,
                    borderColor: COLORS.yellow,
                    borderWidth: 2,
                    borderDash: [6, 3],
                    pointRadius: 0,
                    fill: false,
                    spanGaps: true,
                }
            ]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'bottom', labels: { color: CHART_DEFAULTS.textColor } },
                tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.raw !== null ? ctx.raw.toFixed(1) + '%' : 'Rest day'}` } }
            },
            scales: {
                x: { ticks: { color: CHART_DEFAULTS.textColor, maxRotation: 45, maxTicksLimit: 15 }, grid: { display: false } },
                y: { min: 30, max: 100, ticks: { color: CHART_DEFAULTS.textColor, callback: v => v + '%' }, grid: { color: CHART_DEFAULTS.gridColor } }
            }
        }
    });

    // Questions per day bar chart
    destroyChart('trackerQPerDay');
    charts.trackerQPerDay = new Chart(document.getElementById('tracker-qperday-chart'), {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Questions Completed',
                data: qPerDay,
                backgroundColor: qPerDay.map(q => q >= 40 ? COLORS.green : q >= 20 ? COLORS.blue : COLORS.yellow),
                borderRadius: 3,
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { color: CHART_DEFAULTS.textColor, maxRotation: 45, maxTicksLimit: 15 }, grid: { display: false } },
                y: { ticks: { color: CHART_DEFAULTS.textColor }, grid: { color: CHART_DEFAULTS.gridColor } }
            }
        }
    });

    // Cumulative progress + remaining
    destroyChart('trackerCumulative');
    charts.trackerCumulative = new Chart(document.getElementById('tracker-cumulative-chart'), {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Questions Completed (Cumulative)',
                    data: cumulativeData,
                    borderColor: COLORS.green,
                    backgroundColor: COLORS.green + '15',
                    borderWidth: 2,
                    fill: true,
                    pointRadius: 2,
                },
                {
                    label: 'Questions Remaining',
                    data: remaining,
                    borderColor: COLORS.red,
                    backgroundColor: COLORS.red + '10',
                    borderWidth: 2,
                    fill: true,
                    pointRadius: 2,
                }
            ]
        },
        options: {
            responsive: true,
            plugins: { legend: { position: 'bottom', labels: { color: CHART_DEFAULTS.textColor } } },
            scales: {
                x: { ticks: { color: CHART_DEFAULTS.textColor, maxRotation: 45, maxTicksLimit: 15 }, grid: { display: false } },
                y: { ticks: { color: CHART_DEFAULTS.textColor }, grid: { color: CHART_DEFAULTS.gridColor } }
            }
        }
    });

    // Score vs Volume scatter
    const scatterData = trackerData
        .filter(d => d.pctCorrect !== null)
        .map(d => ({ x: d.qCompleted, y: d.pctCorrect }));

    destroyChart('trackerScatter');
    charts.trackerScatter = new Chart(document.getElementById('tracker-scatter-chart'), {
        type: 'scatter',
        data: {
            datasets: [{
                label: 'Score vs Volume',
                data: scatterData,
                backgroundColor: COLORS.purple + '80',
                borderColor: COLORS.purple,
                pointRadius: 5,
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: ctx => `${ctx.raw.x} questions → ${ctx.raw.y}% correct` } }
            },
            scales: {
                x: { title: { display: true, text: 'Questions/Day', color: CHART_DEFAULTS.textColor }, ticks: { color: CHART_DEFAULTS.textColor }, grid: { color: CHART_DEFAULTS.gridColor } },
                y: { title: { display: true, text: '% Correct', color: CHART_DEFAULTS.textColor }, min: 30, max: 100, ticks: { color: CHART_DEFAULTS.textColor, callback: v => v + '%' }, grid: { color: CHART_DEFAULTS.gridColor } }
            }
        }
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

    const entry = {
        type: 'missed-question',
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

    const entry = {
        type: 'im-tracker',
        date: dateFormatted,
        qCompleted: parseInt(document.getElementById('tracker-q-completed').value) || 0,
        pctCorrect: document.getElementById('tracker-pct-correct').value + '%',
        qRemaining: parseInt(document.getElementById('tracker-q-remaining').value) || 0,
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
            if (!trackerData.length) {
                setConclusion('conclusion-im-tracker', 'Key Takeaway', '<p>No tracker data available yet.</p>');
                break;
            }
            const validScores = trackerData.map(d => d.pctCorrect).filter(v => v !== null);
            const avgScore = validScores.length ? (validScores.reduce((a, b) => a + b, 0) / validScores.length).toFixed(1) : '0';
            const recentScores = validScores.slice(-7);
            const earlyScores = validScores.slice(0, 7);
            const recentAvg = recentScores.length ? (recentScores.reduce((a, b) => a + b, 0) / recentScores.length).toFixed(1) : '0';
            const earlyAvg = earlyScores.length ? (earlyScores.reduce((a, b) => a + b, 0) / earlyScores.length).toFixed(1) : '0';
            const improving = parseFloat(recentAvg) > parseFloat(earlyAvg);
            const diff = Math.abs(parseFloat(recentAvg) - parseFloat(earlyAvg)).toFixed(1);
            const totalQ = trackerData.reduce((s, d) => s + d.qCompleted, 0);
            const lastRemaining = trackerData[trackerData.length - 1]?.qRemaining ?? 0;
            setConclusion('conclusion-im-tracker', 'Key Takeaway',
                `<p>Over <strong>${trackerData.length} study days</strong>, you completed <strong>${totalQ} questions</strong> with an overall average of <strong>${avgScore}%</strong>. ` +
                `Your score has <strong>${improving ? 'improved' : 'declined'} by ${diff} percentage points</strong> comparing your first week (${earlyAvg}%) to your most recent week (${recentAvg}%).</p>` +
                `<p>${lastRemaining === 0 ? 'You have completed the entire IM question bank — great work!' : `You have <strong>${lastRemaining} questions remaining</strong> in the bank.`}</p>` +
                `<div class="takeaway">${improving ? 'Your scores are trending upward — the practice is working. Keep the current pace and focus on weak areas identified in other tabs.' : 'Your recent scores are lower than your early scores. Consider whether you are rushing through questions or if you need to revisit foundational content in your weakest systems.'}</div>`
            );
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
            const biasCount = (errorCounts['Anchoring Bias'] || 0) + (errorCounts['Premature conclusion'] || 0);
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
                setConclusion('conclusion-repeat-topics', 'Key Takeaway', '<p>No repeat topics found yet. As you log more missed questions, topics that come up multiple times will appear here.</p>');
                break;
            }
            const topRepeat = repeats[0];
            const multiSystemRepeats = repeats.filter(t => t.systems.size > 1);
            setConclusion('conclusion-repeat-topics', 'Key Takeaway',
                `<p><strong>${repeats.length} topics</strong> have been missed 2 or more times. The most repeated is <strong>${topRepeat.topic}</strong> (${topRepeat.count} times across ${[...topRepeat.shelves].join(', ')}). ` +
                `${multiSystemRepeats.length > 0 ? `<strong>${multiSystemRepeats.length}</strong> repeat topics appear across multiple systems, suggesting foundational concept gaps rather than isolated misses.` : ''}</p>` +
                `<p>These repeat topics represent your <strong>highest-yield flashcard targets</strong> — they are persistent gaps that will not self-correct without deliberate review.</p>` +
                `<div class="takeaway">Make an Anki card for every topic on this list. Review the notes and strategies from each miss to understand the pattern. These are the questions most likely to appear on your exam in some form.</div>`
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
