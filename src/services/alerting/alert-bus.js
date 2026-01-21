import nodemailer from 'nodemailer';

const DEFAULT_DEDUPE_MS = 5 * 60 * 1000;
const DEFAULT_VOLATILITY_THRESHOLD = 92;

const toArray = (value) => {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [value].filter(Boolean);
};

const sanitizeSeverity = (severity) => {
  const normalized = (severity || 'info').toLowerCase();
  if (['info', 'warning', 'critical'].includes(normalized)) {
    return normalized;
  }
  return 'info';
};

const formatContextPreview = (context) => {
  if (!context || typeof context !== 'object') {
    return null;
  }
  try {
    return JSON.stringify(context, null, 2);
  } catch (error) {
    return null;
  }
};

class AlertBus {
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.slackWebhookUrl = options.slackWebhookUrl || null;
    this.webhookUrls = toArray(options.webhookUrls);
    this.emailConfig = options.email || null;
    this.dedupeMs = Number.isFinite(options.dedupeMs) ? options.dedupeMs : DEFAULT_DEDUPE_MS;
    this.recentEvents = new Map();
    this.nowFn = typeof options.nowFn === 'function' ? options.nowFn : () => Date.now();
    this.transportOverrides = options.transportOverrides || {};

    this.emailTransport = null;
    if (this.emailConfig && this.emailConfig.smtp?.host) {
      this.emailTransport = nodemailer.createTransport({
        host: this.emailConfig.smtp.host,
        port: this.emailConfig.smtp.port || 587,
        secure: Boolean(this.emailConfig.smtp.secure),
        auth:
          this.emailConfig.smtp.user && this.emailConfig.smtp.pass
            ? {
                user: this.emailConfig.smtp.user,
                pass: this.emailConfig.smtp.pass
              }
            : undefined
      });
    }
  }

  purgeExpired(now) {
    if (!this.recentEvents.size) {
      return;
    }
    const cutoff = now - this.dedupeMs;
    for (const [key, timestamp] of this.recentEvents.entries()) {
      if (timestamp < cutoff) {
        this.recentEvents.delete(key);
      }
    }
  }

  dedupeKey(event) {
    if (event.dedupeKey) {
      return event.dedupeKey;
    }
    return `${event.topic || 'general'}|${event.severity || 'info'}|${event.message || ''}`;
  }

  availableChannels() {
    const channels = ['log'];
    if (this.slackWebhookUrl || this.transportOverrides.slack) {
      channels.push('slack');
    }
    if (this.webhookUrls.length || this.transportOverrides.webhook) {
      channels.push('webhook');
    }
    if (this.emailTransport || this.transportOverrides.email) {
      channels.push('email');
    }
    return channels;
  }

  async publish(event) {
    if (!event || !event.message) {
      return false;
    }

    const now = this.nowFn();
    this.purgeExpired(now);

    const payload = {
      timestamp: new Date(now).toISOString(),
      topic: event.topic || 'general',
      severity: sanitizeSeverity(event.severity),
      message: event.message,
      body: event.body || null,
      context: event.context || null,
      subject: event.subject || null
    };

    const key = this.dedupeKey(payload);
    const previous = this.recentEvents.get(key);
    if (previous != null && now - previous < this.dedupeMs) {
      this.logger?.debug?.(
        { topic: payload.topic, message: payload.message },
        'AlertBus deduped event'
      );
      return false;
    }
    this.recentEvents.set(key, now);

    const available = this.availableChannels();
    const requested = toArray(event.channels);
    const channels = requested.length
      ? requested.filter((channel) => available.includes(channel))
      : available;

    const tasks = channels.map((channel) => this.dispatch(channel, payload));
    await Promise.all(tasks);
    return true;
  }

  async dispatch(channel, payload) {
    switch (channel) {
      case 'slack':
        return this.sendSlack(payload);
      case 'webhook':
        return this.sendWebhooks(payload);
      case 'email':
        return this.sendEmail(payload);
      case 'log':
      default:
        return this.logEvent(payload);
    }
  }

  async sendSlack(payload) {
    if (typeof this.transportOverrides.slack === 'function') {
      return this.transportOverrides.slack(payload);
    }
    if (!this.slackWebhookUrl) {
      return false;
    }
    const contextPreview = formatContextPreview(payload.context);
    const textLines = [`*${payload.severity.toUpperCase()}* ${payload.message}`];
    if (payload.body) {
      textLines.push('```');
      textLines.push(payload.body);
      textLines.push('```');
    } else if (contextPreview) {
      textLines.push('```');
      textLines.push(contextPreview);
      textLines.push('```');
    }
    try {
      await fetch(this.slackWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: textLines.join('\n') })
      });
      return true;
    } catch (error) {
      this.logger?.warn?.({ err: error, topic: payload.topic }, 'AlertBus slack dispatch failed');
      return false;
    }
  }

  async sendWebhooks(payload) {
    if (typeof this.transportOverrides.webhook === 'function') {
      return this.transportOverrides.webhook(payload);
    }
    if (!this.webhookUrls.length) {
      return false;
    }
    const contextPreview = formatContextPreview(payload.context);
    const body = {
      timestamp: payload.timestamp,
      topic: payload.topic,
      severity: payload.severity,
      message: payload.message,
      body: payload.body,
      context: payload.context,
      preview: contextPreview
    };
    const tasks = this.webhookUrls.map(async (url) => {
      try {
        await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
      } catch (error) {
        this.logger?.warn?.(
          { err: error, topic: payload.topic },
          'AlertBus webhook dispatch failed'
        );
      }
    });
    await Promise.all(tasks);
    return true;
  }

  async sendEmail(payload) {
    if (typeof this.transportOverrides.email === 'function') {
      return this.transportOverrides.email(payload);
    }
    if (!this.emailTransport || !this.emailConfig?.to || !this.emailConfig?.from) {
      return false;
    }
    const recipients = toArray(this.emailConfig.to);
    if (!recipients.length) {
      return false;
    }
    const subject = payload.subject || `[${payload.severity.toUpperCase()}] ${payload.topic}`;
    const contextPreview = formatContextPreview(payload.context);

    const bodyLines = [payload.message];
    if (payload.body) {
      bodyLines.push('', payload.body);
    } else if (contextPreview) {
      bodyLines.push('', contextPreview);
    }

    try {
      await this.emailTransport.sendMail({
        from: this.emailConfig.from,
        to: recipients.join(', '),
        subject,
        text: bodyLines.join('\n')
      });
      return true;
    } catch (error) {
      this.logger?.warn?.({ err: error, topic: payload.topic }, 'AlertBus email dispatch failed');
      return false;
    }
  }

  async logEvent(payload) {
    if (typeof this.transportOverrides.log === 'function') {
      return this.transportOverrides.log(payload);
    }
    this.logger?.info?.(
      {
        topic: payload.topic,
        severity: payload.severity,
        message: payload.message,
        timestamp: payload.timestamp
      },
      'AlertBus event'
    );
    return true;
  }
}

export default AlertBus;
export { DEFAULT_DEDUPE_MS, DEFAULT_VOLATILITY_THRESHOLD };
