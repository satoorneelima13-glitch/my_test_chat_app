import { MAX_STOP_SEQUENCES, RawGenerationSettings } from "./generationSettings";

// Form state for the five controllable settings. topK, frequencyPenalty, and
// presencePenalty are intentionally not represented here: their controls are
// permanently disabled (support unverified for every available model), so
// there is nothing to parse for them — see Chat.tsx.
export interface SettingsFormState {
  temperature: string;
  topP: string;
  maxOutputTokens: string;
  stopSequences: string;
  seed: string;
}

export const DEFAULT_SETTINGS_FORM: SettingsFormState = {
  temperature: "0.5",
  topP: "",
  maxOutputTokens: "",
  stopSequences: "",
  seed: "",
};

export interface ParsedSettingsResult {
  settings: RawGenerationSettings;
  error: string | null;
}

const parseOptionalNumber = (field: string, raw: string, errors: string[]): number | undefined => {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    errors.push(`"${field}" must be a number.`);
    return undefined;
  }
  return value;
};

/**
 * Pure function: turns the settings form's string inputs into the raw
 * settings payload sent to /api/chat, doing client-side sanity checks
 * (numeric parsing, max stop-sequence count) so obviously invalid input is
 * rejected before a network round trip. The server independently re-validates
 * everything via buildGenerationConfig — this function does not replace that.
 */
export function parseSettingsForm(form: SettingsFormState): ParsedSettingsResult {
  const errors: string[] = [];
  const settings: RawGenerationSettings = {};

  const temperature = parseOptionalNumber("Temperature", form.temperature, errors);
  if (temperature !== undefined) settings.temperature = temperature;

  const topP = parseOptionalNumber("Top P", form.topP, errors);
  if (topP !== undefined) settings.topP = topP;

  const maxOutputTokens = parseOptionalNumber("Max output tokens", form.maxOutputTokens, errors);
  if (maxOutputTokens !== undefined) settings.maxOutputTokens = maxOutputTokens;

  const seed = parseOptionalNumber("Seed", form.seed, errors);
  if (seed !== undefined) settings.seed = seed;

  const stopSequences = form.stopSequences
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (stopSequences.length > MAX_STOP_SEQUENCES) {
    errors.push(`Stop sequences supports at most ${MAX_STOP_SEQUENCES} entries.`);
  } else if (stopSequences.length > 0) {
    settings.stopSequences = stopSequences;
  }

  return {
    settings,
    error: errors.length > 0 ? errors.join(" ") : null,
  };
}
