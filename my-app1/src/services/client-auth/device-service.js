import crypto from 'crypto';
import { query } from '../../storage/database.js';

const DEFAULT_FIELDS = [
  'id',
  'user_id',
  'platform',
  'token',
  'device_name',
  'os_name',
  'os_version',
  'app_version',
  'build_number',
  'locale',
  'timezone',
  'user_agent',
  'last_seen_at',
  'created_at',
  'updated_at'
];

const sanitizeDevice = (row) => {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    platform: row.platform,
    device_name: row.device_name,
    os_name: row.os_name,
    os_version: row.os_version,
    app_version: row.app_version,
    build_number: row.build_number,
    locale: row.locale,
    timezone: row.timezone,
    user_agent: row.user_agent,
    last_seen_at: row.last_seen_at,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
};

export default class ClientDeviceService {
  constructor({ logger, queryFn } = {}) {
    this.logger = logger || console;
    this.query = queryFn || query;
  }

  normalizePlatform(platform) {
    if (!platform) {
      return 'unknown';
    }
    return String(platform).trim().toLowerCase();
  }

  normalizeToken({ platform, token, subscription }) {
    if (token && typeof token === 'string') {
      return token.trim();
    }
    if (subscription) {
      const payload =
        typeof subscription.toJSON === 'function' ? subscription.toJSON() : subscription;
      const raw = JSON.stringify(payload);
      return `web:${crypto.createHash('sha256').update(raw).digest('hex')}`;
    }
    this.logger?.warn?.({ platform }, 'Device registration missing token and subscription');
    return null;
  }

  async upsertDevice({
    userId,
    platform,
    token,
    subscription,
    deviceName,
    osName,
    osVersion,
    appVersion,
    buildNumber,
    locale,
    timezone,
    userAgent
  }) {
    if (!userId) {
      throw new Error('userId required');
    }
    const normalizedPlatform = this.normalizePlatform(platform);
    const normalizedToken = this.normalizeToken({
      platform: normalizedPlatform,
      token,
      subscription
    });
    if (!normalizedToken) {
      throw new Error('device token could not be derived');
    }
    const subscriptionBody =
      subscription && typeof subscription.toJSON === 'function'
        ? subscription.toJSON()
        : subscription;
    const subscriptionPayload = subscriptionBody ? JSON.stringify(subscriptionBody) : null;
    const sanitize = (value, length = 160) => {
      if (value == null) {
        return null;
      }
      const str = String(value).trim();
      if (!str) {
        return null;
      }
      return str.slice(0, length);
    };
    const deviceValues = {
      deviceName: sanitize(deviceName),
      osName: sanitize(osName),
      osVersion: sanitize(osVersion, 40),
      appVersion: sanitize(appVersion, 40),
      buildNumber: sanitize(buildNumber, 40),
      locale: sanitize(locale, 24),
      timezone: sanitize(timezone, 64),
      userAgent: sanitize(userAgent, 255)
    };

    const existing = await this.query(
      `SELECT ${DEFAULT_FIELDS.join(', ')} FROM client_devices WHERE user_id = $1 AND platform = $2 AND token = $3 LIMIT 1`,
      [userId, normalizedPlatform, normalizedToken]
    );

    if (existing.rows.length > 0) {
      const updated = await this.query(
        `UPDATE client_devices
         SET subscription = $2::jsonb,
             device_name = $3,
             os_name = $4,
             os_version = $5,
             app_version = $6,
             build_number = $7,
             locale = $8,
             timezone = $9,
             user_agent = $10,
             last_seen_at = NOW()
         WHERE id = $1
         RETURNING ${DEFAULT_FIELDS.join(', ')}`,
        [
          existing.rows[0].id,
          subscriptionPayload,
          deviceValues.deviceName,
          deviceValues.osName,
          deviceValues.osVersion,
          deviceValues.appVersion,
          deviceValues.buildNumber,
          deviceValues.locale,
          deviceValues.timezone,
          deviceValues.userAgent
        ]
      );
      this.logger?.debug?.(
        { userId, platform: normalizedPlatform },
        'Updated client device registration'
      );
      return sanitizeDevice(updated.rows[0]);
    }

    const deviceId = crypto.randomUUID();
    const inserted = await this.query(
      `INSERT INTO client_devices (
         id, user_id, platform, token, subscription, device_name, os_name, os_version,
         app_version, build_number, locale, timezone, user_agent
       ) VALUES (
         $1, $2, $3, $4, $5::jsonb, $6, $7, $8,
         $9, $10, $11, $12, $13
       ) RETURNING ${DEFAULT_FIELDS.join(', ')}`,
      [
        deviceId,
        userId,
        normalizedPlatform,
        normalizedToken,
        subscriptionPayload,
        deviceValues.deviceName,
        deviceValues.osName,
        deviceValues.osVersion,
        deviceValues.appVersion,
        deviceValues.buildNumber,
        deviceValues.locale,
        deviceValues.timezone,
        deviceValues.userAgent
      ]
    );
    this.logger?.info?.({ userId, platform: normalizedPlatform }, 'Client device registered');
    return sanitizeDevice(inserted.rows[0]);
  }

  async listDevices(userId) {
    if (!userId) {
      return [];
    }
    const result = await this.query(
      `SELECT ${DEFAULT_FIELDS.join(', ')}
       FROM client_devices
       WHERE user_id = $1
       ORDER BY updated_at DESC
       LIMIT 100`,
      [userId]
    );
    return result.rows.map((row) => sanitizeDevice(row));
  }

  async touchDevice(id) {
    if (!id) {
      return null;
    }
    const result = await this.query(
      `UPDATE client_devices
       SET last_seen_at = NOW()
       WHERE id = $1
       RETURNING ${DEFAULT_FIELDS.join(', ')}`,
      [id]
    );
    return sanitizeDevice(result.rows[0]);
  }

  async removeDevice({ userId, deviceId }) {
    if (!userId || !deviceId) {
      return false;
    }
    const result = await this.query(
      `DELETE FROM client_devices
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      [deviceId, userId]
    );
    const removed = result.rows.length > 0;
    if (removed) {
      this.logger?.info?.({ userId, deviceId }, 'Client device removed');
    }
    return removed;
  }
}
