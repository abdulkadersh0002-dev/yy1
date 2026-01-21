const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;

const toUpperSnake = (value = '') =>
  value
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toUpperCase();

export default class SecretManager {
  constructor(options = {}) {
    this.env = options.env || process.env;
    this.driver = (options.driver || this.env.SECRETS_DRIVER || 'env').toLowerCase();
    this.logger = options.logger || console;
    this.cacheTtlMs = Number.isFinite(options.cacheTtlMs)
      ? options.cacheTtlMs
      : Number.parseInt(this.env.SECRETS_CACHE_TTL_MS, 10) || DEFAULT_CACHE_TTL_MS;

    this.envPrefix = options.envPrefix || this.env.SECRETS_ENV_PREFIX || '';

    this.vaultConfig = {
      addr: options.vaultAddr || this.env.VAULT_ADDR,
      token: options.vaultToken || this.env.VAULT_TOKEN,
      namespace: options.vaultNamespace || this.env.VAULT_NAMESPACE,
      mount: options.vaultMount || this.env.VAULT_MOUNT || 'secret',
      kvVersion: options.vaultKvVersion || this.env.VAULT_KV_VERSION || 'v2'
    };

    this.azureConfig = {
      vaultUrl: options.azureVaultUrl || this.env.AZURE_KEY_VAULT_URL,
      bearerToken: options.azureBearerToken || this.env.AZURE_KEY_VAULT_TOKEN,
      apiVersion: options.azureApiVersion || this.env.AZURE_KEY_VAULT_API_VERSION || '7.4'
    };

    this.cache = new Map();
  }

  clearCache() {
    this.cache.clear();
  }

  async getSecret(name, { parseJson = false } = {}) {
    if (!name) {
      throw new Error('Secret name is required');
    }

    const cached = this.getFromCache(name);
    if (cached != null) {
      return parseJson ? this.parseJsonSecret(cached, name) : cached;
    }

    let value;
    switch (this.driver) {
      case 'vault':
        value = await this.fetchVaultSecret(name);
        break;
      case 'azure':
      case 'azure-key-vault':
        value = await this.fetchAzureSecret(name);
        break;
      case 'env':
      default:
        value = this.fetchEnvSecret(name);
        break;
    }

    if (value == null) {
      this.logger?.warn?.({ name }, 'SecretManager could not resolve secret');
    }

    this.setCache(name, value);
    return parseJson ? this.parseJsonSecret(value, name) : value;
  }

  async getJsonSecret(name) {
    return this.getSecret(name, { parseJson: true });
  }

  getFromCache(name) {
    if (!this.cacheTtlMs) {
      return null;
    }
    const entry = this.cache.get(name);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      this.cache.delete(name);
      return null;
    }
    return entry.value;
  }

  setCache(name, value) {
    if (!this.cacheTtlMs) {
      return;
    }
    this.cache.set(name, {
      value,
      expiresAt: Date.now() + this.cacheTtlMs
    });
  }

  parseJsonSecret(value, name) {
    if (value == null) {
      return null;
    }
    if (typeof value === 'object') {
      return value;
    }
    try {
      return JSON.parse(value);
    } catch (error) {
      this.logger?.error?.({ name, err: error }, 'SecretManager failed to parse JSON secret');
      return null;
    }
  }

  fetchEnvSecret(name) {
    const prefixed = `${this.envPrefix}${name}`;
    const key = toUpperSnake(prefixed);
    return this.env[key] ?? null;
  }

  async fetchVaultSecret(name) {
    const { addr, token, namespace, mount, kvVersion } = this.vaultConfig;
    if (!addr || !token) {
      this.logger?.warn?.('SecretManager vault driver selected but VAULT_ADDR/VAULT_TOKEN missing');
      return null;
    }

    const sanitizedName = name.replace(/^\/+/, '').replace(/\.+/g, '.');
    const baseUrl = addr.endsWith('/') ? addr.slice(0, -1) : addr;

    let path;
    if (`${kvVersion}`.toLowerCase() === 'v1') {
      path = `${mount}/${sanitizedName}`;
    } else {
      path = `${mount}/data/${sanitizedName}`;
    }

    const url = `${baseUrl}/v1/${path}`;
    const headers = {
      'X-Vault-Token': token
    };
    if (namespace) {
      headers['X-Vault-Namespace'] = namespace;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers
    });

    if (!response.ok) {
      this.logger?.error?.(
        { status: response.status, name, url },
        'SecretManager vault request failed'
      );
      return null;
    }

    const payload = await response.json();
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    if (`${kvVersion}`.toLowerCase() === 'v1') {
      return payload?.data ?? null;
    }

    return payload?.data?.data ?? null;
  }

  async fetchAzureSecret(name) {
    const { vaultUrl, bearerToken, apiVersion } = this.azureConfig;
    if (!vaultUrl || !bearerToken) {
      this.logger?.warn?.(
        'SecretManager azure driver selected but AZURE_KEY_VAULT_URL/token missing'
      );
      return null;
    }

    const sanitizedName = encodeURIComponent(name);
    const trimmed = vaultUrl.endsWith('/') ? vaultUrl.slice(0, -1) : vaultUrl;
    const url = `${trimmed}/secrets/${sanitizedName}?api-version=${apiVersion}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        Accept: 'application/json'
      }
    });

    if (!response.ok) {
      this.logger?.error?.(
        { status: response.status, name, url },
        'SecretManager azure request failed'
      );
      return null;
    }

    const payload = await response.json();
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    return payload.value ?? null;
  }
}
