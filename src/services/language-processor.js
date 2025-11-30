import { francAll } from 'franc';
import * as translateModule from '@vitalets/google-translate-api';

const translateFn = async (text, options = {}) => {
  const candidate =
    (typeof translateModule === 'function' && translateModule) ||
    (typeof translateModule?.default === 'function' && translateModule.default) ||
    (typeof translateModule?.translate === 'function' && translateModule.translate);

  if (typeof candidate === 'function') {
    return candidate(text, options);
  }

  return { text };
};

const ISO_6393_TO_1 = {
  afr: 'af',
  ara: 'ar',
  aze: 'az',
  bel: 'be',
  ben: 'bn',
  bul: 'bg',
  cat: 'ca',
  ces: 'cs',
  cmn: 'zh',
  dan: 'da',
  deu: 'de',
  ell: 'el',
  eng: 'en',
  est: 'et',
  fin: 'fi',
  fra: 'fr',
  heb: 'he',
  hin: 'hi',
  hrv: 'hr',
  hun: 'hu',
  ind: 'id',
  ita: 'it',
  jpn: 'ja',
  kor: 'ko',
  lit: 'lt',
  lvs: 'lv',
  msa: 'ms',
  nld: 'nl',
  nor: 'no',
  pol: 'pl',
  por: 'pt',
  ron: 'ro',
  rus: 'ru',
  slk: 'sk',
  slv: 'sl',
  spa: 'es',
  srp: 'sr',
  swe: 'sv',
  tha: 'th',
  tur: 'tr',
  ukr: 'uk',
  vie: 'vi'
};

const ASCII_REGEX = /^[\x00-\x7F]+$/;

function normalizeLanguageCode(rawCode) {
  if (!rawCode || rawCode === 'und') {
    return null;
  }
  if (ISO_6393_TO_1[rawCode]) {
    return ISO_6393_TO_1[rawCode];
  }
  if (rawCode.length === 2) {
    return rawCode.toLowerCase();
  }
  return null;
}

export default class LanguageProcessor {
  constructor(options = {}) {
    const {
      targetLanguage = process.env.NEWS_TARGET_LANGUAGE || 'en',
      enableTranslation = process.env.ENABLE_NEWS_TRANSLATION !== 'false',
      detectionMinLength = 24,
      detectionMaxCandidates = 5,
      translationTimeoutMs = 7000
    } = options;

    const hasTranslatorOverride = Object.prototype.hasOwnProperty.call(options, 'translator');
    const candidateTranslator = hasTranslatorOverride ? options.translator : translateFn;

    this.targetLanguage = targetLanguage.toLowerCase();
    this.enableTranslation = Boolean(enableTranslation);
    this.detectionMinLength = detectionMinLength;
    this.detectionMaxCandidates = detectionMaxCandidates;
    if (typeof candidateTranslator === 'function') {
      this.translator = candidateTranslator;
    } else if (candidateTranslator && typeof candidateTranslator.translate === 'function') {
      this.translator = (text, opts) => candidateTranslator.translate(text, opts);
    } else {
      this.translator = translateFn;
    }
    this.translationTimeoutMs = translationTimeoutMs;
    this.translationCache = new Map();
  }

  detectLanguage(text) {
    const normalized = typeof text === 'string' ? text.trim() : '';
    if (!normalized) {
      return {
        code: this.targetLanguage,
        raw: null,
        confidence: 0,
        reliability: 'empty'
      };
    }

    if (normalized.length < this.detectionMinLength && ASCII_REGEX.test(normalized)) {
      return {
        code: this.targetLanguage,
        raw: 'eng',
        confidence: 0.45,
        reliability: 'short-text'
      };
    }

    const candidates = francAll(normalized, {
      minLength: Math.min(this.detectionMinLength, Math.max(10, Math.floor(normalized.length / 2)))
    }).slice(0, this.detectionMaxCandidates);

    for (const [rawCode, distance] of candidates) {
      if (rawCode === 'und') {
        continue;
      }
      const code = normalizeLanguageCode(rawCode);
      if (!code) {
        continue;
      }
      const confidence = this.distanceToConfidence(distance);
      return {
        code,
        raw: rawCode,
        confidence,
        reliability: distance === 0 ? 'exact' : 'approx'
      };
    }

    if (ASCII_REGEX.test(normalized)) {
      return {
        code: this.targetLanguage,
        raw: 'eng',
        confidence: 0.4,
        reliability: 'fallback-ascii'
      };
    }

    return {
      code: null,
      raw: 'und',
      confidence: 0,
      reliability: 'unknown'
    };
  }

  distanceToConfidence(distance) {
    if (distance == null) {
      return 0;
    }
    if (distance === 0) {
      return 1;
    }
    const value = Math.max(0, 1 - distance / 1000);
    return Number(value.toFixed(3));
  }

  async translateText(text, sourceLanguage) {
    if (!this.enableTranslation) {
      return {
        text,
        changed: false,
        provider: null
      };
    }

    const normalized = typeof text === 'string' ? text.trim() : '';
    if (!normalized) {
      return {
        text: normalized,
        changed: false,
        provider: null
      };
    }

    const from = sourceLanguage || 'auto';
    const to = this.targetLanguage;
    if (!from || from === to || normalized.length === 0) {
      return {
        text: normalized,
        changed: false,
        provider: null
      };
    }

    const cacheKey = `${from}|${to}|${normalized}`;
    if (this.translationCache.has(cacheKey)) {
      return this.translationCache.get(cacheKey);
    }

    try {
      const translationPromise = this.translator(normalized, { from, to });
      const result = await this.withTimeout(translationPromise, this.translationTimeoutMs);
      const response = {
        text: result?.text || normalized,
        changed: Boolean(result?.text && result.text !== normalized),
        provider: 'google-translate'
      };
      this.translationCache.set(cacheKey, response);
      return response;
    } catch (error) {
      console.warn('Translation failed:', error.message || error);
      const fallback = {
        text: normalized,
        changed: false,
        provider: null
      };
      this.translationCache.set(cacheKey, fallback);
      return fallback;
    }
  }

  async processArticle({ headline, summary }) {
    const combined = [headline, summary].filter(Boolean).join(' ').trim();
    const language = this.detectLanguage(combined || headline || summary || '');
    const sourceLanguage = language.code || this.targetLanguage;

    const [translatedHeadline, translatedSummary] = await Promise.all([
      this.translateText(headline || '', sourceLanguage),
      this.translateText(summary || '', sourceLanguage)
    ]);

    return {
      language,
      translation: {
        headline: {
          original: headline || null,
          translated: translatedHeadline.text || null,
          changed: translatedHeadline.changed
        },
        summary: {
          original: summary || null,
          translated: translatedSummary.text || null,
          changed: translatedSummary.changed
        },
        provider: translatedHeadline.provider || translatedSummary.provider || null
      },
      headlineForAnalysis: translatedHeadline.text || headline || null,
      summaryForAnalysis: translatedSummary.text || summary || null
    };
  }

  async withTimeout(promise, timeoutMs) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return promise;
    }
    let timeoutHandle;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutHandle = setTimeout(
        () => reject(new Error('Translation timed out')),
        timeoutMs
      ).unref?.();
    });
    try {
      const result = await Promise.race([promise, timeoutPromise]);
      return result;
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }
}
