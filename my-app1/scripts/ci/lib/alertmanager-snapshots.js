import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

function loadEntries(path) {
  if (!existsSync(path)) {
    throw new Error(`Snapshot input file not found: ${path}`);
  }
  const raw = readFileSync(path, 'utf8');
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error('Snapshot file must contain a JSON array');
    }
    return parsed;
  } catch (error) {
    throw new Error(`Failed to parse snapshot input JSON: ${error.message}`);
  }
}

function readFixture(fixturesDir, fileName) {
  const path = join(fixturesDir, fileName);
  if (!existsSync(path)) {
    throw new Error(`Fixture not found: ${path}`);
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to parse fixture ${fileName}: ${error.message}`);
  }
}

function toJson(value) {
  return JSON.stringify(value, null, 2);
}

function findLast(entries, predicate) {
  const matches = entries
    .filter((entry) => {
      try {
        return predicate(entry);
      } catch (_error) {
        return false;
      }
    })
    .sort((a, b) => {
      const tsA = a?.timestamp ?? '';
      const tsB = b?.timestamp ?? '';
      return tsA.localeCompare(tsB);
    });
  return matches.length > 0 ? matches[matches.length - 1] : null;
}

function deriveSlackState(entry) {
  const text = entry?.bodyJson?.text;
  if (typeof text !== 'string') {
    return null;
  }
  const match = text.match(/\*State\*:\s*([A-Za-z]+)/i);
  if (!match) {
    return null;
  }
  return match[1].trim().toLowerCase();
}

function sanitizeSlack(entry) {
  const payload = entry?.bodyJson || {};
  return {
    channel: payload.channel ?? null,
    title: payload.title ?? null,
    text: typeof payload.text === 'string' ? payload.text.trim() : null
  };
}

function validateSlackSchema(entry, context) {
  const payload = entry?.bodyJson || {};
  if (typeof payload !== 'object' || payload === null) {
    throw new Error(`Slack payload missing bodyJson for ${context}`);
  }
  const requiredFields = ['channel', 'title', 'text'];
  requiredFields.forEach((field) => {
    if (typeof payload[field] !== 'string' || payload[field].trim().length === 0) {
      throw new Error(`Slack payload missing required field "${field}" for ${context}`);
    }
  });
  const text = payload.text;
  const requiredPhrases = [
    '*Service*:',
    '*Summary*:',
    '*Description*:',
    '*State*:',
    '*Severity*:',
    '*Runbook*:'
  ];
  requiredPhrases.forEach((phrase) => {
    if (!text.includes(phrase)) {
      throw new Error(
        `Slack payload for ${context} missing required annotation segment "${phrase}"`
      );
    }
  });
}

function deriveTicketState(entry) {
  const payload = entry?.bodyJson || {};
  if (typeof payload.status === 'string') {
    return payload.status.trim().toLowerCase();
  }
  if (Array.isArray(payload.alerts) && payload.alerts.length > 0) {
    const status = payload.alerts[0]?.status;
    if (typeof status === 'string') {
      return status.trim().toLowerCase();
    }
  }
  return null;
}

function sanitizeTicket(entry) {
  const payload = entry?.bodyJson || {};
  const alert = Array.isArray(payload.alerts) && payload.alerts.length > 0 ? payload.alerts[0] : {};
  const labels = alert?.labels || {};
  const annotations = alert?.annotations || {};
  return {
    receiver: payload.receiver ?? null,
    status: payload.status ?? null,
    alert: {
      status: alert?.status ?? null,
      labels: {
        alertname: labels.alertname ?? null,
        service: labels.service ?? null,
        severity: labels.severity ?? null
      },
      annotations: {
        summary: annotations.summary ?? null,
        description: annotations.description ?? null,
        runbook: annotations.runbook ?? null,
        ticket_hint: annotations.ticket_hint ?? null
      }
    }
  };
}

function validateTicketSchema(entry, context) {
  const payload = entry?.bodyJson || {};
  if (typeof payload !== 'object' || payload === null) {
    throw new Error(`Ticket payload missing bodyJson for ${context}`);
  }
  const alerts = Array.isArray(payload.alerts) ? payload.alerts : [];
  if (alerts.length === 0) {
    throw new Error(`Ticket payload missing alerts array for ${context}`);
  }
  const alert = alerts[0];
  if (typeof alert !== 'object' || alert === null) {
    throw new Error(`Ticket payload alerts entry malformed for ${context}`);
  }
  const labelFields = ['alertname', 'service', 'severity'];
  labelFields.forEach((field) => {
    const value = alert.labels?.[field];
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`Ticket payload missing label "${field}" for ${context}`);
    }
  });
  const annotationFields = ['summary', 'description', 'runbook'];
  annotationFields.forEach((field) => {
    const value = alert.annotations?.[field];
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`Ticket payload missing annotation "${field}" for ${context}`);
    }
  });
}

function compareSnapshot({ id, entry, fixturesDir, fixtureFile, projector, validator }) {
  if (!entry) {
    throw new Error(`Snapshot entry missing for ${id}`);
  }
  if (typeof validator === 'function') {
    validator(entry, id);
  }
  const expected = readFixture(fixturesDir, fixtureFile);
  const actual = projector(entry);
  const expectedJson = toJson(expected);
  const actualJson = toJson(actual);
  if (expectedJson !== actualJson) {
    const message = [
      `Snapshot mismatch for ${id}.`,
      'Expected:',
      expectedJson,
      'Actual:',
      actualJson
    ].join('\n');
    throw new Error(message);
  }
}

export function compareAlertSnapshots({ inputPath, fixturesDir }) {
  if (!inputPath) {
    throw new Error('inputPath is required');
  }
  if (!fixturesDir) {
    throw new Error('fixturesDir is required');
  }

  const entries = loadEntries(inputPath);

  const definitions = [
    {
      id: 'slack-critical-firing',
      predicate: (entry) =>
        typeof entry?.path === 'string' &&
        entry.path.includes('/slack/critical') &&
        deriveSlackState(entry) === 'firing',
      projector: sanitizeSlack,
      fixtureFile: 'slack-critical-firing.json',
      validator: validateSlackSchema
    },
    {
      id: 'slack-critical-resolved',
      predicate: (entry) =>
        typeof entry?.path === 'string' &&
        entry.path.includes('/slack/critical') &&
        deriveSlackState(entry) === 'resolved',
      projector: sanitizeSlack,
      fixtureFile: 'slack-critical-resolved.json',
      validator: validateSlackSchema
    },
    {
      id: 'slack-warning-firing',
      predicate: (entry) =>
        typeof entry?.path === 'string' &&
        entry.path.includes('/slack/default') &&
        deriveSlackState(entry) === 'firing',
      projector: sanitizeSlack,
      fixtureFile: 'slack-warning-slo-firing.json',
      validator: validateSlackSchema
    },
    {
      id: 'slack-warning-resolved',
      predicate: (entry) =>
        typeof entry?.path === 'string' &&
        entry.path.includes('/slack/default') &&
        deriveSlackState(entry) === 'resolved',
      projector: sanitizeSlack,
      fixtureFile: 'slack-warning-slo-resolved.json',
      validator: validateSlackSchema
    },
    {
      id: 'ticket-critical-firing',
      predicate: (entry) =>
        typeof entry?.path === 'string' &&
        entry.path.includes('/ticket') &&
        deriveTicketState(entry) === 'firing',
      projector: sanitizeTicket,
      fixtureFile: 'ticket-critical-firing.json',
      validator: validateTicketSchema
    },
    {
      id: 'ticket-critical-resolved',
      predicate: (entry) =>
        typeof entry?.path === 'string' &&
        entry.path.includes('/ticket') &&
        deriveTicketState(entry) === 'resolved',
      projector: sanitizeTicket,
      fixtureFile: 'ticket-critical-resolved.json',
      validator: validateTicketSchema
    }
  ];

  definitions.forEach((definition) => {
    const entry = findLast(entries, definition.predicate);
    compareSnapshot({
      id: definition.id,
      entry,
      fixturesDir,
      fixtureFile: definition.fixtureFile,
      projector: definition.projector,
      validator: definition.validator
    });
  });
}
