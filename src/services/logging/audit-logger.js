import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { appConfig } from '../../app/config.js';

const ensureDirectory = async (targetPath) => {
  const dir = path.dirname(targetPath);
  await fsPromises.mkdir(dir, { recursive: true });
};

export default class AuditLogger {
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.env = options.env || appConfig?.env || process.env;
    const defaultPath = path.resolve(process.cwd(), 'logs', 'audit.log');
    this.filePath = options.filePath || this.env.AUDIT_LOG_PATH || defaultPath;
    this.stream = null;
    this.streamReady = null;
  }

  async init() {
    if (this.stream) {
      return;
    }
    if (!this.streamReady) {
      this.streamReady = this.createStream();
    }
    await this.streamReady;
  }

  async createStream() {
    try {
      await ensureDirectory(this.filePath);
      this.stream = fs.createWriteStream(this.filePath, { flags: 'a', encoding: 'utf8' });
      this.stream.on('error', (err) => {
        this.logger?.error?.({ err }, 'AuditLogger stream error');
      });
    } catch (error) {
      this.logger?.error?.({ err: error }, 'AuditLogger failed to create write stream');
      throw error;
    }
  }

  async record(event, details = {}, metadata = {}) {
    try {
      await this.init();
      const entry = {
        timestamp: new Date().toISOString(),
        event,
        details,
        metadata
      };
      const line = `${JSON.stringify(entry)}\n`;
      this.stream.write(line);
    } catch (error) {
      this.logger?.error?.({ err: error, event }, 'AuditLogger failed to record event');
    }
  }
}
