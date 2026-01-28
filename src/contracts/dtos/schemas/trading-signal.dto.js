import { z } from 'zod';

/**
 * @typedef {Object} TradingSignalDTO
 * @property {string|null|undefined} broker
 * @property {string} pair
 * @property {number} timestamp
 * @property {number|null|undefined} expiresAt
 * @property {string|null|undefined} signalStatus
 * @property {string|null|undefined} timeframe
 * @property {{ state?: string, expiresAt?: (number|null), ttlMs?: (number|null), evaluatedAt?: (number|null), reason?: (string|null) }|null|undefined} validity
 * @property {('BUY'|'SELL'|'NEUTRAL')} direction
 * @property {number} strength
 * @property {number} confidence
 * @property {number} finalScore
 * @property {Object} components
 * @property {Object|null} entry
 * @property {Object} riskManagement
 * @property {{ isValid: boolean, checks: Object<string, boolean>, reason: string }} isValid
 * @property {Object|null} explainability
 * @property {string[]|null} reasoning
 * @property {{ action: ('BUY'|'SELL'|'NEUTRAL'), reason: (string|null), reasons: string[], tradeValid: (boolean|null) }|null|undefined} finalDecision
 */

export const TradingSignalSchema = z
  .object({
    broker: z.string().nullable().optional(),
    pair: z.string(),
    timestamp: z.number(),
    expiresAt: z.number().nullable().optional(),
    signalStatus: z.string().nullable().optional(),
    timeframe: z.string().nullable().optional(),
    validity: z
      .object({
        state: z.string().optional(),
        expiresAt: z.number().nullable().optional(),
        ttlMs: z.number().nullable().optional(),
        evaluatedAt: z.number().nullable().optional(),
        reason: z.string().nullable().optional()
      })
      .nullable()
      .optional(),
    direction: z.enum(['BUY', 'SELL', 'NEUTRAL']),
    strength: z.number(),
    confidence: z.number(),
    finalScore: z.number(),
    finalDecision: z
      .object({
        action: z.enum(['BUY', 'SELL', 'NEUTRAL']),
        reason: z.string().nullable().optional(),
        reasons: z.array(z.string()).optional(),
        tradeValid: z.boolean().nullable().optional()
      })
      .nullable()
      .optional(),
    components: z.record(z.unknown()),
    entry: z.unknown().nullable(),
    riskManagement: z.record(z.unknown()),
    isValid: z.object({
      isValid: z.boolean(),
      checks: z.record(z.boolean()),
      reason: z.string(),
      decision: z
        .object({
          state: z.enum(['ENTER', 'WAIT_MONITOR', 'NO_TRADE_BLOCKED']).optional(),
          blocked: z.boolean().optional(),
          score: z.number().optional(),
          assetClass: z.string().optional(),
          category: z.string().optional(),
          killSwitch: z
            .object({
              enabled: z.boolean().optional(),
              blocked: z.boolean().optional(),
              ids: z.array(z.string()).optional(),
              items: z
                .array(
                  z.object({
                    id: z.string(),
                    label: z.string().nullable().optional(),
                    reason: z.string().nullable().optional(),
                    weight: z.number().nullable().optional()
                  })
                )
                .optional()
            })
            .nullable()
            .optional(),
          blockers: z.array(z.string()).optional(),
          missing: z.array(z.string()).optional(),
          whatWouldChange: z.array(z.string()).optional(),
          missingInputs: z
            .object({
              missing: z.array(z.string()).optional(),
              details: z.record(z.unknown()).optional()
            })
            .optional(),
          nextSteps: z.array(z.string()).optional(),
          contributors: z.record(z.unknown()).optional(),
          modifiers: z.record(z.unknown()).optional(),
          context: z.record(z.unknown()).optional()
        })
        .optional()
    }),
    explainability: z.unknown().nullable(),
    reasoning: z.array(z.string()).nullable().optional()
  })
  .strict();

export function createTradingSignalDTO(raw) {
  if (!raw) {
    return {
      broker: null,
      pair: '',
      timestamp: Date.now(),
      expiresAt: null,
      signalStatus: null,
      timeframe: null,
      validity: null,
      direction: 'NEUTRAL',
      strength: 0,
      confidence: 0,
      finalScore: 0,
      finalDecision: null,
      components: {},
      entry: null,
      riskManagement: {},
      isValid: { isValid: false, checks: {}, reason: 'Empty signal' },
      explainability: null,
      reasoning: null
    };
  }

  const timeframe = (() => {
    const direct = raw.timeframe ?? raw.meta?.timeframe;
    if (direct != null && String(direct).trim()) {
      return String(direct);
    }
    const technicalTf = raw.components?.technical?.signals?.[0]?.timeframe;
    if (technicalTf != null && String(technicalTf).trim()) {
      return String(technicalTf);
    }
    return null;
  })();

  return {
    broker: raw.broker || null,
    pair: String(raw.pair || ''),
    timestamp: Number.isFinite(raw.timestamp) ? raw.timestamp : Date.now(),
    expiresAt: Number.isFinite(Number(raw.expiresAt)) ? Number(raw.expiresAt) : null,
    signalStatus: raw.signalStatus != null ? String(raw.signalStatus) : null,
    timeframe,
    validity:
      raw.validity && typeof raw.validity === 'object'
        ? {
            state: raw.validity.state != null ? String(raw.validity.state) : undefined,
            expiresAt:
              raw.validity.expiresAt == null || !Number.isFinite(Number(raw.validity.expiresAt))
                ? null
                : Number(raw.validity.expiresAt),
            ttlMs:
              raw.validity.ttlMs == null || !Number.isFinite(Number(raw.validity.ttlMs))
                ? null
                : Number(raw.validity.ttlMs),
            evaluatedAt:
              raw.validity.evaluatedAt == null ||
              !Number.isFinite(Number(raw.validity.evaluatedAt))
                ? null
                : Number(raw.validity.evaluatedAt),
            reason: raw.validity.reason != null ? String(raw.validity.reason) : null
          }
        : null,
    direction: raw.direction || 'NEUTRAL',
    strength: Number(raw.strength) || 0,
    confidence: Number(raw.confidence) || 0,
    finalScore: Number(raw.finalScore) || 0,
    finalDecision:
      raw.finalDecision && typeof raw.finalDecision === 'object'
        ? {
            action: raw.finalDecision.action || raw.direction || 'NEUTRAL',
            reason:
              raw.finalDecision.reason != null
                ? String(raw.finalDecision.reason)
                : raw.isValid?.reason || null,
            reasons: Array.isArray(raw.finalDecision.reasons)
              ? raw.finalDecision.reasons.map((r) => String(r)).slice(0, 6)
              : [],
            tradeValid:
              raw.finalDecision.tradeValid === null || raw.finalDecision.tradeValid === undefined
                ? null
                : Boolean(raw.finalDecision.tradeValid)
          }
        : null,
    components: raw.components || {},
    entry: raw.entry ?? null,
    riskManagement: raw.riskManagement || {},
    // Normalize validation structure to ensure downstream Zod schema only sees booleans
    // even when upstream signal builders hand back null/undefined states.
    isValid: {
      isValid: Boolean(raw.isValid?.isValid),
      checks: (() => {
        const checks = raw.isValid?.checks || {};
        if (typeof checks !== 'object' || checks === null) {
          return {};
        }
        return Object.fromEntries(
          Object.entries(checks).map(([key, value]) => [
            key,
            value === null ? false : Boolean(value)
          ])
        );
      })(),
      reason: raw.isValid?.reason || 'Unspecified',
      decision:
        raw.isValid?.decision && typeof raw.isValid.decision === 'object'
          ? {
              state: raw.isValid.decision.state || undefined,
              blocked:
                raw.isValid.decision.blocked === undefined
                  ? undefined
                  : Boolean(raw.isValid.decision.blocked),
              score: Number.isFinite(Number(raw.isValid.decision.score))
                ? Number(raw.isValid.decision.score)
                : undefined,
              assetClass: raw.isValid.decision.assetClass || undefined,
              category: raw.isValid.decision.category || undefined,
              blockers: Array.isArray(raw.isValid.decision.blockers)
                ? raw.isValid.decision.blockers.map((v) => String(v)).slice(0, 10)
                : undefined,
              missing: Array.isArray(raw.isValid.decision.missing)
                ? raw.isValid.decision.missing.map((v) => String(v)).slice(0, 12)
                : undefined,
              whatWouldChange: Array.isArray(raw.isValid.decision.whatWouldChange)
                ? raw.isValid.decision.whatWouldChange.map((v) => String(v)).slice(0, 12)
                : undefined,
              contributors:
                raw.isValid.decision.contributors &&
                typeof raw.isValid.decision.contributors === 'object'
                  ? raw.isValid.decision.contributors
                  : undefined,
              modifiers:
                raw.isValid.decision.modifiers && typeof raw.isValid.decision.modifiers === 'object'
                  ? raw.isValid.decision.modifiers
                  : undefined,
              context:
                raw.isValid.decision.context && typeof raw.isValid.decision.context === 'object'
                  ? raw.isValid.decision.context
                  : undefined
            }
          : undefined
    },
    explainability: raw.explainability ?? null,
    reasoning: Array.isArray(raw.reasoning) ? raw.reasoning : null
  };
}

export function validateTradingSignalDTO(dto) {
  return TradingSignalSchema.parse(dto);
}
