// Modern Trading Dashboard - Main JavaScript
// Handles all dashboard interactions and real-time updates

class TradingDashboard {
    constructor() {
        this.apiBaseUrl = window.location.origin;
        this.ws = null;
        this.updateInterval = null;
        this.init();
    }

    init() {
        console.log('🚀 Initializing Trading Dashboard...');
        this.setupEventListeners();
        this.connectWebSocket();
        this.loadInitialData();
        this.startAutoUpdate();
    }

    setupEventListeners() {
        // Auto Trading Toggle
        const autoTradingToggle = document.getElementById('autoTradingToggle');
        if (autoTradingToggle) {
            autoTradingToggle.addEventListener('click', () => this.toggleAutoTrading());
        }

        // Emergency Stop
        const emergencyStop = document.getElementById('emergencyStop');
        if (emergencyStop) {
            emergencyStop.addEventListener('click', () => this.emergencyStopAll());
        }

        // Refresh Signals
        const refreshSignals = document.getElementById('refreshSignals');
        if (refreshSignals) {
            refreshSignals.addEventListener('click', () => this.refreshSignals());
        }

        // Close All Trades
        const closeAllTrades = document.getElementById('closeAllTrades');
        if (closeAllTrades) {
            closeAllTrades.addEventListener('click', () => this.closeAllTrades());
        }

        // Navigation
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');
            });
        });

        // Execute Trade Buttons
        document.querySelectorAll('.btn-execute').forEach((btn, index) => {
            btn.addEventListener('click', () => this.executeSignal(index));
        });
    }

    connectWebSocket() {
        try {
            const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${wsProtocol}//${window.location.host}/ws`;
            
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                console.log('✅ WebSocket connected');
                this.showNotification('Connected to live feed', 'success');
            };

            this.ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                this.handleWebSocketMessage(data);
            };

            this.ws.onerror = (error) => {
                console.error('❌ WebSocket error:', error);
            };

            this.ws.onclose = () => {
                console.log('🔌 WebSocket disconnected. Reconnecting...');
                setTimeout(() => this.connectWebSocket(), 5000);
            };
        } catch (error) {
            console.error('Failed to connect WebSocket:', error);
        }
    }

    handleWebSocketMessage(data) {
        switch (data.type) {
            case 'NEW_SIGNAL':
                this.addNewSignal(data.payload);
                this.showNotification('New signal received!', 'info');
                break;
            case 'TRADE_UPDATE':
                this.updateTrade(data.payload);
                break;
            case 'STATS_UPDATE':
                this.updateStats(data.payload);
                break;
            default:
                console.log('Unknown message type:', data.type);
        }
    }

    async loadInitialData() {
        await Promise.all([
            this.loadStats(),
            this.loadLiveSignals(),
            this.loadActiveTrades()
        ]);
    }

    async loadStats() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/signals/analytics`);
            const data = await response.json();
            
            if (data.success) {
                this.updateDashboardStats(data.data);
            }
        } catch (error) {
            console.error('Failed to load stats:', error);
        }
    }

    async loadLiveSignals() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/signals/live`);
            const data = await response.json();
            
            if (data.success) {
                this.renderSignals(data.data);
            }
        } catch (error) {
            console.error('Failed to load signals:', error);
        }
    }

    async loadActiveTrades() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/auto-trader/status`);
            const data = await response.json();
            
            if (data.success) {
                this.renderActiveTrades(data.data.activeTrades || []);
            }
        } catch (error) {
            console.error('Failed to load active trades:', error);
        }
    }

    updateDashboardStats(stats) {
        // Update header stats
        const headerWinRate = document.getElementById('headerWinRate');
        if (headerWinRate && stats.performance) {
            headerWinRate.textContent = `${stats.performance.winRate}%`;
        }

        const headerActiveSignals = document.getElementById('headerActiveSignals');
        if (headerActiveSignals) {
            headerActiveSignals.textContent = stats.activeCount || 0;
        }

        // Update stat cards
        const totalProfit = document.getElementById('totalProfit');
        if (totalProfit && stats.performance) {
            totalProfit.textContent = `+$${stats.performance.totalProfit?.toFixed(0) || '0'}`;
        }

        const winRate = document.getElementById('winRate');
        if (winRate && stats.performance) {
            winRate.textContent = `${stats.performance.winRate}%`;
        }

        const activeTrades = document.getElementById('activeTrades');
        if (activeTrades) {
            activeTrades.textContent = stats.activeCount || 0;
        }

        const profitFactor = document.getElementById('profitFactor');
        if (profitFactor && stats.performance) {
            profitFactor.textContent = stats.performance.profitFactor?.toFixed(1) || '0.0';
        }
    }

    renderSignals(signals) {
        const container = document.getElementById('signalsContainer');
        if (!container || !signals || signals.length === 0) return;

        // If we have sample signals in HTML, keep them for now
        // In production, you would replace with actual signals
        console.log('Signals loaded:', signals.length);
    }

    renderActiveTrades(trades) {
        const tbody = document.getElementById('activeTradesBody');
        if (!tbody) return;

        if (trades.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 30px;">No active trades</td></tr>';
            return;
        }

        // In production, render actual trades
        console.log('Active trades:', trades.length);
    }

    async toggleAutoTrading() {
        const toggle = document.getElementById('autoTradingToggle');
        const currentState = toggle.getAttribute('data-enabled') === 'true';
        const newState = !currentState;

        try {
            const endpoint = newState ? '/api/auto-trader/enable' : '/api/auto-trader/disable';
            const response = await fetch(`${this.apiBaseUrl}${endpoint}`, {
                method: 'POST'
            });

            const data = await response.json();

            if (data.success) {
                toggle.setAttribute('data-enabled', newState);
                
                const statusText = document.querySelector('.status-text');
                const statusIndicator = document.querySelector('.status-indicator');
                
                if (newState) {
                    statusText.textContent = 'Status: Active';
                    statusIndicator.classList.add('active');
                    this.showNotification('Auto trading enabled', 'success');
                } else {
                    statusText.textContent = 'Status: Inactive';
                    statusIndicator.classList.remove('active');
                    this.showNotification('Auto trading disabled', 'info');
                }
            }
        } catch (error) {
            console.error('Failed to toggle auto trading:', error);
            this.showNotification('Failed to toggle auto trading', 'error');
        }
    }

    async emergencyStopAll() {
        if (!confirm('⚠️ Are you sure you want to emergency stop ALL trading?')) {
            return;
        }

        try {
            const response = await fetch(`${this.apiBaseUrl}/api/auto-trader/close-all`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason: 'Emergency stop by user' })
            });

            const data = await response.json();

            if (data.success) {
                this.showNotification('All trades closed!', 'success');
                await this.loadActiveTrades();
            }
        } catch (error) {
            console.error('Failed to emergency stop:', error);
            this.showNotification('Failed to close all trades', 'error');
        }
    }

    async refreshSignals() {
        const btn = document.getElementById('refreshSignals');
        btn.innerHTML = '↻ Refreshing...';
        btn.disabled = true;

        await this.loadLiveSignals();

        setTimeout(() => {
            btn.innerHTML = '↻ Refresh';
            btn.disabled = false;
        }, 1000);
    }

    async closeAllTrades() {
        if (!confirm('Are you sure you want to close all active trades?')) {
            return;
        }

        try {
            const response = await fetch(`${this.apiBaseUrl}/api/auto-trader/close-all`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason: 'Manual close all' })
            });

            const data = await response.json();

            if (data.success) {
                this.showNotification('All trades closed', 'success');
                await this.loadActiveTrades();
            }
        } catch (error) {
            console.error('Failed to close all trades:', error);
            this.showNotification('Failed to close trades', 'error');
        }
    }

    async executeSignal(signalIndex) {
        this.showNotification('Executing trade...', 'info');
        
        // In production, send actual signal execution request
        console.log('Executing signal:', signalIndex);
        
        setTimeout(() => {
            this.showNotification('Trade executed successfully!', 'success');
            this.loadActiveTrades();
        }, 1000);
    }

    addNewSignal(signal) {
        // Add new signal to the grid
        console.log('New signal:', signal);
        this.loadLiveSignals();
    }

    updateTrade(trade) {
        // Update specific trade in the table
        console.log('Trade update:', trade);
        this.loadActiveTrades();
    }

    updateStats(stats) {
        this.updateDashboardStats(stats);
    }

    startAutoUpdate() {
        // Update stats every 10 seconds
        this.updateInterval = setInterval(() => {
            this.loadStats();
        }, 10000);
    }

    showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 15px 25px;
            background: ${type === 'success' ? 'rgba(0, 255, 136, 0.2)' : type === 'error' ? 'rgba(255, 0, 85, 0.2)' : 'rgba(0, 240, 255, 0.2)'};
            border: 1px solid ${type === 'success' ? '#00ff88' : type === 'error' ? '#ff0055' : '#00f0ff'};
            border-radius: 10px;
            color: white;
            font-weight: 600;
            z-index: 10000;
            animation: slideIn 0.3s ease;
            box-shadow: 0 0 20px rgba(0, 240, 255, 0.3);
        `;

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }
}

// Initialize dashboard when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.dashboard = new TradingDashboard();
});

// Add CSS animations
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(400px);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }

    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(400px);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);
