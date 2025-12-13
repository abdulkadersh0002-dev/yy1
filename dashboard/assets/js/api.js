// Trading Dashboard API Client
// Handles all API communications

class TradingAPI {
    constructor(baseUrl = '') {
        this.baseUrl = baseUrl || 'http://127.0.0.1:5002';
        this.headers = {
            'Content-Type': 'application/json'
        };
    }

    async request(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;
        
        try {
            const response = await fetch(url, {
                ...options,
                headers: {
                    ...this.headers,
                    ...options.headers
                }
            });

            const data = await response.json();
            return data;
        } catch (error) {
            console.error(`API request failed for ${endpoint}:`, error);
            throw error;
        }
    }

    // Signals API
    async getLiveSignals() {
        return this.request('/api/signals/live');
    }

    async getSignalHistory(params = {}) {
        const queryString = new URLSearchParams(params).toString();
        return this.request(`/api/signals/history?${queryString}`);
    }

    async getSignalAnalytics() {
        return this.request('/api/signals/analytics');
    }

    async getPerformanceByPair() {
        return this.request('/api/signals/performance/by-pair');
    }

    async getQualityAnalysis() {
        return this.request('/api/signals/quality-analysis');
    }

    async getDeliveryStats() {
        return this.request('/api/signals/delivery-stats');
    }

    async subscribeToSignal(signalId) {
        return this.request(`/api/signals/${signalId}/subscribe`, {
            method: 'POST'
        });
    }

    // Auto Trader API
    async getAutoTraderStatus() {
        return this.request('/api/auto-trader/status');
    }

    async enableAutoTrader() {
        return this.request('/api/auto-trader/enable', {
            method: 'POST'
        });
    }

    async disableAutoTrader() {
        return this.request('/api/auto-trader/disable', {
            method: 'POST'
        });
    }

    async closeAllTrades(reason = '') {
        return this.request('/api/auto-trader/close-all', {
            method: 'POST',
            body: JSON.stringify({ reason })
        });
    }

    async updateAutoTraderConfig(config) {
        return this.request('/api/auto-trader/config', {
            method: 'PUT',
            body: JSON.stringify(config)
        });
    }

    // Platform API
    async getPlatformStatus() {
        return this.request('/api/platform/status');
    }

    async getPlatformHealth() {
        return this.request('/api/platform/health');
    }

    // Backtesting API
    async runBacktest(strategy, data) {
        return this.request('/api/backtest/run', {
            method: 'POST',
            body: JSON.stringify({ strategy, data })
        });
    }

    async getBacktestResults(id) {
        return this.request(`/api/backtest/results/${id}`);
    }

    // AI/ML API
    async getAIPrediction(signal, marketData) {
        return this.request('/api/ai/predict', {
            method: 'POST',
            body: JSON.stringify({ signal, marketData })
        });
    }

    async trainAIModel(historicalTrades) {
        return this.request('/api/ai/train', {
            method: 'POST',
            body: JSON.stringify({ historicalTrades })
        });
    }

    async getAIModelStats() {
        return this.request('/api/ai/stats');
    }
}

// Create global API instance
window.tradingAPI = new TradingAPI();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TradingAPI;
}
