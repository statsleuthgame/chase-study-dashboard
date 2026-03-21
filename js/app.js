// ============================================================
// Step 2 CK Study Dashboard - Main Application
// ============================================================

const SHEET_ID = 'REDACTED_SHEET_ID';
const SHEET_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv`;

// *** REPLACE THIS after deploying the Google Apps Script ***
let APPS_SCRIPT_URL = localStorage.getItem('appsScriptUrl') || '';

const COLORS = {
    blue: '#3b82f6',
    red: '#ef4444',
    yellow: '#f59e0b',
    green: '#22c55e',
    purple: '#a855f7',
    pink: '#ec4899',
    teal: '#14b8a6',
    orange: '#f97316',
    indigo: '#6366f1',
    cyan: '#06b6d4',
    lime: '#84cc16',
    rose: '#f43f5e',
    slate: '#64748b',
    amber: '#d97706',
    emerald: '#10b981',
    sky: '#0ea5e9',
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

let rawData = [];
let charts = {};

// ============================================================
// Data Fetching
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
        if (!response.ok) throw new Error('Failed to fetch sheet data');
        const csv = await response.text();
        const rows = parseCSV(csv);

        // Skip header row, parse data
        const header = rows[0];
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
        document.getElementById('last-updated').textContent = 'Error loading data';
        return [];
    }
}

function normalizeSystem(system) {
    // Normalize case inconsistencies in the data
    const lower = system.toLowerCase();
    const map = {
        'gastrointestinal and nutrition': 'Gastrointestinal and Nutrition',
        'renal, urinary systems and electrolytes': 'Renal, Urinary systems and electrolytes',
        'rheumatology / orthopedics and sports': 'Rheumatology / Orthopedics and Sports',
        'pregnancy, childbirth & puerperium': 'Pregnancy, Childbirth & Puerperium',
        'nervous system': 'Nervous system',
        'pulmonary and critical care': 'Pulmonary and critical care',
        'endocrine, diabetes and metabolism': 'Endocrine, Diabetes and metabolism',
        'cardiovascular system': 'Cardiovascular System',
        'hematology and oncology': 'Hematology and Oncology',
        'infectious diseases': 'Infectious diseases',
        'allergy and immunology': 'Allergy and Immunology',
        'dermatology': 'Dermatology',
        'ear, nose, throat (ent)': 'Ear, nose, throat (ENT)',
        'male reproductive system': 'Male Reproductive System',
        'social sciences (ethics/legal/prof)': 'Social Sciences (Ethics/Legal/Prof)',
        'poisening and environmental exposure': 'Poisening and environmental exposure',
        'miscellaneous': 'Miscellaneous',
    };
    return map[lower] || system;
}

// ============================================================
// Utility Functions
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
        'Knowledge gap': 'knowledge-gap',
        'Anchoring Bias': 'anchoring-bias',
        'Premature conclusion': 'premature-conclusion',
        'Hidden Hook Failure': 'hidden-hook',
        'Right map / wrong order': 'wrong-order',
        'Wrong Algorithm': 'wrong-algorithm',
        'Dumb mistake': 'dumb-mistake',
        'Misunderstood vinnet': 'misunderstood',
    };
    return map[errorType] || '';
}

function destroyChart(name) {
    if (charts[name]) {
        charts[name].destroy();
        delete charts[name];
    }
}

// ============================================================
// Navigation
// ============================================================

document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const section = link.dataset.section;
        document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
        document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
        document.getElementById(section).classList.add('active');
        link.classList.add('active');
    });
});

// ============================================================
// Overview Section
// ============================================================

function renderOverview() {
    const errorCounts = countBy(rawData, 'errorType');
    const shelfCounts = countBy(rawData, 'shelf');
    const systemCounts = countBy(rawData, 'system');
    const sortedErrors = sortedEntries(errorCounts);
    const sortedSystems = sortedEntries(systemCounts);

    document.getElementById('total-entries').textContent = rawData.length;
    document.getElementById('total-shelves').textContent = Object.keys(shelfCounts).length;
    document.getElementById('top-error-type').textContent = sortedErrors[0]?.[0] || '--';
    document.getElementById('weakest-system').textContent = sortedSystems[0]?.[0] || '--';

    // Error type doughnut
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
            plugins: {
                legend: { position: 'right', labels: { color: '#94a3b8', font: { size: 12 } } }
            }
        }
    });

    // Shelf bar chart
    const shelfEntries = sortedEntries(shelfCounts);
    destroyChart('overviewShelf');
    charts.overviewShelf = new Chart(document.getElementById('overview-shelf-chart'), {
        type: 'bar',
        data: {
            labels: shelfEntries.map(e => e[0]),
            datasets: [{
                label: 'Missed Questions',
                data: shelfEntries.map(e => e[1]),
                backgroundColor: PALETTE.slice(0, shelfEntries.length),
                borderRadius: 6,
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { color: '#94a3b8' }, grid: { display: false } },
                y: { ticks: { color: '#94a3b8' }, grid: { color: '#334155' } }
            }
        }
    });

    // System horizontal bar
    destroyChart('overviewSystem');
    charts.overviewSystem = new Chart(document.getElementById('overview-system-chart'), {
        type: 'bar',
        data: {
            labels: sortedSystems.map(e => e[0]),
            datasets: [{
                label: 'Missed Questions',
                data: sortedSystems.map(e => e[1]),
                backgroundColor: COLORS.blue,
                borderRadius: 4,
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { color: '#94a3b8' }, grid: { color: '#334155' } },
                y: { ticks: { color: '#94a3b8', font: { size: 11 } }, grid: { display: false } }
            }
        }
    });
}

// ============================================================
// Error Analysis Section
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
            plugins: {
                legend: { position: 'bottom', labels: { color: '#94a3b8', padding: 12 } }
            }
        }
    });

    // Stacked bar: error types by shelf
    const shelves = [...new Set(rawData.map(d => d.shelf))].sort();
    const errorTypes = sortedErrors.map(e => e[0]);
    const datasets = errorTypes.map(errorType => ({
        label: errorType,
        data: shelves.map(shelf =>
            rawData.filter(d => d.shelf === shelf && d.errorType === errorType).length
        ),
        backgroundColor: ERROR_COLORS[errorType] || COLORS.slate,
        borderRadius: 2,
    }));

    destroyChart('errorByShelf');
    charts.errorByShelf = new Chart(document.getElementById('error-by-shelf-chart'), {
        type: 'bar',
        data: { labels: shelves, datasets },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 10 } } }
            },
            scales: {
                x: { stacked: true, ticks: { color: '#94a3b8' }, grid: { display: false } },
                y: { stacked: true, ticks: { color: '#94a3b8' }, grid: { color: '#334155' } }
            }
        }
    });

    // Insight cards
    const container = document.getElementById('error-insights');
    container.innerHTML = sortedErrors.map(([type, count]) => {
        const pct = ((count / rawData.length) * 100).toFixed(1);
        const topSystems = rawData.filter(d => d.errorType === type);
        const systemCounts = countBy(topSystems, 'system');
        const topSystem = sortedEntries(systemCounts)[0];
        return `
            <div class="insight-card">
                <h4>${type}</h4>
                <p class="count">${count} <span style="font-size:0.8rem;color:#94a3b8">(${pct}%)</span></p>
                <p>Most common in: <strong>${topSystem ? topSystem[0] : 'N/A'}</strong> (${topSystem ? topSystem[1] : 0} times)</p>
            </div>
        `;
    }).join('');
}

// ============================================================
// Systems Breakdown Section
// ============================================================

function renderSystems() {
    const systemCounts = countBy(rawData, 'system');
    const sorted = sortedEntries(systemCounts);

    // Bar chart
    destroyChart('systemBar');
    charts.systemBar = new Chart(document.getElementById('system-bar-chart'), {
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
                x: { ticks: { color: '#94a3b8' }, grid: { color: '#334155' } },
                y: { ticks: { color: '#94a3b8', font: { size: 11 } }, grid: { display: false } }
            }
        }
    });

    // Error type breakdown per system (stacked bar)
    const systems = sorted.map(e => e[0]);
    const errorTypes = [...new Set(rawData.map(d => d.errorType))];
    const datasets = errorTypes.map(errorType => ({
        label: errorType,
        data: systems.map(system =>
            rawData.filter(d => d.system === system && d.errorType === errorType).length
        ),
        backgroundColor: ERROR_COLORS[errorType] || COLORS.slate,
        borderRadius: 2,
    }));

    destroyChart('systemErrorHeatmap');
    charts.systemErrorHeatmap = new Chart(document.getElementById('system-error-heatmap'), {
        type: 'bar',
        data: { labels: systems, datasets },
        options: {
            indexAxis: 'y',
            responsive: true,
            plugins: {
                legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 10 } } }
            },
            scales: {
                x: { stacked: true, ticks: { color: '#94a3b8' }, grid: { color: '#334155' } },
                y: { stacked: true, ticks: { color: '#94a3b8', font: { size: 11 } }, grid: { display: false } }
            }
        }
    });

    // System insight cards
    const container = document.getElementById('system-insights');
    const top5 = sorted.slice(0, 5);
    container.innerHTML = top5.map(([system, count]) => {
        const systemData = rawData.filter(d => d.system === system);
        const errors = countBy(systemData, 'errorType');
        const topError = sortedEntries(errors)[0];
        const categories = countBy(systemData, 'category');
        const topCat = sortedEntries(categories)[0];
        return `
            <div class="insight-card">
                <h4>${system}</h4>
                <p class="count">${count}</p>
                <p>Top error: <strong>${topError[0]}</strong> (${topError[1]})</p>
                <p>Top category: <strong>${topCat[0]}</strong> (${topCat[1]})</p>
            </div>
        `;
    }).join('');
}

// ============================================================
// Shelf Performance Section
// ============================================================

function renderShelves() {
    const shelfCounts = countBy(rawData, 'shelf');
    const sorted = sortedEntries(shelfCounts);

    // Bar chart
    destroyChart('shelfBar');
    charts.shelfBar = new Chart(document.getElementById('shelf-bar-chart'), {
        type: 'bar',
        data: {
            labels: sorted.map(e => e[0]),
            datasets: [{
                label: 'Missed Questions',
                data: sorted.map(e => e[1]),
                backgroundColor: PALETTE.slice(0, sorted.length),
                borderRadius: 6,
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { color: '#94a3b8' }, grid: { display: false } },
                y: { ticks: { color: '#94a3b8' }, grid: { color: '#334155' } }
            }
        }
    });

    // Radar chart - error profile per shelf
    const shelves = sorted.map(e => e[0]);
    const errorTypes = Object.keys(ERROR_COLORS);
    const radarDatasets = shelves.map((shelf, i) => {
        const shelfData = rawData.filter(d => d.shelf === shelf);
        const total = shelfData.length || 1;
        return {
            label: shelf,
            data: errorTypes.map(e =>
                ((shelfData.filter(d => d.errorType === e).length / total) * 100).toFixed(1)
            ),
            borderColor: PALETTE[i],
            backgroundColor: PALETTE[i] + '20',
            pointBackgroundColor: PALETTE[i],
            borderWidth: 2,
        };
    });

    destroyChart('shelfRadar');
    charts.shelfRadar = new Chart(document.getElementById('shelf-radar-chart'), {
        type: 'radar',
        data: { labels: errorTypes, datasets: radarDatasets },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 10 } } }
            },
            scales: {
                r: {
                    ticks: { color: '#94a3b8', backdropColor: 'transparent' },
                    grid: { color: '#334155' },
                    angleLines: { color: '#334155' },
                    pointLabels: { color: '#94a3b8', font: { size: 9 } }
                }
            }
        }
    });

    // Populate shelf selector
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
                x: { ticks: { color: '#94a3b8' }, grid: { color: '#334155' } },
                y: { ticks: { color: '#94a3b8', font: { size: 11 } }, grid: { display: false } }
            }
        }
    });
}

// ============================================================
// Trends & Insights Section
// ============================================================

function renderTrends() {
    const errorCounts = countBy(rawData, 'errorType');
    const systemCounts = countBy(rawData, 'system');
    const sortedErrors = sortedEntries(errorCounts);
    const sortedSystems = sortedEntries(systemCounts);

    // High priority: top 5 system + error combos
    const comboCounts = {};
    rawData.forEach(d => {
        const key = `${d.system} - ${d.errorType}`;
        comboCounts[key] = (comboCounts[key] || 0) + 1;
    });
    const topCombos = sortedEntries(comboCounts).slice(0, 5);
    document.getElementById('high-priority-list').innerHTML = topCombos.map(([combo, count]) =>
        `<li><strong>${combo}</strong> (${count} occurrences)</li>`
    ).join('');

    // Patterns
    const patterns = [];
    // Check if knowledge gap dominates
    const kgPct = ((errorCounts['Knowledge gap'] || 0) / rawData.length * 100).toFixed(0);
    if (kgPct > 30) {
        patterns.push(`Knowledge gaps account for ${kgPct}% of all errors - consider dedicated content review sessions`);
    }
    // Check for bias issues
    const biasPct = (((errorCounts['Anchoring Bias'] || 0) + (errorCounts['Premature conclusion'] || 0)) / rawData.length * 100).toFixed(0);
    if (biasPct > 15) {
        patterns.push(`Cognitive biases (anchoring + premature conclusion) account for ${biasPct}% of errors - practice systematic approach to each question`);
    }
    // Concentrated systems
    const top3Systems = sortedSystems.slice(0, 3);
    const top3Pct = ((top3Systems.reduce((s, e) => s + e[1], 0) / rawData.length) * 100).toFixed(0);
    patterns.push(`Top 3 weakest systems (${top3Systems.map(e => e[0]).join(', ')}) account for ${top3Pct}% of all misses`);

    // Per-shelf dominant error
    const shelves = [...new Set(rawData.map(d => d.shelf))];
    shelves.forEach(shelf => {
        const shelfData = rawData.filter(d => d.shelf === shelf);
        const errors = countBy(shelfData, 'errorType');
        const top = sortedEntries(errors)[0];
        if (top && top[1] >= 5) {
            patterns.push(`${shelf}: "${top[0]}" is the dominant error type (${top[1]} times)`);
        }
    });

    document.getElementById('pattern-list').innerHTML = patterns.map(p => `<li>${p}</li>`).join('');

    // Strategy recommendations
    const strategies = [];
    if ((errorCounts['Knowledge gap'] || 0) > 20) {
        strategies.push('Prioritize content review for high-miss systems using spaced repetition (Anki)');
    }
    if ((errorCounts['Anchoring Bias'] || 0) > 10) {
        strategies.push('Practice reading the ENTIRE vignette before looking at answer choices');
    }
    if ((errorCounts['Premature conclusion'] || 0) > 5) {
        strategies.push('Force yourself to consider all answer choices before selecting - use process of elimination');
    }
    if ((errorCounts['Hidden Hook Failure'] || 0) > 5) {
        strategies.push('Train yourself to identify "hidden hooks" - unusual lab values, subtle exam findings');
    }
    if ((errorCounts['Wrong Algorithm'] || 0) > 5) {
        strategies.push('Review clinical algorithms and decision trees for commonly tested pathways');
    }
    strategies.push('After each block, categorize every miss to track improvement over time');
    strategies.push(`Focus study time on: ${top3Systems.map(e => e[0]).join(', ')}`);

    document.getElementById('strategy-list').innerHTML = strategies.map(s => `<li>${s}</li>`).join('');

    // Heatmap chart: Error type vs System
    const systems = sortedSystems.map(e => e[0]);
    const errorTypes = sortedErrors.map(e => e[0]);

    // Build matrix data for bubble chart
    const bubbleData = [];
    errorTypes.forEach((error, ei) => {
        systems.forEach((system, si) => {
            const count = rawData.filter(d => d.errorType === error && d.system === system).length;
            if (count > 0) {
                bubbleData.push({ x: si, y: ei, r: Math.sqrt(count) * 5, count });
            }
        });
    });

    destroyChart('heatmap');
    charts.heatmap = new Chart(document.getElementById('heatmap-chart'), {
        type: 'bubble',
        data: {
            datasets: [{
                data: bubbleData.map(d => ({ x: d.x, y: d.y, r: d.r })),
                backgroundColor: bubbleData.map(d => {
                    const error = errorTypes[d.y];
                    return (ERROR_COLORS[error] || COLORS.slate) + '80';
                }),
                borderColor: bubbleData.map(d => {
                    const error = errorTypes[d.y];
                    return ERROR_COLORS[error] || COLORS.slate;
                }),
                borderWidth: 1,
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const d = bubbleData[ctx.dataIndex];
                            return `${systems[d.x]} + ${errorTypes[d.y]}: ${d.count}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    type: 'linear',
                    min: -0.5,
                    max: systems.length - 0.5,
                    ticks: {
                        color: '#94a3b8',
                        font: { size: 9 },
                        callback: (val) => systems[val] ? systems[val].substring(0, 20) : '',
                        stepSize: 1,
                    },
                    grid: { color: '#334155' }
                },
                y: {
                    type: 'linear',
                    min: -0.5,
                    max: errorTypes.length - 0.5,
                    ticks: {
                        color: '#94a3b8',
                        font: { size: 10 },
                        callback: (val) => errorTypes[val] || '',
                        stepSize: 1,
                    },
                    grid: { color: '#334155' }
                }
            }
        }
    });
}

// ============================================================
// All Entries Section
// ============================================================

function renderEntries(data) {
    const filtered = data || rawData;
    const tbody = document.getElementById('entries-tbody');
    tbody.innerHTML = filtered.map(d => `
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

    const filterShelf = document.getElementById('filter-shelf');
    const filterSystem = document.getElementById('filter-system');
    const filterError = document.getElementById('filter-error');

    filterShelf.innerHTML = '<option value="">All Shelves</option>' +
        shelves.map(s => `<option value="${s}">${s}</option>`).join('');
    filterSystem.innerHTML = '<option value="">All Systems</option>' +
        systems.map(s => `<option value="${s}">${s}</option>`).join('');
    filterError.innerHTML = '<option value="">All Error Types</option>' +
        errors.map(e => `<option value="${e}">${e}</option>`).join('');
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
// Add Entry Form
// ============================================================

document.getElementById('entry-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msgEl = document.getElementById('form-message');
    const btn = document.getElementById('submit-btn');

    if (!APPS_SCRIPT_URL) {
        // Prompt for the URL
        const url = prompt('Enter your Google Apps Script Web App URL.\n\nSee the setup instructions in SETUP.md to deploy the script.');
        if (url) {
            APPS_SCRIPT_URL = url;
            localStorage.setItem('appsScriptUrl', url);
        } else {
            msgEl.className = 'form-message error';
            msgEl.textContent = 'Apps Script URL is required to add entries. See SETUP.md for instructions.';
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
        const response = await fetch(APPS_SCRIPT_URL, {
            method: 'POST',
            mode: 'no-cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(entry),
        });

        // no-cors means we can't read the response, but the data gets sent
        msgEl.className = 'form-message success';
        msgEl.textContent = 'Entry added successfully! Refreshing data...';
        document.getElementById('entry-form').reset();

        // Refresh data after a short delay
        setTimeout(async () => {
            await fetchData();
            renderAll();
            msgEl.style.display = 'none';
        }, 2000);
    } catch (err) {
        msgEl.className = 'form-message error';
        msgEl.textContent = 'Error adding entry: ' + err.message;
    } finally {
        btn.disabled = false;
        btn.textContent = 'Add Entry';
    }
});

// ============================================================
// Refresh Button
// ============================================================

document.getElementById('refresh-btn').addEventListener('click', async () => {
    const btn = document.getElementById('refresh-btn');
    btn.textContent = 'Loading...';
    btn.disabled = true;
    await fetchData();
    renderAll();
    btn.textContent = 'Refresh Data';
    btn.disabled = false;
});

// ============================================================
// Render All
// ============================================================

function renderAll() {
    renderOverview();
    renderErrorAnalysis();
    renderSystems();
    renderShelves();
    renderTrends();
    populateFilters();
    renderEntries();
}

// ============================================================
// Initialize
// ============================================================

(async function init() {
    await fetchData();
    if (rawData.length > 0) {
        renderAll();
    }
})();
