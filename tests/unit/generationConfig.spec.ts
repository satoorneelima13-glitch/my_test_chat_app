import { test, expect } from "@playwright/test";
import {
  buildGenerationConfig,
  SettingsValidationError,
  MAX_STOP_SEQUENCES,
  MAX_OUTPUT_TOKENS_LIMIT,
} from "../../app/lib/generationSettings";

test.describe("buildGenerationConfig", () => {
  test("returns an empty config when settings is unset", () => {
    expect(buildGenerationConfig(undefined)).toEqual({});
    expect(buildGenerationConfig(null)).toEqual({});
    expect(buildGenerationConfig({})).toEqual({});
  });

  test("preserves valid zero values instead of treating them as unset", () => {
    expect(
      buildGenerationConfig({ temperature: 0, topP: 0, seed: 0, frequencyPenalty: 0, presencePenalty: 0 })
    ).toEqual({
      temperature: 0,
      topP: 0,
      seed: 0,
      frequencyPenalty: 0,
      presencePenalty: 0,
    });
  });

  test("accepts values within range and omits fields that were never sent", () => {
    expect(
      buildGenerationConfig({
        temperature: 0.5,
        topP: 0.9,
        topK: 20,
        maxOutputTokens: 1024,
        frequencyPenalty: 1.5,
        presencePenalty: -0.5,
        seed: 42,
        stopSequences: ["STOP", "END"],
      })
    ).toEqual({
      temperature: 0.5,
      topP: 0.9,
      topK: 20,
      maxOutputTokens: 1024,
      frequencyPenalty: 1.5,
      presencePenalty: -0.5,
      seed: 42,
      stopSequences: ["STOP", "END"],
    });
  });

  test("rejects out-of-range temperature and topP instead of clamping", () => {
    expect(() => buildGenerationConfig({ temperature: 2.5 })).toThrow(SettingsValidationError);
    expect(() => buildGenerationConfig({ temperature: -0.1 })).toThrow(SettingsValidationError);
    expect(() => buildGenerationConfig({ topP: 1.1 })).toThrow(SettingsValidationError);
    expect(() => buildGenerationConfig({ topP: -0.01 })).toThrow(SettingsValidationError);
  });

  test("rejects non-finite temperature/topP/seed", () => {
    expect(() => buildGenerationConfig({ temperature: "0.5" })).toThrow(SettingsValidationError);
    expect(() => buildGenerationConfig({ temperature: NaN })).toThrow(SettingsValidationError);
  });

  test("rejects non-integer or out-of-range maxOutputTokens, accepts the documented max", () => {
    expect(() => buildGenerationConfig({ maxOutputTokens: 0 })).toThrow(SettingsValidationError);
    expect(() => buildGenerationConfig({ maxOutputTokens: 1.5 })).toThrow(SettingsValidationError);
    expect(() =>
      buildGenerationConfig({ maxOutputTokens: MAX_OUTPUT_TOKENS_LIMIT + 1 })
    ).toThrow(SettingsValidationError);
    expect(buildGenerationConfig({ maxOutputTokens: MAX_OUTPUT_TOKENS_LIMIT })).toEqual({
      maxOutputTokens: MAX_OUTPUT_TOKENS_LIMIT,
    });
  });

  test("rejects a non-integer seed", () => {
    expect(() => buildGenerationConfig({ seed: 1.5 })).toThrow(SettingsValidationError);
  });

  test("enforces a maximum of five stop sequences by rejecting, not truncating", () => {
    const six = ["a", "b", "c", "d", "e", "f"];
    expect(six.length).toBeGreaterThan(MAX_STOP_SEQUENCES);
    expect(() => buildGenerationConfig({ stopSequences: six })).toThrow(SettingsValidationError);

    const five = six.slice(0, 5);
    expect(buildGenerationConfig({ stopSequences: five })).toEqual({ stopSequences: five });
  });

  test("rejects non-string stop sequence entries and empty strings", () => {
    expect(() => buildGenerationConfig({ stopSequences: ["ok", 5] })).toThrow(SettingsValidationError);
    expect(() => buildGenerationConfig({ stopSequences: ["ok", ""] })).toThrow(SettingsValidationError);
  });

  test("treats an empty stopSequences array as equivalent to unset", () => {
    expect(buildGenerationConfig({ stopSequences: [] })).toEqual({});
  });

  test("accepts topK as a positive integer, rejects non-integer or non-positive values", () => {
    expect(buildGenerationConfig({ topK: 1 })).toEqual({ topK: 1 });
    expect(buildGenerationConfig({ topK: 40 })).toEqual({ topK: 40 });
    expect(() => buildGenerationConfig({ topK: 0 })).toThrow(SettingsValidationError);
    expect(() => buildGenerationConfig({ topK: -1 })).toThrow(SettingsValidationError);
    expect(() => buildGenerationConfig({ topK: 1.5 })).toThrow(SettingsValidationError);

    try {
      buildGenerationConfig({ topK: 0 });
      throw new Error("expected buildGenerationConfig to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(SettingsValidationError);
      expect((err as InstanceType<typeof SettingsValidationError>).field).toBe("topK");
    }
  });

  test("accepts frequencyPenalty and presencePenalty within -2..2, rejects outside it", () => {
    expect(buildGenerationConfig({ frequencyPenalty: -2 })).toEqual({ frequencyPenalty: -2 });
    expect(buildGenerationConfig({ frequencyPenalty: 2 })).toEqual({ frequencyPenalty: 2 });
    expect(buildGenerationConfig({ presencePenalty: -2 })).toEqual({ presencePenalty: -2 });
    expect(buildGenerationConfig({ presencePenalty: 2 })).toEqual({ presencePenalty: 2 });
    expect(() => buildGenerationConfig({ frequencyPenalty: 2.1 })).toThrow(SettingsValidationError);
    expect(() => buildGenerationConfig({ frequencyPenalty: -2.1 })).toThrow(SettingsValidationError);
    expect(() => buildGenerationConfig({ presencePenalty: 2.1 })).toThrow(SettingsValidationError);
    expect(() => buildGenerationConfig({ presencePenalty: -2.1 })).toThrow(SettingsValidationError);
  });

  test("rejects a non-object settings payload", () => {
    expect(() => buildGenerationConfig("nope")).toThrow(SettingsValidationError);
    expect(() => buildGenerationConfig(["array"])).toThrow(SettingsValidationError);
    expect(() => buildGenerationConfig(42)).toThrow(SettingsValidationError);
  });
});
