import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import { query } from '../../storage/database.js';

const DEFAULT_ROLES = ['viewer'];
const MFA_ISSUER = 'SignalsStrategy';
const PASSWORD_ROUNDS = 12;

authenticator.options = {
  step: 30,
  digits: 6,
  window: 1
};

export default class ClientUserService {
  constructor({ logger, queryFn } = {}) {
    this.logger = logger || console;
    this.query = queryFn || query;
  }

  mapRow(row) {
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      username: row.username,
      roles: Array.isArray(row.roles) ? row.roles : DEFAULT_ROLES,
      status: row.status,
      mfaEnabled: row.mfa_enabled,
      mfaConfigured: Boolean(row.mfa_secret),
      tokenVersion: row.token_version ?? 0,
      lastLoginAt: row.last_login_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  async createUser({ username, password, roles = DEFAULT_ROLES, status = 'active' }) {
    if (!username || !password) {
      throw new Error('Username and password are required');
    }

    const normalizedUsername = username.trim().toLowerCase();
    const passwordHash = await bcrypt.hash(password, PASSWORD_ROUNDS);
    const userId = crypto.randomUUID();
    const normalizedRoles = this.normalizeRoles(roles);

    const result = await this.query(
      `INSERT INTO client_users (id, username, password_hash, roles, status)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, normalizedUsername, passwordHash, normalizedRoles, status]
    );

    this.logger?.info?.({ username: normalizedUsername }, 'Client user created');
    return this.mapRow(result.rows[0]);
  }

  normalizeRoles(roles) {
    if (!roles || !Array.isArray(roles) || roles.length === 0) {
      return DEFAULT_ROLES;
    }
    const cleaned = roles
      .map((role) => (typeof role === 'string' ? role.trim().toLowerCase() : null))
      .filter(Boolean);
    return cleaned.length > 0 ? cleaned : DEFAULT_ROLES;
  }

  async getByUsername(username) {
    if (!username) {
      return null;
    }
    const normalized = username.trim().toLowerCase();
    const result = await this.query('SELECT * FROM client_users WHERE username = $1', [normalized]);
    return this.mapRowWithSecrets(result.rows[0]);
  }

  async getById(userId) {
    if (!userId) {
      return null;
    }
    const result = await this.query('SELECT * FROM client_users WHERE id = $1', [userId]);
    return this.mapRowWithSecrets(result.rows[0]);
  }

  mapRowWithSecrets(row) {
    if (!row) {
      return null;
    }
    return {
      ...this.mapRow(row),
      passwordHash: row.password_hash,
      mfaSecret: row.mfa_secret,
      mfaPendingSecret: row.mfa_pending_secret
    };
  }

  async verifyPassword(user, password) {
    if (!user || !password) {
      return false;
    }
    try {
      return await bcrypt.compare(password, user.passwordHash);
    } catch (error) {
      this.logger?.error?.({ err: error, username: user.username }, 'Failed to verify password');
      return false;
    }
  }

  async generateMfaSecret(user) {
    if (!user) {
      throw new Error('User is required');
    }
    const secret = authenticator.generateSecret();
    await this.query(
      `UPDATE client_users
       SET mfa_pending_secret = $2, updated_at = NOW()
       WHERE id = $1`,
      [user.id, secret]
    );

    const otpauth = authenticator.keyuri(user.username, MFA_ISSUER, secret);
    return { secret, otpauth }; // secret is already base32
  }

  async activateMfa(user, token) {
    if (!user) {
      throw new Error('User is required');
    }
    const code = this.normalizeTotp(token);
    if (!code) {
      return { success: false, error: 'Invalid code' };
    }

    const pendingSecret = user.mfaPendingSecret;
    if (!pendingSecret) {
      return { success: false, error: 'No pending MFA secret' };
    }

    const isValid = authenticator.check(code, pendingSecret);
    if (!isValid) {
      return { success: false, error: 'Incorrect verification code' };
    }

    await this.query(
      `UPDATE client_users
       SET mfa_secret = mfa_pending_secret,
           mfa_pending_secret = NULL,
           mfa_enabled = TRUE,
           updated_at = NOW()
       WHERE id = $1`,
      [user.id]
    );

    return { success: true };
  }

  async disableMfa(userId) {
    if (!userId) {
      return false;
    }
    await this.query(
      `UPDATE client_users
       SET mfa_secret = NULL,
           mfa_pending_secret = NULL,
           mfa_enabled = FALSE,
           updated_at = NOW()
       WHERE id = $1`,
      [userId]
    );
    return true;
  }

  async validateActiveMfa(user, token) {
    if (!user || !user.mfaSecret) {
      return false;
    }
    const code = this.normalizeTotp(token);
    if (!code) {
      return false;
    }
    return authenticator.check(code, user.mfaSecret);
  }

  async recordLogin(userId) {
    if (!userId) {
      return false;
    }
    await this.query(
      `UPDATE client_users
       SET last_login_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [userId]
    );
    return true;
  }

  async bumpTokenVersion(userId) {
    if (!userId) {
      return null;
    }
    const result = await this.query(
      `UPDATE client_users
       SET token_version = token_version + 1,
           updated_at = NOW()
       WHERE id = $1
       RETURNING token_version`,
      [userId]
    );
    return result.rows[0]?.token_version ?? null;
  }

  async updatePassword(userId, password) {
    if (!userId || !password) {
      throw new Error('User ID and password are required');
    }
    const hash = await bcrypt.hash(password, PASSWORD_ROUNDS);
    await this.query(
      `UPDATE client_users
       SET password_hash = $2,
           updated_at = NOW()
       WHERE id = $1`,
      [userId, hash]
    );
    return true;
  }

  normalizeTotp(code) {
    if (!code) {
      return null;
    }
    return `${code}`.replace(/\s+/g, '').trim();
  }

  async updateRoles(userId, roles = DEFAULT_ROLES) {
    if (!userId) {
      return false;
    }
    const normalizedRoles = this.normalizeRoles(roles);
    await this.query(
      `UPDATE client_users
       SET roles = $2,
           updated_at = NOW()
       WHERE id = $1`,
      [userId, normalizedRoles]
    );
    return true;
  }

  async listUsers() {
    const result = await this.query('SELECT * FROM client_users ORDER BY username ASC');
    return result.rows.map((row) => this.mapRow(row));
  }
}
