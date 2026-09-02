// Capability rules for Gemini generation-config settings, shared by the API
// route and the UI so both enforce the same thing.
//
// Evidence (checked against the official v1beta discovery document at
// generativelanguage.googleapis.com/$discovery/rest?version=v1beta, and the
// ai.google.dev docs pages for gemini-3.5-flash, gemini-3-flash-preview, and
// gemini-3.1-flash-lite — not extrapolated from other API surfaces):
//
// - temperature: schema range [0.0, 2.0]. Google's Gemini 3 guide explicitly
//   recommends keeping it at the default of 1.0 for all Gemini 3.x models.
// - topP, seed, maxOutputTokens, stopSequences: documented with no per-model
//   exclusion language.
// - stopSequences: schema description states "up to 5" sequences.
// - topK: the schema's own description says support is decided per model via
//   that model's `Model.top_k` attribute (only readable through a live,
//   keyed `models.get` call) — none of the three model doc pages state
//   whether that attribute is present for them.
// - frequencyPenalty, presencePenalty: no per-model exclusion language in the
//   schema, but also no model page confirms support. Unverified either way.
//
// topK/frequencyPenalty/presencePenalty are therefore "unverified" rather
// than "unsupported" — we don't have evidence either way — and are rejected
// rather than silently forwarded.

export type SettingKey =
  | "temperature"
  | "topP"
  | "topK"
  | "maxOutputTokens"
  | "frequencyPenalty"
  | "presencePenalty"
  | "stopSequences"
  | "seed";

export type SettingSupport = "supported" | "unverified";

const BASE_CAPABILITY: Record<SettingKey, SettingSupport> = {
  temperature: "supported",
  topP: "supported",
  topK: "unverified",
  maxOutputTokens: "supported",
  frequencyPenalty: "unverified",
  presencePenalty: "unverified",
  stopSequences: "supported",
  seed: "supported",
};

// Keyed by model (even though every currently-available model resolves to
// the same table today) so a future model with documented support can
// override without changing any call site.
export function getSettingSupport(_model: string, key: SettingKey): SettingSupport {
  return BASE_CAPABILITY[key];
}

export const UNVERIFIED_SETTING_KEYS = (Object.keys(BASE_CAPABILITY) as SettingKey[]).filter(
  (key) => BASE_CAPABILITY[key] === "unverified"
);

export const MAX_STOP_SEQUENCES = 5;
export const MAX_OUTPUT_TOKENS_LIMIT = 65536;

export interface RawGenerationSettings {
  temperature?: unknown;
  topP?: unknown;
  topK?: unknown;
  maxOutputTokens?: unknown;
  frequencyPenalty?: unknown;
  presencePenalty?: unknown;
  stopSequences?: unknown;
  seed?: unknown;
}

export interface ValidatedGenerationConfig {
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  stopSequences?: string[];
  seed?: number;
}

export class SettingsValidationError extends Error {
  field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = "SettingsValidationError";
    this.field = field;
  }
}

const isPresent = (value: unknown): boolean => value !== undefined && value !== null;

function requireFiniteNumber(field: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new SettingsValidationError(field, `"${field}" must be a finite number.`);
  }
  return value;
}

/**
 * Pure function: validates a raw, untrusted settings payload into the subset
 * of GenerateContentConfig fields actually sent to the Gemini API. Throws
 * SettingsValidationError on any invalid value instead of clamping or
 * dropping it. Fields that are absent (undefined/null) are treated as
 * genuinely unset and omitted from the result; valid zero values are kept.
 */
export function buildGenerationConfig(raw: unknown): ValidatedGenerationConfig {
  if (raw === null || raw === undefined) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new SettingsValidationError("settings", '"settings" must be an object.');
  }

  const settings = raw as RawGenerationSettings;

  for (const field of UNVERIFIED_SETTING_KEYS) {
    if (isPresent(settings[field])) {
      throw new SettingsValidationError(
        field,
        `"${field}" is not sent to the model: support is not verified for any available model.`
      );
    }
  }

  const config: ValidatedGenerationConfig = {};

  if (isPresent(settings.temperature)) {
    const temperature = requireFiniteNumber("temperature", settings.temperature);
    if (temperature < 0 || temperature > 2) {
      throw new SettingsValidationError("temperature", '"temperature" must be between 0 and 2.');
    }
    config.temperature = temperature;
  }

  if (isPresent(settings.topP)) {
    const topP = requireFiniteNumber("topP", settings.topP);
    if (topP < 0 || topP > 1) {
      throw new SettingsValidationError("topP", '"topP" must be between 0 and 1.');
    }
    config.topP = topP;
  }

  if (isPresent(settings.maxOutputTokens)) {
    const maxOutputTokens = requireFiniteNumber("maxOutputTokens", settings.maxOutputTokens);
    if (
      !Number.isInteger(maxOutputTokens) ||
      maxOutputTokens < 1 ||
      maxOutputTokens > MAX_OUTPUT_TOKENS_LIMIT
    ) {
      throw new SettingsValidationError(
        "maxOutputTokens",
        `"maxOutputTokens" must be an integer between 1 and ${MAX_OUTPUT_TOKENS_LIMIT}.`
      );
    }
    config.maxOutputTokens = maxOutputTokens;
  }

  if (isPresent(settings.seed)) {
    const seed = requireFiniteNumber("seed", settings.seed);
    if (!Number.isInteger(seed)) {
      throw new SettingsValidationError("seed", '"seed" must be an integer.');
    }
    config.seed = seed;
  }

  if (isPresent(settings.stopSequences)) {
    if (!Array.isArray(settings.stopSequences)) {
      throw new SettingsValidationError("stopSequences", '"stopSequences" must be an array of strings.');
    }
    if (settings.stopSequences.length > MAX_STOP_SEQUENCES) {
      throw new SettingsValidationError(
        "stopSequences",
        `"stopSequences" supports at most ${MAX_STOP_SEQUENCES} entries.`
      );
    }
    if (settings.stopSequences.some((entry) => typeof entry !== "string" || entry.length === 0)) {
      throw new SettingsValidationError("stopSequences", '"stopSequences" entries must be non-empty strings.');
    }
    if (settings.stopSequences.length > 0) {
      config.stopSequences = settings.stopSequences as string[];
    }
  }

  return config;
}
