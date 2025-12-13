// Trading Dashboard Charts
// Handles all chart visualizations

class DashboardCharts {
    constructor() {
        this.charts = {};
        this.init();
    }

    init() {
        // Wait for Chart.js to be loaded or use canvas directly
        this.createPerformanceChart();
        this.createMiniCharts();
    }

    createPerformanceChart() {
        const canvas = document.getElementById('performanceChart');
        if (!canvas) {return;}

        const ctx = canvas.getContext('2d');
        
        // Sample data - in production, fetch real data
        const data = this.generateSampleEquityCurve();
        
        this.drawLineChart(ctx, data, {
            color: '#00f0ff',
            gradient: true,
            fill: true
        });
    }

    createMiniCharts() {
        const profitChart = document.getElementById('profitChart');
        if (profitChart) {
            this.drawSparkline(profitChart, this.generateSampleSparkline());
        }
    }

    generateSampleEquityCurve() {
        // Generate sample equity curve data
        const points = 30;
        const data = [];
        let value = 10000;

        for (let i = 0; i < points; i++) {
            value += (Math.random() - 0.3) * 500;
            value = Math.max(10000, value);
            data.push(value);
        }

        return data;
    }

    generateSampleSparkline() {
        // Generate sample sparkline data
        const points = 20;
        const data = [];

        for (let i = 0; i < points; i++) {
            data.push(Math.random() * 100 + 50);
        }

        return data;
    }

    drawLineChart(ctx, data, options = {}) {
        const canvas = ctx.canvas;
        const width = canvas.width = canvas.offsetWidth;
        const height = canvas.height = canvas.offsetHeight;

        // Clear canvas
        ctx.clearRect(0, 0, width, height);

        if (!data || data.length === 0) {return;}

        // Calculate scaling
        const padding = 40;
        const chartWidth = width - padding * 2;
        const chartHeight = height - padding * 2;
        
        const minValue = Math.min(...data);
        const maxValue = Math.max(...data);
        const valueRange = maxValue - minValue;

        const pointSpacing = chartWidth / (data.length - 1);

        // Draw gradient background if enabled
        if (options.gradient) {
            const gradient = ctx.createLinearGradient(0, padding, 0, height - padding);
            gradient.addColorStop(0, 'rgba(0, 240, 255, 0.2)');
            gradient.addColorStop(1, 'rgba(0, 240, 255, 0)');

            ctx.beginPath();
            ctx.moveTo(padding, height - padding);

            data.forEach((value, index) => {
                const x = padding + index * pointSpacing;
                const y = height - padding - ((value - minValue) / valueRange) * chartHeight;
                
                if (index === 0) {
                    ctx.lineTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            });

            ctx.lineTo(width - padding, height - padding);
            ctx.closePath();
            ctx.fillStyle = gradient;
            ctx.fill();
        }

        // Draw line
        ctx.beginPath();
        ctx.strokeStyle = options.color || '#00f0ff';
        ctx.lineWidth = 3;
        ctx.shadowBlur = 10;
        ctx.shadowColor = options.color || '#00f0ff';

        data.forEach((value, index) => {
            const x = padding + index * pointSpacing;
            const y = height - padding - ((value - minValue) / valueRange) * chartHeight;
            
            if (index === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });

        ctx.stroke();

        // Draw points
        data.forEach((value, index) => {
            const x = padding + index * pointSpacing;
            const y = height - padding - ((value - minValue) / valueRange) * chartHeight;
            
            ctx.beginPath();
            ctx.arc(x, y, 4, 0, Math.PI * 2);
            ctx.fillStyle = options.color || '#00f0ff';
            ctx.shadowBlur = 15;
            ctx.fill();
        });

        // Draw axes
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.lineWidth = 1;

        // Y-axis
        ctx.beginPath();
        ctx.moveTo(padding, padding);
        ctx.lineTo(padding, height - padding);
        ctx.stroke();

        // X-axis
        ctx.beginPath();
        ctx.moveTo(padding, height - padding);
        ctx.lineTo(width - padding, height - padding);
        ctx.stroke();

        // Draw labels
        ctx.fillStyle = '#b0b0c8';
        ctx.font = '12px "Inter", sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(`$${maxValue.toFixed(0)}`, padding - 10, padding + 5);
        ctx.fillText(`$${minValue.toFixed(0)}`, padding - 10, height - padding + 5);
    }

    drawSparkline(element, data) {
        if (!element) {return;}

        // Create canvas for sparkline
        const canvas = document.createElement('canvas');
        canvas.width = 100;
        canvas.height = 30;
        canvas.style.width = '100%';
        canvas.style.height = '30px';
        element.appendChild(canvas);

        const ctx = canvas.getContext('2d');
        const width = 100;
        const height = 30;

        const min = Math.min(...data);
        const max = Math.max(...data);
        const range = max - min;
        const pointSpacing = width / (data.length - 1);

        // Draw line
        ctx.beginPath();
        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 2;
        ctx.shadowBlur = 5;
        ctx.shadowColor = '#00f0ff';

        data.forEach((value, index) => {
            const x = index * pointSpacing;
            const y = height - ((value - min) / range) * height;
            
            if (index === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });

        ctx.stroke();
    }

    updateChart(chartId, newData) {
        if (this.charts[chartId]) {
            // Update chart with new data
            console.log('Updating chart:', chartId);
        }
    }
}

// Initialize charts when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.dashboardCharts = new DashboardCharts();
});
