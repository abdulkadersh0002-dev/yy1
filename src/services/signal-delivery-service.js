/**
 * Signal Delivery Service
 * Multi-channel signal distribution system (WebSocket, Email, Telegram, Webhook)
 * Ensures signals reach users through preferred channels with reliability
 */

import nodemailer from 'nodemailer';

export class SignalDeliveryService {
  constructor({
    logger,
    websocketBroadcast,
    config = {},
    alertBus
  }) {
    this.logger = logger;
    this.websocketBroadcast = websocketBroadcast;
    this.config = config;
    this.alertBus = alertBus;
    
    // Initialize email transporter if configured
    this.emailTransporter = null;
    if (config.email?.enabled) {
      this.emailTransporter = nodemailer.createTransporter(config.email.smtp);
    }
    
    // Telegram configuration
    this.telegramConfig = config.telegram || {};
    
    // Webhook configuration
    this.webhookConfig = config.webhooks || {};
    
    // Delivery statistics
    this.stats = {
      totalSignals: 0,
      websocketDeliveries: 0,
      emailDeliveries: 0,
      telegramDeliveries: 0,
      webhookDeliveries: 0,
      failedDeliveries: 0
    };
  }

  /**
   * Deliver signal through all configured channels
   */
  async deliverSignal(signal, options = {}) {
    this.stats.totalSignals++;
    
    const deliveryPromises = [];
    const results = {
      signal: signal.id || signal.pair,
      timestamp: new Date().toISOString(),
      channels: {}
    };

    try {
      // 1. WebSocket broadcast (real-time)
      if (options.websocket !== false) {
        deliveryPromises.push(
          this.deliverViaWebSocket(signal)
            .then(() => { results.channels.websocket = 'success'; })
            .catch(err => { results.channels.websocket = { error: err.message }; })
        );
      }

      // 2. Email delivery (high priority signals)
      if (options.email && signal.winProbability >= 0.85) {
        deliveryPromises.push(
          this.deliverViaEmail(signal, options.email)
            .then(() => { results.channels.email = 'success'; })
            .catch(err => { results.channels.email = { error: err.message }; })
        );
      }

      // 3. Telegram delivery
      if (options.telegram && this.telegramConfig.enabled) {
        deliveryPromises.push(
          this.deliverViaTelegram(signal, options.telegram)
            .then(() => { results.channels.telegram = 'success'; })
            .catch(err => { results.channels.telegram = { error: err.message }; })
        );
      }

      // 4. Webhook delivery (for external integrations)
      if (options.webhooks && this.webhookConfig.enabled) {
        deliveryPromises.push(
          this.deliverViaWebhooks(signal)
            .then(() => { results.channels.webhooks = 'success'; })
            .catch(err => { results.channels.webhooks = { error: err.message }; })
        );
      }

      // Wait for all deliveries
      await Promise.allSettled(deliveryPromises);

      // Log delivery results
      this.logger?.info?.({
        signalId: signal.id,
        results
      }, 'Signal delivered via multiple channels');

      return results;

    } catch (error) {
      this.stats.failedDeliveries++;
      this.logger?.error?.({ err: error, signalId: signal.id }, 'Signal delivery failed');
      throw error;
    }
  }

  /**
   * Deliver signal via WebSocket (real-time)
   */
  async deliverViaWebSocket(signal) {
    if (!this.websocketBroadcast) {
      throw new Error('WebSocket broadcast not configured');
    }

    try {
      this.websocketBroadcast('NEW_SIGNAL', {
        id: signal.id,
        pair: signal.pair,
        direction: signal.direction,
        strength: signal.strength,
        confidence: signal.confidence,
        entryPrice: signal.entryPrice,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit,
        riskRewardRatio: signal.riskRewardRatio,
        winProbability: signal.winProbability,
        qualityScore: signal.qualityScore,
        timestamp: signal.timestamp,
        expiresAt: signal.expiresAt
      });

      this.stats.websocketDeliveries++;
      return true;
    } catch (error) {
      this.logger?.error?.({ err: error }, 'WebSocket delivery failed');
      throw error;
    }
  }

  /**
   * Deliver signal via Email
   */
  async deliverViaEmail(signal, recipients) {
    if (!this.emailTransporter) {
      throw new Error('Email transporter not configured');
    }

    const emailBody = this.formatSignalEmail(signal);
    
    try {
      await this.emailTransporter.sendMail({
        from: this.config.email.from,
        to: Array.isArray(recipients) ? recipients.join(', ') : recipients,
        subject: `🎯 Ultra Signal: ${signal.pair} ${signal.direction} (${Math.round(signal.winProbability * 100)}% Win Prob)`,
        html: emailBody
      });

      this.stats.emailDeliveries++;
      return true;
    } catch (error) {
      this.logger?.error?.({ err: error }, 'Email delivery failed');
      throw error;
    }
  }

  /**
   * Deliver signal via Telegram
   */
  async deliverViaTelegram(signal, chatIds) {
    if (!this.telegramConfig.botToken) {
      throw new Error('Telegram bot token not configured');
    }

    const message = this.formatSignalTelegram(signal);
    const chats = Array.isArray(chatIds) ? chatIds : [chatIds];

    try {
      const promises = chats.map(chatId =>
        fetch(`https://api.telegram.org/bot${this.telegramConfig.botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: message,
            parse_mode: 'Markdown'
          })
        })
      );

      await Promise.all(promises);
      this.stats.telegramDeliveries++;
      return true;
    } catch (error) {
      this.logger?.error?.({ err: error }, 'Telegram delivery failed');
      throw error;
    }
  }

  /**
   * Deliver signal via Webhooks
   */
  async deliverViaWebhooks(signal) {
    if (!this.webhookConfig.urls || this.webhookConfig.urls.length === 0) {
      throw new Error('No webhook URLs configured');
    }

    const payload = {
      event: 'new_signal',
      signal: {
        id: signal.id,
        pair: signal.pair,
        direction: signal.direction,
        strength: signal.strength,
        confidence: signal.confidence,
        entryPrice: signal.entryPrice,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit,
        riskRewardRatio: signal.riskRewardRatio,
        winProbability: signal.winProbability,
        qualityScore: signal.qualityScore,
        timestamp: signal.timestamp
      },
      timestamp: new Date().toISOString()
    };

    try {
      const promises = this.webhookConfig.urls.map(url =>
        fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Secret': this.webhookConfig.secret || ''
          },
          body: JSON.stringify(payload)
        })
      );

      await Promise.all(promises);
      this.stats.webhookDeliveries++;
      return true;
    } catch (error) {
      this.logger?.error?.({ err: error }, 'Webhook delivery failed');
      throw error;
    }
  }

  /**
   * Format signal for email
   */
  formatSignalEmail(signal) {
    const winProb = Math.round(signal.winProbability * 100);
    const quality = Math.round(signal.qualityScore);
    
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; }
          .signal-box { background: #f8f9fa; padding: 20px; border-left: 4px solid #28a745; margin: 20px 0; }
          .metric { display: inline-block; margin: 10px 20px 10px 0; }
          .metric-label { font-size: 12px; color: #666; text-transform: uppercase; }
          .metric-value { font-size: 20px; font-weight: bold; color: #333; }
          .direction { display: inline-block; padding: 8px 16px; border-radius: 4px; font-weight: bold; }
          .direction.buy { background: #28a745; color: white; }
          .direction.sell { background: #dc3545; color: white; }
          .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🎯 Ultra-Quality Signal</h1>
            <p>A high-probability trading opportunity has been identified</p>
          </div>
          
          <div class="signal-box">
            <h2>${signal.pair} <span class="direction ${signal.direction.toLowerCase()}">${signal.direction}</span></h2>
            
            <div class="metric">
              <div class="metric-label">Win Probability</div>
              <div class="metric-value">${winProb}%</div>
            </div>
            
            <div class="metric">
              <div class="metric-label">Quality Score</div>
              <div class="metric-value">${quality}/100</div>
            </div>
            
            <div class="metric">
              <div class="metric-label">Risk:Reward</div>
              <div class="metric-value">${signal.riskRewardRatio.toFixed(2)}:1</div>
            </div>
            
            <hr style="margin: 20px 0; border: none; border-top: 1px solid #ddd;">
            
            <p><strong>Entry Price:</strong> ${signal.entryPrice.toFixed(5)}</p>
            <p><strong>Stop Loss:</strong> ${signal.stopLoss.toFixed(5)}</p>
            <p><strong>Take Profit:</strong> ${signal.takeProfit.toFixed(5)}</p>
            <p><strong>Confidence:</strong> ${Math.round(signal.confidence)}%</p>
            <p><strong>Strength:</strong> ${Math.round(signal.strength)}%</p>
          </div>
          
          <div class="footer">
            <p>⚠️ Trading involves risk. This signal is based on algorithmic analysis and does not guarantee profits.</p>
            <p>Always use proper risk management and trade within your risk tolerance.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Format signal for Telegram
   */
  formatSignalTelegram(signal) {
    const winProb = Math.round(signal.winProbability * 100);
    const quality = Math.round(signal.qualityScore);
    const direction = signal.direction === 'BUY' ? '🟢 BUY' : '🔴 SELL';
    
    return `
🎯 *ULTRA-QUALITY SIGNAL*

*${signal.pair}* ${direction}

📊 *Win Probability:* ${winProb}%
⭐ *Quality Score:* ${quality}/100
📈 *Risk:Reward:* ${signal.riskRewardRatio.toFixed(2)}:1

💰 *Entry:* ${signal.entryPrice.toFixed(5)}
🛑 *Stop Loss:* ${signal.stopLoss.toFixed(5)}
✅ *Take Profit:* ${signal.takeProfit.toFixed(5)}

🔥 *Confidence:* ${Math.round(signal.confidence)}%
💪 *Strength:* ${Math.round(signal.strength)}%

⚠️ _Trade responsibly. Use proper risk management._
    `.trim();
  }

  /**
   * Get delivery statistics
   */
  getStats() {
    return {
      ...this.stats,
      successRate: this.stats.totalSignals > 0
        ? `${((this.stats.totalSignals - this.stats.failedDeliveries) / this.stats.totalSignals * 100).toFixed(2)  }%`
        : '0%'
    };
  }

  /**
   * Broadcast signal update (for trade status changes)
   */
  async broadcastSignalUpdate(signalId, update) {
    if (this.websocketBroadcast) {
      this.websocketBroadcast('SIGNAL_UPDATE', {
        signalId,
        ...update,
        timestamp: Date.now()
      });
    }
  }
}
