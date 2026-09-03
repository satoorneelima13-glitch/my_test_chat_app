// Validation for Gemini generation-config settings, shared by the API route
// and the UI so both enforce the same thing.
//
// Editability and provider support are deliberately kept separate: every
// field here is user-editable and range-checked by us, but whether a given
// model actually accepts a given field is decided by the provider, not by
// this code. If Gemini rejects a field for a specific model, that surfaces
// as a sanitized error from the API route (see app/api/chat/route.ts) at
// request time — we never pre-emptively block or silently drop a field the
// user set, and we never retry automatically.
//
// Range sources: the official v1beta discovery document at
// generativelanguage.googleapis.com/$discovery/rest?version=v1beta (temperature
// [0.0, 2.0]; stopSequences "up to 5") plus this app's own product
// requirements for topK, frequencyPenalty, presencePenalty, and
// maxOutputTokens (capped at 65536, the documented output-token limit for
// gemini-3.5-flash, gemini-3-flash-preview, and gemini-3.1-flash-lite).

export type SettingKey =
  | "temperature"
  | "topP"
  | "topK"
  | "maxOutputTokens"
  | "frequencyPenalty"
  | "presencePenalty"
  | "stopSequences"
  | "seed";

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
  topK?: number;
  maxOutputTokens?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
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

  if (isPresent(settings.topK)) {
    const topK = requireFiniteNumber("topK", settings.topK);
    if (!Number.isInteger(topK) || topK < 1) {
      throw new SettingsValidationError("topK", '"topK" must be a positive integer (1 or greater).');
    }
    config.topK = topK;
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

  if (isPresent(settings.frequencyPenalty)) {
    const frequencyPenalty = requireFiniteNumber("frequencyPenalty", settings.frequencyPenalty);
    if (frequencyPenalty < -2 || frequencyPenalty > 2) {
      throw new SettingsValidationError(
        "frequencyPenalty",
        '"frequencyPenalty" must be between -2 and 2.'
      );
    }
    config.frequencyPenalty = frequencyPenalty;
  }

  if (isPresent(settings.presencePenalty)) {
    const presencePenalty = requireFiniteNumber("presencePenalty", settings.presencePenalty);
    if (presencePenalty < -2 || presencePenalty > 2) {
      throw new SettingsValidationError(
        "presencePenalty",
        '"presencePenalty" must be between -2 and 2.'
      );
    }
    config.presencePenalty = presencePenalty;
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
