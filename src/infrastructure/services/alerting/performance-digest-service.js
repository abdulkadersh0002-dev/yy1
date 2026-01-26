import fs from 'fs/promises';
import path from 'path';

const DEFAULT_REPORT_HOUR_UTC = 21;

const toNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const formatPercent = (value, digits = 2) => {
  const num = toNumber(value);
  return num == null ? '—' : `${num.toFixed(digits)}%`;
};

const formatCurrency = (value, digits = 2) => {
  const num = toNumber(value);
  return num == null ? '—' : `$${num.toFixed(digits)}`;
};

const formatNumber = (value, digits = 2) => {
  const num = toNumber(value);
  return num == null ? '—' : num.toFixed(digits);
};

const safeArray = (value) => (Array.isArray(value) ? value : []);

const ensureDirectory = async (dirPath) => {
  if (!dirPath) {
    return null;
  }
  await fs.mkdir(dirPath, { recursive: true });
  return dirPath;
};

const escapePdfString = (value) =>
  value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/\r?\n/g, ' ');

class PerformanceDigestService {
  constructor(options = {}) {
    this.tradingEngine = options.tradingEngine;
    this.alertBus = options.alertBus;
    this.logger = options.logger || console;
    this.reportHourUtc = Number.isFinite(options.reportHourUtc)
      ? options.reportHourUtc
      : DEFAULT_REPORT_HOUR_UTC;
    this.outputDir = options.outputDir
      ? path.resolve(options.outputDir)
      : path.resolve(process.cwd(), 'reports', 'digests');
    this.includePdf = options.includePdf !== false;
    this.nowFn = typeof options.nowFn === 'function' ? options.nowFn : () => Date.now();
    this.timer = null;
  }

  start() {
    if (this.timer) {
      return;
    }
    this.logger?.info?.('Performance digest service scheduled');
    this.scheduleNextRun();
  }

  stop() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  scheduleNextRun() {
    const now = this.nowFn();
    const nowDate = new Date(now);
    const next = new Date(nowDate);
    if (nowDate.getUTCHours() >= this.reportHourUtc) {
      next.setUTCDate(next.getUTCDate() + 1);
    }
    next.setUTCHours(this.reportHourUtc, 0, 0, 0);
    const delay = Math.max(1000, next.getTime() - now);

    this.timer = setTimeout(async () => {
      this.timer = null;
      try {
        await this.generateAndDispatchDigest();
      } catch (error) {
        this.logger?.error?.({ err: error }, 'PerformanceDigestService failed to generate digest');
      }
      this.scheduleNextRun();
    }, delay);
  }

  async generateAndDispatchDigest() {
    if (!this.tradingEngine) {
      throw new Error('PerformanceDigestService requires a trading engine instance');
    }

    const data = this.collectDigestData();
    const html = this.buildHtmlDigest(data);
    const text = this.buildTextDigest(data);
    const { htmlPath, pdfPath } = await this.writeArtifacts(data.generatedAt, html, text);

    await this.publishDigest(data, text, htmlPath, pdfPath);
  }

  collectDigestData() {
    const generatedAt = new Date(this.nowFn());
    const stats = this.tradingEngine?.getStatistics?.() || {};
    const performance = this.tradingEngine?.getPerformanceMetrics?.() || {};
    const exposures = this.tradingEngine?.calculateCurrencyExposures?.() || {};
    const riskSnapshot = this.tradingEngine?.getRiskCommandSnapshot?.() || null;
    const providerHealth = this.tradingEngine?.priceDataFetcher?.getHealthStatus?.() || {};
    const activeTrades = this.tradingEngine?.activeTrades
      ? Array.from(this.tradingEngine.activeTrades.values())
      : [];
    const tradingHistory = this.tradingEngine?.tradingHistory || [];
    const recentClosed = tradingHistory.slice(-15).reverse();

    return {
      generatedAt,
      stats,
      performance,
      exposures,
      riskSnapshot,
      providerHealth,
      activeTrades,
      recentClosed,
      accountBalance: this.tradingEngine?.config?.accountBalance ?? null
    };
  }

  buildHtmlDigest(data) {
    const generatedAtIso = data.generatedAt.toISOString();
    const exposuresRows =
      Object.entries(data.exposures || {})
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
        .map(
          ([currency, value]) => `
        <tr>
          <td>${currency}</td>
          <td>${formatNumber(value, 0)}</td>
        </tr>`
        )
        .join('') || '<tr><td colspan="2">No active exposure</td></tr>';

    const openTradeRows = safeArray(data.activeTrades).length
      ? data.activeTrades
          .map(
            (trade) => `
          <tr>
            <td>${trade.pair}</td>
            <td>${trade.direction}</td>
            <td>${formatNumber(trade.positionSize, 0)}</td>
            <td>${formatPercent(trade.currentPnL?.percentage)}</td>
            <td>${trade.broker || '—'}</td>
          </tr>`
          )
          .join('')
      : '<tr><td colspan="5">No open trades</td></tr>';

    const closedRows = safeArray(data.recentClosed).length
      ? data.recentClosed
          .slice(0, 10)
          .map(
            (trade) => `
          <tr>
            <td>${trade.pair}</td>
            <td>${trade.direction}</td>
            <td>${formatPercent(trade.finalPnL?.percentage)}</td>
            <td>${trade.closeReason || '—'}</td>
            <td>${trade.broker || '—'}</td>
          </tr>`
          )
          .join('')
      : '<tr><td colspan="5">No recent closed trades</td></tr>';

    const providerAlerts = safeArray(data.providerHealth.alerts).length
      ? data.providerHealth.alerts.map((alert) => `<li>${alert}</li>`).join('')
      : '<li>No active provider alerts</li>';

    const correlation = data.riskSnapshot?.correlation;
    const varInfo = data.riskSnapshot?.var;
    const pnlSummary = data.riskSnapshot?.pnlSummary;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Daily Performance Digest</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; padding: 24px; background: #f3f4f6; color: #1f2933; }
    h1 { margin-bottom: 8px; }
    h2 { margin-top: 32px; color: #27364b; }
    .meta { color: #52606d; margin-bottom: 24px; }
    table { border-collapse: collapse; width: 100%; margin-top: 12px; }
    th, td { border: 1px solid #d9e2ec; padding: 8px; text-align: left; }
    th { background: #e4ebf5; }
    .section { background: #ffffff; border-radius: 8px; padding: 20px; margin-bottom: 24px; box-shadow: 0 1px 4px rgba(15, 23, 42, 0.08); }
    ul { padding-left: 18px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
    .stat-card { background: #f8fafc; border: 1px solid #d9e2ec; border-radius: 8px; padding: 16px; }
    .stat-label { font-size: 0.85rem; color: #52606d; text-transform: uppercase; }
    .stat-value { font-size: 1.3rem; font-weight: bold; color: #1f2933; }
  </style>
</head>
<body>
  <h1>Daily Performance Digest</h1>
  <div class="meta">Generated at ${generatedAtIso}</div>

  <div class="section">
    <h2>Account & Performance</h2>
    <div class="grid">
      <div class="stat-card">
        <div class="stat-label">Account Balance</div>
        <div class="stat-value">${formatCurrency(data.accountBalance)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Cumulative Return</div>
        <div class="stat-value">${formatPercent(data.performance?.cumulativeReturnPct)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Max Drawdown</div>
        <div class="stat-value">${formatPercent(data.performance?.maxDrawdownPct)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Win Rate</div>
        <div class="stat-value">${formatPercent(data.stats?.winRate)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Profit Factor</div>
        <div class="stat-value">${formatNumber(data.stats?.profitFactor)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Trades Closed</div>
        <div class="stat-value">${formatNumber(data.stats?.totalTrades, 0)}</div>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>Risk Snapshot</h2>
    <div class="grid">
      <div class="stat-card">
        <div class="stat-label">Daily Risk Used</div>
        <div class="stat-value">${formatPercent(data.stats?.dailyRiskUsed)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">VaR Breach</div>
        <div class="stat-value">${varInfo?.guard?.breach ? 'YES' : 'No'}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Correlated Clusters</div>
        <div class="stat-value">${correlation?.clusterLoad?.length || 0}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Realised P&L</div>
        <div class="stat-value">${formatCurrency(pnlSummary?.realized)}</div>
      </div>
    </div>

    <h3>Currency Exposure</h3>
    <table>
      <thead>
        <tr><th>Currency</th><th>Exposure</th></tr>
      </thead>
      <tbody>${exposuresRows}</tbody>
    </table>
  </div>

  <div class="section">
    <h2>Open Trades</h2>
    <table>
      <thead>
        <tr><th>Pair</th><th>Direction</th><th>Size</th><th>P&L %</th><th>Broker</th></tr>
      </thead>
      <tbody>${openTradeRows}</tbody>
    </table>

    <h2>Recently Closed</h2>
    <table>
      <thead>
        <tr><th>Pair</th><th>Direction</th><th>P&L %</th><th>Reason</th><th>Broker</th></tr>
      </thead>
      <tbody>${closedRows}</tbody>
    </table>
  </div>

  <div class="section">
    <h2>Provider Health</h2>
    <p>Status: <strong>${data.providerHealth.status || 'unknown'}</strong></p>
    <h3>Alerts</h3>
    <ul>${providerAlerts}</ul>
  </div>
</body>
</html>`;
  }

  buildTextDigest(data) {
    const lines = [];
    lines.push(`Daily Performance Digest | ${data.generatedAt.toISOString()}`);
    lines.push(`Account Balance: ${formatCurrency(data.accountBalance)}`);
    lines.push(`Cumulative Return: ${formatPercent(data.performance?.cumulativeReturnPct)}`);
    lines.push(`Max Drawdown: ${formatPercent(data.performance?.maxDrawdownPct)}`);
    lines.push(
      `Trades Closed: ${formatNumber(data.stats?.totalTrades, 0)} | Win Rate: ${formatPercent(data.stats?.winRate)}`
    );
    lines.push(
      `Profit Factor: ${formatNumber(data.stats?.profitFactor)} | Daily Risk Used: ${formatPercent(data.stats?.dailyRiskUsed)}`
    );

    const exposuresEntries = Object.entries(data.exposures || {});
    if (exposuresEntries.length) {
      lines.push('Exposure by Currency:');
      exposuresEntries
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
        .forEach(([currency, value]) => {
          lines.push(` - ${currency}: ${formatNumber(value, 0)}`);
        });
    }

    const activeCount = safeArray(data.activeTrades).length;
    lines.push(`Open Trades: ${activeCount}`);
    safeArray(data.activeTrades)
      .slice(0, 5)
      .forEach((trade) => {
        lines.push(
          ` - ${trade.pair} ${trade.direction} size ${formatNumber(trade.positionSize, 0)} pnl ${formatPercent(trade.currentPnL?.percentage)}`
        );
      });

    const recentCount = safeArray(data.recentClosed).length;
    lines.push(`Recent Closed Trades: ${recentCount}`);
    safeArray(data.recentClosed)
      .slice(0, 5)
      .forEach((trade) => {
        lines.push(
          ` - ${trade.pair} ${trade.direction} pnl ${formatPercent(trade.finalPnL?.percentage)} reason ${trade.closeReason || 'n/a'}`
        );
      });

    if (data.providerHealth?.alerts?.length) {
      lines.push('Provider Alerts:');
      data.providerHealth.alerts.forEach((alert) => lines.push(` - ${alert}`));
    }

    if (data.riskSnapshot?.var?.guard?.breach) {
      lines.push('⚠️ VaR breach detected; monitor exposure before re-enabling auto-trading.');
    }

    return lines.join('\n');
  }

  async writeArtifacts(generatedAt, html, text) {
    await ensureDirectory(this.outputDir);
    const stamp = this.formatTimestamp(generatedAt);
    const htmlPath = path.join(this.outputDir, `performance-digest-${stamp}.html`);
    const pdfPath = this.includePdf
      ? path.join(this.outputDir, `performance-digest-${stamp}.pdf`)
      : null;

    await fs.writeFile(htmlPath, html, 'utf8');
    if (pdfPath) {
      await this.writePdf(pdfPath, text);
    }

    return { htmlPath, pdfPath };
  }

  formatTimestamp(date) {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    return `${year}${month}${day}-${hours}${minutes}`;
  }

  async writePdf(filePath, text) {
    const lines = (text || '').split(/\r?\n/).map((line) => {
      const trimmed = line.trim();
      return escapePdfString(trimmed.length ? trimmed : ' ');
    });

    const operators = ['BT', '/F1 12 Tf', '12 TL', '1 0 0 1 50 760 Tm'];

    lines.forEach((line, index) => {
      if (index === 0) {
        operators.push(`(${line}) Tj`);
      } else {
        operators.push('T*');
        operators.push(`(${line}) Tj`);
      }
    });
    operators.push('ET');

    const streamContent = operators.join('\n');
    const streamLength = Buffer.byteLength(streamContent, 'utf8');

    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
      `<< /Length ${streamLength} >>\nstream\n${streamContent}\nendstream`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
    ];

    let pdf = '%PDF-1.4\n';
    const offsets = [];
    objects.forEach((object, index) => {
      offsets.push(Buffer.byteLength(pdf, 'utf8'));
      pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });

    const xrefOffset = Buffer.byteLength(pdf, 'utf8');
    pdf += 'xref\n';
    pdf += `0 ${objects.length + 1}\n`;
    pdf += '0000000000 65535 f \n';
    offsets.forEach((offset) => {
      pdf += `${offset.toString().padStart(10, '0')} 00000 n \n`;
    });
    pdf += 'trailer\n';
    pdf += `<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
    pdf += 'startxref\n';
    pdf += `${xrefOffset}\n`;
    pdf += '%%EOF\n';

    await fs.writeFile(filePath, pdf, 'binary');
  }

  async publishDigest(data, textBody, htmlPath, pdfPath) {
    if (!this.alertBus?.publish) {
      this.logger?.warn?.('Performance digest generated but alert bus unavailable');
      return;
    }

    await this.alertBus.publish({
      topic: 'performance_digest',
      severity: 'info',
      message: 'Daily performance digest generated',
      body: textBody,
      subject: `Daily Performance Digest (${data.generatedAt.toUTCString()})`,
      channels: ['log', 'email', 'webhook', 'slack'],
      context: {
        generatedAt: data.generatedAt.toISOString(),
        stats: data.stats,
        performance: data.performance,
        risk: {
          var: data.riskSnapshot?.var,
          correlation: data.riskSnapshot?.correlation,
          pnlSummary: data.riskSnapshot?.pnlSummary
        },
        artifacts: {
          htmlPath,
          pdfPath
        }
      }
    });
  }
}

export default PerformanceDigestService;
