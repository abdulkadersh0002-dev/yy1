class RiskReportService {
  constructor(options = {}) {
    this.tradingEngine = options.tradingEngine;
    this.alertBus = options.alertBus;
    this.logger = options.logger || console;
    this.reportHourUtc = Number.isFinite(options.reportHourUtc) ? options.reportHourUtc : 22;
    this.nowFn = typeof options.nowFn === 'function' ? options.nowFn : () => Date.now();
    this.timer = null;
  }

  start() {
    if (this.timer) {
      return;
    }
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
        await this.sendDailyReport();
      } catch (error) {
        this.logger?.error?.({ err: error }, 'RiskReportService failed to send daily report');
      }
      this.scheduleNextRun();
    }, delay);
  }

  generateReport() {
    const now = new Date(this.nowFn()).toISOString();
    const stats = this.tradingEngine?.getStatistics?.() || {};
    const performance = this.tradingEngine?.getPerformanceMetrics?.() || null;
    const exposures = this.tradingEngine?.calculateCurrencyExposures?.() || {};
    const activeTrades = this.tradingEngine?.activeTrades
      ? Array.from(this.tradingEngine.activeTrades.values())
      : [];
    const topTrades = activeTrades.slice(0, 5).map((trade) => ({
      id: trade.id,
      pair: trade.pair,
      direction: trade.direction,
      positionSize: trade.positionSize,
      pnl: trade.currentPnL || trade.finalPnL || null
    }));

    const priceHealth = this.tradingEngine?.priceDataFetcher?.getHealthStatus?.() || {};
    const alerts = Array.isArray(priceHealth.alerts) ? priceHealth.alerts.slice(0, 6) : [];
    const degradedProviders = Object.entries(priceHealth.rateLimits || {})
      .filter(([, info]) => info.backoffSeconds > 0 || info.remaining === 0)
      .map(([provider, info]) => ({
        provider,
        remaining: info.remaining,
        backoffSeconds: info.backoffSeconds
      }));
    const riskCommand = this.tradingEngine?.getRiskCommandSnapshot?.() || null;

    const accountBalance = this.tradingEngine?.config?.accountBalance ?? null;
    const dailyRiskLimitPct = (this.tradingEngine?.config?.maxDailyRisk ?? 0) * 100;
    const dailyRiskUsedPct = Number.parseFloat(stats.dailyRiskUsed || '0');

    return {
      generatedAt: now,
      accountBalance,
      stats,
      performance,
      exposures,
      activeTradeCount: activeTrades.length,
      topTrades,
      providerHealth: {
        status: priceHealth.status || 'unknown',
        alerts,
        degradedProviders
      },
      risk: {
        dailyRiskLimitPct,
        dailyRiskUsedPct,
        dailyRiskRemainingPct: Number.isFinite(dailyRiskUsedPct)
          ? Math.max(0, dailyRiskLimitPct - dailyRiskUsedPct)
          : null
      },
      riskCommand
    };
  }

  formatReport(report) {
    const lines = [];
    lines.push(`Daily Risk Report | ${report.generatedAt}`);
    if (Number.isFinite(report.accountBalance)) {
      lines.push(
        `Account Balance: ${report.accountBalance.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
      );
    }

    if (report.performance) {
      const drawdown =
        report.performance.maxDrawdownPct != null
          ? `${Math.abs(report.performance.maxDrawdownPct).toFixed(2)}%`
          : 'n/a';
      const cumulative =
        report.performance.cumulativeReturnPct != null
          ? `${report.performance.cumulativeReturnPct.toFixed(2)}%`
          : 'n/a';
      lines.push(`Performance: CumReturn ${cumulative} | Max DD ${drawdown}`);
    }

    lines.push(
      `Trades: Active ${report.activeTradeCount} | Closed ${report.stats.totalTrades || 0}`
    );
    lines.push(
      `Win Rate: ${report.stats.winRate || 0}% | Profit Factor: ${report.stats.profitFactor || 0}`
    );

    if (report.risk.dailyRiskLimitPct != null) {
      const used = Number.isFinite(report.risk.dailyRiskUsedPct)
        ? `${report.risk.dailyRiskUsedPct.toFixed(2)}%`
        : 'n/a';
      const remaining = Number.isFinite(report.risk.dailyRiskRemainingPct)
        ? `${report.risk.dailyRiskRemainingPct.toFixed(2)}%`
        : 'n/a';
      lines.push(
        `Daily Risk: Used ${used} | Remaining ${remaining} of limit ${report.risk.dailyRiskLimitPct.toFixed(2)}%`
      );
    }

    const exposureEntries = Object.entries(report.exposures || {});
    if (exposureEntries.length) {
      const exposureLine = exposureEntries
        .map(([ccy, value]) => `${ccy}:${Number(value).toFixed(0)}`)
        .join(' ');
      lines.push(`Exposures: ${exposureLine}`);
    }

    if (report.providerHealth.alerts?.length) {
      lines.push('Provider Alerts:');
      report.providerHealth.alerts.forEach((alert) => {
        lines.push(` - ${alert}`);
      });
    }

    if (report.topTrades.length) {
      lines.push('Top Trades:');
      report.topTrades.forEach((trade) => {
        const pnl = trade.pnl?.percentage != null ? `${trade.pnl.percentage}%` : 'n/a';
        lines.push(` - ${trade.pair} ${trade.direction} size ${trade.positionSize} pnl ${pnl}`);
      });
    }

    if (report.providerHealth.degradedProviders.length) {
      lines.push('Degraded Providers:');
      report.providerHealth.degradedProviders.forEach((entry) => {
        lines.push(
          ` - ${entry.provider} remaining ${entry.remaining} backoff ${entry.backoffSeconds}s`
        );
      });
    }

    if (report.riskCommand) {
      const rc = report.riskCommand;
      if (rc.currencyLimitBreaches && rc.currencyLimitBreaches.length) {
        lines.push('Currency Limit Breaches:');
        rc.currencyLimitBreaches.forEach((breach) => {
          lines.push(` - ${breach.currency} exposure ${breach.exposure} (limit ${breach.limit})`);
        });
      }
      if (rc.correlation?.correlations?.length) {
        lines.push(
          `Correlation Hotspots: ${rc.correlation.correlations.length} pairs above threshold ${rc.correlation.threshold}`
        );
      }
      if (rc.var && rc.var.ready) {
        const breachLabel = rc.var.guard?.breach ? ' (BREACH)' : '';
        const varValue = Number.isFinite(rc.var.valuePct) ? rc.var.valuePct.toFixed(2) : 'n/a';
        const limitValue = Number.isFinite(rc.var.guard?.limitPct)
          ? rc.var.guard.limitPct.toFixed(2)
          : Number.isFinite(rc.var.limitPct)
            ? rc.var.limitPct.toFixed(2)
            : 'n/a';
        const confidenceLabel = Math.round((rc.var.confidence || 0.95) * 100);
        lines.push(`VaR ${confidenceLabel}%: ${varValue}% limit ${limitValue}%${breachLabel}`);
      }
    }

    return lines.join('\n');
  }

  async sendDailyReport() {
    if (!this.alertBus) {
      return;
    }
    const report = this.generateReport();
    const body = this.formatReport(report);
    await this.alertBus.publish({
      topic: 'daily_risk_report',
      severity: 'info',
      message: 'Daily risk report generated',
      body,
      context: report,
      subject: `Daily Risk Report (${new Date(report.generatedAt).toUTCString()})`,
      channels: ['log', 'slack', 'email', 'webhook']
    });
  }
}

export default RiskReportService;
