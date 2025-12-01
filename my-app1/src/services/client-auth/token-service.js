import jwt from 'jsonwebtoken';

const ACCESS_SECRET_NAME = 'client-jwt-access';
const REFRESH_SECRET_NAME = 'client-jwt-refresh';
const CHALLENGE_SECRET_NAME = 'client-mfa-challenge';

const ACCESS_ENV_VAR = 'CLIENT_JWT_SECRET';
const REFRESH_ENV_VAR = 'CLIENT_JWT_REFRESH_SECRET';
const CHALLENGE_ENV_VAR = 'CLIENT_MFA_CHALLENGE_SECRET';

const DEFAULT_ACCESS_EXPIRY = '15m';
const DEFAULT_REFRESH_EXPIRY = '30d';
const DEFAULT_CHALLENGE_EXPIRY = '5m';

export default class ClientTokenService {
  constructor({ secretManager, logger } = {}) {
    this.secretManager = secretManager || null;
    this.logger = logger || console;
    this.cache = new Map();
  }

  async signAccessToken(payload, options = {}) {
    const secret = await this.resolveSecret(ACCESS_SECRET_NAME, ACCESS_ENV_VAR);
    if (!secret) {
      throw new Error('CLIENT_JWT_SECRET not configured');
    }
    return jwt.sign(payload, secret, {
      expiresIn: options.expiresIn || DEFAULT_ACCESS_EXPIRY,
      issuer: 'SignalsStrategy',
      audience: 'client-app'
    });
  }

  async signRefreshToken(payload, options = {}) {
    const secret = await this.resolveSecret(REFRESH_SECRET_NAME, REFRESH_ENV_VAR);
    if (!secret) {
      throw new Error('CLIENT_JWT_REFRESH_SECRET not configured');
    }
    return jwt.sign(payload, secret, {
      expiresIn: options.expiresIn || DEFAULT_REFRESH_EXPIRY,
      issuer: 'SignalsStrategy',
      audience: 'client-app'
    });
  }

  async signChallengeToken(payload, options = {}) {
    const secret = await this.resolveSecret(CHALLENGE_SECRET_NAME, CHALLENGE_ENV_VAR, true);
    return jwt.sign(payload, secret, {
      expiresIn: options.expiresIn || DEFAULT_CHALLENGE_EXPIRY,
      issuer: 'SignalsStrategy',
      audience: 'client-app'
    });
  }

  async verifyAccessToken(token, options = {}) {
    const secret = await this.resolveSecret(ACCESS_SECRET_NAME, ACCESS_ENV_VAR);
    return jwt.verify(token, secret, {
      issuer: 'SignalsStrategy',
      audience: 'client-app',
      ...options
    });
  }

  async verifyRefreshToken(token, options = {}) {
    const secret = await this.resolveSecret(REFRESH_SECRET_NAME, REFRESH_ENV_VAR);
    return jwt.verify(token, secret, {
      issuer: 'SignalsStrategy',
      audience: 'client-app',
      ...options
    });
  }

  async verifyChallengeToken(token, options = {}) {
    const secret = await this.resolveSecret(CHALLENGE_SECRET_NAME, CHALLENGE_ENV_VAR, true);
    return jwt.verify(token, secret, {
      issuer: 'SignalsStrategy',
      audience: 'client-app',
      ...options
    });
  }

  async resolveSecret(secretName, envVar, fallbackToAccess = false) {
    if (this.cache.has(secretName)) {
      return this.cache.get(secretName);
    }

    let value = process.env[envVar];

    if (!value && this.secretManager && typeof this.secretManager.getSecret === 'function') {
      try {
        value = await this.secretManager.getSecret(secretName);
      } catch (error) {
        this.logger?.error?.(
          { err: error, secretName },
          'ClientTokenService secret retrieval failed'
        );
      }
    }

    if (!value && fallbackToAccess && secretName !== ACCESS_SECRET_NAME) {
      value = await this.resolveSecret(ACCESS_SECRET_NAME, ACCESS_ENV_VAR);
    }

    if (!value) {
      return null;
    }

    this.cache.set(secretName, value);
    return value;
  }

  clearCache() {
    this.cache.clear();
  }
}
