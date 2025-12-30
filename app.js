/**
 * Tax Gain Harvester v2.0
 * - Auto file detection via regex
 * - ELSS 3-year lock-in handling
 * - Optimized LTCG harvesting
 */

// ============================================
// Constants
// ============================================

const LTCG_EXEMPTION_LIMIT = 125000;
const ELSS_LOCKIN_YEARS = 3;
const LTCG_HOLDING_MONTHS = 12;

// File detection patterns
const FILE_PATTERNS = {
    'mf-holdings': /^Mutual_Funds_\d+_[\d-]+_[\d-]+\.xlsx$/i,
    'mf-capital-gains': /^Mutual_Funds_Capital_Gains_Report_[\d-]+_[\d-]+\.xlsx$/i,
    'mf-order-history': /^Mutual_Funds_Order_History_[\d-]+_[\d-]+\.xlsx$/i,
    'stock-holdings': /^Stocks_Holdings_Statement_\d+_[\d-]+\.xlsx$/i,
    'stock-capital-gains': /^Stocks_Capital_Gains_Report_\d+_[\d-]+_[\d-]+\.xlsx$/i
};

// Data storage
const appData = {
    mfHoldings: [],
    mfCapitalGains: [],
    mfOrderHistory: [],
    stockHoldings: [],
    stockCapitalGains: [],
    filesLoaded: {
        'mf-holdings': false,
        'mf-capital-gains': false,
        'mf-order-history': false,
        'stock-holdings': false,
        'stock-capital-gains': false
    },
    currentFilter: 'both', // 'mf', 'stock', or 'both'
    remainingExemption: 0
};

// ============================================
// File Upload with Auto Detection
// ============================================

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');

// Drag and drop events
dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
});

dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
});

dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    handleFiles(e.dataTransfer.files);
});

fileInput.addEventListener('change', (e) => {
    handleFiles(e.target.files);
});

function detectFileType(filename) {
    for (const [type, pattern] of Object.entries(FILE_PATTERNS)) {
        if (pattern.test(filename)) {
            return type;
        }
    }
    return null;
}

async function handleFiles(files) {
    for (const file of files) {
        const fileType = detectFileType(file.name);

        if (!fileType) {
            console.log(`Unrecognized file: ${file.name}`);
            continue;
        }

        try {
            const data = await readExcelFile(file);

            switch (fileType) {
                case 'mf-holdings':
                    appData.mfHoldings = parseMFHoldings(data);
                    break;
                case 'mf-capital-gains':
                    appData.mfCapitalGains = parseMFCapitalGains(data);
                    break;
                case 'mf-order-history':
                    appData.mfOrderHistory = parseMFOrderHistory(data);
                    break;
                case 'stock-holdings':
                    appData.stockHoldings = parseStockHoldings(data);
                    break;
                case 'stock-capital-gains':
                    appData.stockCapitalGains = parseStockCapitalGains(data);
                    break;
            }

            // Update UI status
            appData.filesLoaded[fileType] = true;
            updateFileStatus(fileType, file.name);

        } catch (error) {
            console.error(`Error processing ${file.name}:`, error);
        }
    }

    updateCalculateButton();
}

function updateFileStatus(fileType, filename) {
    const item = document.querySelector(`.file-status-item[data-type="${fileType}"]`);
    if (item) {
        item.classList.add('loaded');
        item.querySelector('.status-icon').textContent = '✅';
        item.querySelector('.status-file').textContent = filename.slice(0, 25) + (filename.length > 25 ? '...' : '');
    }
}

function readExcelFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const workbook = XLSX.read(e.target.result, { type: 'binary' });
                const result = {};
                workbook.SheetNames.forEach(sheetName => {
                    result[sheetName] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });
                });
                resolve(result);
            } catch (error) {
                reject(error);
            }
        };
        reader.onerror = reject;
        reader.readAsBinaryString(file);
    });
}

function updateCalculateButton() {
    const btn = document.getElementById('calculate-btn');
    // Order history is optional - only require core 4 files
    const requiredFiles = ['mf-holdings', 'mf-capital-gains', 'stock-holdings', 'stock-capital-gains'];
    const allLoaded = requiredFiles.every(f => appData.filesLoaded[f]);
    btn.disabled = !allLoaded;
}

// ============================================
// File Parsers
// ============================================

function parseMFHoldings(data) {
    const holdings = [];
    const sheet = Object.values(data)[0];

    let startRow = -1;
    for (let i = 0; i < sheet.length; i++) {
        if (sheet[i] && sheet[i][0] === 'Scheme Name') {
            startRow = i + 1;
            break;
        }
    }

    if (startRow === -1) return holdings;

    for (let i = startRow; i < sheet.length; i++) {
        const row = sheet[i];
        if (!row || !row[0] || row[0].toString().trim() === '') continue;

        const schemeName = row[0];
        const subCategory = row[3] || '';

        // Detect ELSS funds
        const isELSS = subCategory.toLowerCase().includes('elss') ||
            schemeName.toLowerCase().includes('elss') ||
            schemeName.toLowerCase().includes('tax saver');

        holdings.push({
            schemeName,
            amc: row[1],
            category: row[2],
            subCategory,
            folioNo: row[4],
            source: row[5],
            units: parseFloat(row[6]) || 0,
            investedValue: parseFloat(row[7]) || 0,
            currentValue: parseFloat(row[8]) || 0,
            returns: parseFloat(row[9]) || 0,
            xirr: row[10],
            isELSS
        });
    }

    return holdings;
}

function parseMFCapitalGains(data) {
    const gains = [];
    const sheet = Object.values(data)[0];

    let startRow = -1;
    for (let i = 0; i < sheet.length; i++) {
        if (sheet[i] && sheet[i][0] === 'Scheme Name' && sheet[i][1] === 'Scheme Code') {
            startRow = i + 1;
            break;
        }
    }

    if (startRow === -1) return gains;

    for (let i = startRow; i < sheet.length; i++) {
        const row = sheet[i];
        if (!row || !row[0] || row[0].toString().trim() === '' || row[0] === 'Scheme Name') continue;
        if (row[0].includes('Category') || row[0].includes('Note') || row[0].includes('Disclaimer')) break;

        gains.push({
            schemeName: row[0],
            schemeCode: row[1],
            category: row[2],
            folioNumber: row[3],
            purchaseTransactionId: row[4],
            purchaseDate: parseExcelDate(row[5]),
            matchedQuantity: parseFloat(row[6]) || 0,
            purchasePrice: parseFloat(row[7]) || 0,
            redeemTransactionId: row[8],
            redeemDate: parseExcelDate(row[9]),
            grandfatheredNav: parseFloat(row[10]) || 0,
            redeemPrice: parseFloat(row[11]) || 0,
            stcg: parseFloat(row[12]) || 0,
            ltcg: parseFloat(row[13]) || 0
        });
    }

    return gains;
}

// Parse MF Order History to get purchase dates per scheme
function parseMFOrderHistory(data) {
    const orders = [];
    const sheet = Object.values(data)[0];

    let startRow = -1;
    for (let i = 0; i < sheet.length; i++) {
        if (sheet[i] && sheet[i][0] === 'Scheme Name' && sheet[i][1] === 'Transaction Type') {
            startRow = i + 1;
            break;
        }
    }

    if (startRow === -1) return orders;

    for (let i = startRow; i < sheet.length; i++) {
        const row = sheet[i];
        if (!row || !row[0] || row[0].toString().trim() === '') continue;

        const transactionType = row[1]?.toString().toUpperCase() || '';
        if (transactionType !== 'PURCHASE') continue;

        orders.push({
            schemeName: row[0],
            type: 'PURCHASE',
            units: parseFloat(row[2]) || 0,
            nav: parseFloat(row[3]) || 0,
            amount: parseFloat(row[4]?.toString().replace(/,/g, '')) || 0,
            date: row[5] // Keep as string "DD Mon YYYY"
        });
    }

    return orders;
}

// Get buy date range for a scheme from order history
function getSchemeByDates(schemeName) {
    const purchases = appData.mfOrderHistory.filter(o =>
        o.schemeName.toLowerCase().includes(schemeName.toLowerCase().split(' ')[0]) ||
        schemeName.toLowerCase().includes(o.schemeName.toLowerCase().split(' ')[0])
    );

    if (purchases.length === 0) return null;

    // Sort by date
    const dates = purchases.map(p => p.date).filter(d => d);
    if (dates.length === 0) return null;

    return {
        first: dates[dates.length - 1], // Oldest (list is DESC)
        last: dates[0], // Newest
        count: dates.length
    };
}

function parseStockHoldings(data) {
    const holdings = [];
    const sheet = Object.values(data)[0];

    let startRow = -1;
    for (let i = 0; i < sheet.length; i++) {
        if (sheet[i] && sheet[i][0] === 'Stock Name') {
            startRow = i + 1;
            break;
        }
    }

    if (startRow === -1) return holdings;

    for (let i = startRow; i < sheet.length; i++) {
        const row = sheet[i];
        if (!row || !row[0] || row[0].toString().trim() === '') continue;

        holdings.push({
            stockName: row[0],
            isin: row[1],
            quantity: parseFloat(row[2]) || 0,
            avgBuyPrice: parseFloat(row[3]) || 0,
            buyValue: parseFloat(row[4]) || 0,
            closingPrice: parseFloat(row[5]) || 0,
            closingValue: parseFloat(row[6]) || 0,
            unrealisedPnL: parseFloat(row[7]) || 0
        });
    }

    return holdings;
}

function parseStockCapitalGains(data) {
    const result = {
        intraday: [],
        shortTerm: [],
        longTerm: [],
        summary: {}
    };

    const sheet = Object.values(data)[0];

    for (let i = 0; i < Math.min(30, sheet.length); i++) {
        const row = sheet[i];
        if (!row) continue;
        if (row[0] === 'Short Term P&L') result.summary.shortTermPnL = parseFloat(row[1]) || 0;
        if (row[0] === 'Long Term P&L') result.summary.longTermPnL = parseFloat(row[1]) || 0;
    }

    let currentSection = null;

    for (let i = 0; i < sheet.length; i++) {
        const row = sheet[i];
        if (!row) continue;

        if (row[0] === 'Intraday trades') { currentSection = 'intraday'; continue; }
        if (row[0] === 'Short Term trades') { currentSection = 'shortTerm'; continue; }
        if (row[0] === 'Long Term trades') { currentSection = 'longTerm'; continue; }

        if (currentSection && row[0] && row[0] !== 'Stock name' && !row[0].includes('trades')) {
            const trade = {
                stockName: row[0],
                isin: row[1],
                quantity: parseFloat(row[2]) || 0,
                buyDate: row[3],
                buyPrice: parseFloat(row[4]) || 0,
                buyValue: parseFloat(row[5]) || 0,
                sellDate: row[6],
                sellPrice: parseFloat(row[7]) || 0,
                sellValue: parseFloat(row[8]) || 0,
                realisedPnL: parseFloat(row[9]) || 0
            };

            if (trade.stockName && trade.stockName.trim()) {
                result[currentSection].push(trade);
            }
        }

        if (currentSection && row[0] && row[0].includes('Term') &&
            row[0] !== 'Long Term trades' && row[0] !== 'Short Term trades') {
            currentSection = null;
        }
    }

    return result;
}

function parseExcelDate(value) {
    if (!value) return null;
    if (typeof value === 'string') return value;
    if (typeof value === 'number') {
        const date = new Date((value - 25569) * 86400 * 1000);
        return date.toISOString().split('T')[0];
    }
    return value.toString();
}

// ============================================
// Calculate & Display
// ============================================

document.getElementById('calculate-btn').addEventListener('click', calculateHarvesting);

function calculateHarvesting() {
    // ===== Step 1: Calculate all realized gains/losses =====

    // MF gains (always positive in the report - losses rarely occur)
    const mfLtcg = appData.mfCapitalGains.reduce((sum, g) => sum + Math.max(0, g.ltcg), 0);
    const mfStcg = appData.mfCapitalGains.reduce((sum, g) => sum + Math.max(0, g.stcg), 0);
    const mfLtcl = appData.mfCapitalGains.reduce((sum, g) => sum + Math.abs(Math.min(0, g.ltcg)), 0);
    const mfStcl = appData.mfCapitalGains.reduce((sum, g) => sum + Math.abs(Math.min(0, g.stcg)), 0);

    // Stock gains/losses from summary
    const stockLongPnL = appData.stockCapitalGains.summary?.longTermPnL || 0;
    const stockShortPnL = appData.stockCapitalGains.summary?.shortTermPnL || 0;

    const stockLtcg = Math.max(0, stockLongPnL);
    const stockLtcl = Math.abs(Math.min(0, stockLongPnL));
    const stockStcg = Math.max(0, stockShortPnL);
    const stockStcl = Math.abs(Math.min(0, stockShortPnL));

    // ===== Step 2: Total gains and losses =====
    const totalLtcg = mfLtcg + stockLtcg;
    const totalStcg = mfStcg + stockStcg;
    const totalLtcl = mfLtcl + stockLtcl;
    const totalStcl = mfStcl + stockStcl;

    // ===== Step 3: Apply offset rules =====
    // STCL can offset STCG first, then remaining STCL can offset LTCG
    // LTCL can only offset LTCG

    let netStcg = Math.max(0, totalStcg - totalStcl);
    let remainingStcl = Math.max(0, totalStcl - totalStcg);

    // LTCL offsets LTCG, then remaining STCL also offsets LTCG
    let netLtcg = Math.max(0, totalLtcg - totalLtcl - remainingStcl);

    // ===== Step 4: Apply LTCG exemption =====
    appData.remainingExemption = Math.max(0, LTCG_EXEMPTION_LIMIT - netLtcg);

    // ===== Step 5: Update UI =====
    document.getElementById('total-ltcg').textContent = formatCurrency(totalLtcg);
    document.getElementById('ltcg-breakdown').innerHTML = `MF: ${formatCurrency(mfLtcg)} | Stock: ${formatCurrency(stockLtcg)}`;

    document.getElementById('total-stcg').textContent = formatCurrency(totalStcg);
    document.getElementById('stcg-breakdown').innerHTML = `MF: ${formatCurrency(mfStcg)} | Stock: ${formatCurrency(stockStcg)}`;

    document.getElementById('total-ltcl').textContent = totalLtcl > 0 ? `-${formatCurrency(totalLtcl)}` : '₹0';
    document.getElementById('total-stcl').textContent = totalStcl > 0 ? `-${formatCurrency(totalStcl)}` : '₹0';

    document.getElementById('net-ltcg').textContent = formatCurrency(netLtcg);

    // Show offset info
    let offsetInfo = [];
    if (totalLtcl > 0) offsetInfo.push(`LTCL offset: -${formatCurrency(totalLtcl)}`);
    if (remainingStcl > 0) offsetInfo.push(`STCL offset: -${formatCurrency(remainingStcl)}`);
    document.getElementById('offset-info').textContent = offsetInfo.length > 0 ? offsetInfo.join(' | ') : 'No losses to offset';

    document.getElementById('remaining-exemption').textContent = formatCurrency(appData.remainingExemption);

    // Store for recommendations
    appData.taxBreakdown = { totalLtcg, totalStcg, totalLtcl, totalStcl, netLtcg, netStcg };

    // Render sections
    renderRedeemedMFs();
    renderRedeemedStocks();
    renderCurrentHoldings();
    generateRecommendations();

    // Show results
    document.getElementById('results-section').style.display = 'block';
    document.getElementById('results-section').scrollIntoView({ behavior: 'smooth' });
}

// ============================================
// Render Functions
// ============================================

function renderRedeemedMFs() {
    const tbody = document.getElementById('redeemed-mf-body');

    const grouped = {};
    appData.mfCapitalGains.forEach(g => {
        if (!grouped[g.schemeName]) {
            grouped[g.schemeName] = {
                redeemDate: g.redeemDate,
                units: 0,
                stcg: 0,
                ltcg: 0,
                buyDates: new Set()
            };
        }
        grouped[g.schemeName].units += g.matchedQuantity;
        grouped[g.schemeName].stcg += g.stcg;
        grouped[g.schemeName].ltcg += g.ltcg;
        if (g.purchaseDate) grouped[g.schemeName].buyDates.add(g.purchaseDate);
    });

    if (Object.keys(grouped).length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No MF redemptions this FY</td></tr>';
        return;
    }

    tbody.innerHTML = Object.entries(grouped).map(([name, data]) => {
        const dates = Array.from(data.buyDates).sort();
        let buyDatesDisplay = 'N/A';
        if (dates.length === 1) {
            buyDatesDisplay = dates[0];
        } else if (dates.length > 1) {
            buyDatesDisplay = `${dates[0]} → ${dates[dates.length - 1]} (${dates.length} lots)`;
        }
        return `
        <tr>
            <td>${name}</td>
            <td class="date-range">${buyDatesDisplay}</td>
            <td>${data.redeemDate || 'N/A'}</td>
            <td>${data.units.toFixed(2)}</td>
            <td class="${data.stcg >= 0 ? 'positive' : 'negative'}">${formatCurrency(data.stcg)}</td>
            <td class="${data.ltcg >= 0 ? 'positive' : 'negative'}">${formatCurrency(data.ltcg)}</td>
        </tr>
    `}).join('');
}

function renderRedeemedStocks() {
    const tbody = document.getElementById('redeemed-stocks-body');

    const allTrades = [
        ...appData.stockCapitalGains.shortTerm.map(t => ({ ...t, type: 'Short' })),
        ...appData.stockCapitalGains.longTerm.map(t => ({ ...t, type: 'Long' }))
    ];

    if (allTrades.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No stock sales this FY</td></tr>';
        return;
    }

    tbody.innerHTML = allTrades.slice(0, 30).map(t => `
        <tr>
            <td>${t.stockName}</td>
            <td>${t.buyDate || 'N/A'}</td>
            <td>${t.sellDate || 'N/A'}</td>
            <td>${t.quantity}</td>
            <td>${formatCurrency(t.buyPrice)}</td>
            <td>${formatCurrency(t.sellPrice)}</td>
            <td class="${t.realisedPnL >= 0 ? 'positive' : 'negative'}">${formatCurrency(t.realisedPnL)}</td>
            <td><span class="tag ${t.type.toLowerCase()}">${t.type}</span></td>
        </tr>
    `).join('');
}

function renderCurrentHoldings() {
    // MF Holdings
    const mfBody = document.getElementById('holdings-mf-body');
    const mfWithGains = appData.mfHoldings.filter(h => h.returns > 0).sort((a, b) => b.returns - a.returns);

    if (mfWithGains.length === 0) {
        mfBody.innerHTML = '<tr><td colspan="6" class="empty-state">No MFs with unrealized gains</td></tr>';
    } else {
        mfBody.innerHTML = mfWithGains.map(h => `
            <tr>
                <td>${h.schemeName}${h.isELSS ? ' <span class="tag short">ELSS</span>' : ''}</td>
                <td>${h.units.toFixed(2)}</td>
                <td>${formatCurrency(h.investedValue)}</td>
                <td>${formatCurrency(h.currentValue)}</td>
                <td class="positive">${formatCurrency(h.returns)}</td>
                <td class="positive">${((h.returns / h.investedValue) * 100).toFixed(1)}%</td>
            </tr>
        `).join('');
    }

    // Stock Holdings
    const stockBody = document.getElementById('holdings-stocks-body');
    const stocksWithGains = appData.stockHoldings.filter(h => h.unrealisedPnL > 0).sort((a, b) => b.unrealisedPnL - a.unrealisedPnL);

    if (stocksWithGains.length === 0) {
        stockBody.innerHTML = '<tr><td colspan="6" class="empty-state">No stocks with unrealized gains</td></tr>';
    } else {
        stockBody.innerHTML = stocksWithGains.slice(0, 30).map(h => `
            <tr>
                <td>${h.stockName}</td>
                <td>${h.quantity}</td>
                <td>${formatCurrency(h.avgBuyPrice)}</td>
                <td>${formatCurrency(h.closingPrice)}</td>
                <td class="positive">${formatCurrency(h.unrealisedPnL)}</td>
                <td class="positive">${((h.unrealisedPnL / h.buyValue) * 100).toFixed(1)}%</td>
            </tr>
        `).join('');
    }
}

function generateRecommendations() {
    const container = document.getElementById('recommendation-cards');
    const remainingExemption = appData.remainingExemption;
    const filter = appData.currentFilter;

    if (remainingExemption <= 0) {
        container.innerHTML = `
            <div class="recommendation-card">
                <div class="rec-info">
                    <div class="rec-name">⚠️ LTCG Limit Already Exhausted</div>
                    <div class="rec-type">You've already realized ₹1.25L+ LTCG this FY</div>
                </div>
            </div>
        `;
        document.getElementById('total-ltcg-harvest').textContent = '₹0';
        document.getElementById('total-capital-required').textContent = '₹0';
        return;
    }

    const candidates = [];

    // MF candidates - EXCLUDE ELSS (3-year lock-in)
    if (filter === 'mf' || filter === 'both') {
        appData.mfHoldings.forEach(h => {
            if (h.returns > 0 && !h.isELSS) {
                candidates.push({
                    type: 'MF',
                    name: h.schemeName,
                    totalUnits: h.units,
                    totalGain: h.returns,
                    currentValue: h.currentValue,
                    investedValue: h.investedValue,
                    gainPerUnit: h.returns / h.units,
                    pricePerUnit: h.currentValue / h.units,
                    efficiency: h.returns / h.currentValue
                });
            }
        });
    }

    // Stock candidates
    if (filter === 'stock' || filter === 'both') {
        appData.stockHoldings.forEach(h => {
            if (h.unrealisedPnL > 0) {
                candidates.push({
                    type: 'Stock',
                    name: h.stockName,
                    totalUnits: h.quantity,
                    totalGain: h.unrealisedPnL,
                    currentValue: h.closingValue,
                    investedValue: h.buyValue,
                    gainPerUnit: h.unrealisedPnL / h.quantity,
                    pricePerUnit: h.closingPrice,
                    efficiency: h.unrealisedPnL / h.closingValue
                });
            }
        });
    }

    // Sort by efficiency (highest first)
    candidates.sort((a, b) => b.efficiency - a.efficiency);

    // Select holdings to fill remaining exemption
    const recommendations = [];
    let accumulatedLtcg = 0;
    let totalCapitalRequired = 0;

    for (const c of candidates) {
        if (accumulatedLtcg >= remainingExemption) break;

        const remainingToFill = remainingExemption - accumulatedLtcg;

        let unitsToSell, ltcgFromSale, capitalRequired;

        if (c.totalGain <= remainingToFill) {
            unitsToSell = c.totalUnits;
            ltcgFromSale = c.totalGain;
            capitalRequired = c.currentValue;
        } else {
            unitsToSell = remainingToFill / c.gainPerUnit;
            if (c.type === 'Stock') unitsToSell = Math.floor(unitsToSell);
            ltcgFromSale = unitsToSell * c.gainPerUnit;
            capitalRequired = unitsToSell * c.pricePerUnit;
        }

        if (unitsToSell > 0 && ltcgFromSale > 0) {
            recommendations.push({ ...c, unitsToSell, ltcgFromSale, capitalRequired });
            accumulatedLtcg += ltcgFromSale;
            totalCapitalRequired += capitalRequired;
        }
    }

    // Render
    if (recommendations.length === 0) {
        container.innerHTML = `
            <div class="recommendation-card">
                <div class="rec-info">
                    <div class="rec-name">No Eligible Holdings</div>
                    <div class="rec-type">No non-ELSS holdings with unrealized gains available</div>
                </div>
            </div>
        `;
    } else {
        container.innerHTML = recommendations.map((r, i) => {
            // Get buy dates for MF from order history
            let buyDateInfo = '';
            if (r.type === 'MF') {
                const dates = getSchemeByDates(r.name);
                if (dates) {
                    buyDateInfo = dates.count > 1
                        ? `${dates.first} → ${dates.last}`
                        : dates.first;
                }
            }

            return `
            <div class="recommendation-card">
                <div class="rec-info">
                    <div class="rec-name">${i + 1}. ${r.name}</div>
                    <div class="rec-type">${r.type} • ${(r.efficiency * 100).toFixed(0)}% eff${buyDateInfo ? ` • 📅 ${buyDateInfo}` : ''}</div>
                </div>
                <div class="rec-stat">
                    <div class="label">Sell</div>
                    <div class="value">${r.type === 'MF' ? r.unitsToSell.toFixed(2) + ' units' : r.unitsToSell + ' shares'}</div>
                </div>
                <div class="rec-stat">
                    <div class="label">LTCG</div>
                    <div class="value success">${formatCurrency(r.ltcgFromSale)}</div>
                </div>
                <div class="rec-stat">
                    <div class="label">Capital</div>
                    <div class="value">${formatCurrency(r.capitalRequired)}</div>
                </div>
            </div>
        `}).join('');
    }

    document.getElementById('total-ltcg-harvest').textContent = formatCurrency(accumulatedLtcg);
    document.getElementById('total-capital-required').textContent = formatCurrency(totalCapitalRequired);
}

// ============================================
// Tab Switching
// ============================================

document.querySelectorAll('.tabs').forEach(tabContainer => {
    tabContainer.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.dataset.tab;
            const parent = btn.closest('.data-section');

            parent.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            parent.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            parent.querySelector(`#${tabId}`).classList.add('active');
        });
    });
});

// ============================================
// Asset Filter (MF Only, Stocks Only, Both)
// ============================================

document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const filter = btn.dataset.filter;

        // Update active state
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // Update filter and regenerate recommendations
        appData.currentFilter = filter;
        if (appData.remainingExemption > 0) {
            generateRecommendations();
        }
    });
});

// ============================================
// Utilities
// ============================================

function formatCurrency(value) {
    if (value === null || value === undefined || isNaN(value)) return '₹0';
    const absValue = Math.abs(value);
    const sign = value < 0 ? '-' : '';
    return `${sign}₹${absValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

console.log('Tax Gain Harvester v2.0 loaded');
console.log('Drop your Groww files to auto-detect and calculate.');
