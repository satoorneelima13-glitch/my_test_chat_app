import { test, expect } from "@playwright/test";
import { DEFAULT_SETTINGS_FORM, parseSettingsForm } from "../../app/lib/settingsForm";

test.describe("parseSettingsForm", () => {
  test("the default form parses to temperature 0.5, zeroed penalties, and nothing else set", () => {
    const { settings, error } = parseSettingsForm(DEFAULT_SETTINGS_FORM);
    expect(error).toBeNull();
    expect(settings).toEqual({ temperature: 0.5, frequencyPenalty: 0, presencePenalty: 0 });
  });

  test("a blank field is omitted, not sent as zero", () => {
    const { settings } = parseSettingsForm({
      ...DEFAULT_SETTINGS_FORM,
      temperature: "",
      frequencyPenalty: "",
      presencePenalty: "",
    });
    expect(settings.temperature).toBeUndefined();
    expect(settings.frequencyPenalty).toBeUndefined();
    expect(settings.presencePenalty).toBeUndefined();
  });

  test("topK is parsed like the other optional numeric fields", () => {
    const blank = parseSettingsForm(DEFAULT_SETTINGS_FORM);
    expect(blank.settings.topK).toBeUndefined();

    const filled = parseSettingsForm({ ...DEFAULT_SETTINGS_FORM, topK: "20" });
    expect(filled.error).toBeNull();
    expect(filled.settings.topK).toBe(20);
  });

  test("an explicitly typed zero is preserved", () => {
    const { settings, error } = parseSettingsForm({ ...DEFAULT_SETTINGS_FORM, temperature: "0" });
    expect(error).toBeNull();
    expect(settings.temperature).toBe(0);
  });

  test("non-numeric input produces a client-side error naming the field", () => {
    const { error } = parseSettingsForm({ ...DEFAULT_SETTINGS_FORM, topP: "abc" });
    expect(error).toContain("Top P");
  });

  test("splits, trims, and drops empty entries in the stop-sequences field", () => {
    const { settings, error } = parseSettingsForm({
      ...DEFAULT_SETTINGS_FORM,
      stopSequences: " STOP , END ,, ",
    });
    expect(error).toBeNull();
    expect(settings.stopSequences).toEqual(["STOP", "END"]);
  });

  test("rejects more than five stop sequences client-side instead of truncating", () => {
    const { error, settings } = parseSettingsForm({
      ...DEFAULT_SETTINGS_FORM,
      stopSequences: "a,b,c,d,e,f",
    });
    expect(error).toContain("5");
    expect(settings.stopSequences).toBeUndefined();
  });
});
