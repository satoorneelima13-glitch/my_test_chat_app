export interface ModelOption {
  value: string;
  label: string;
}

export const MODELS: ModelOption[] = [
  { value: "gemini-3.5-flash", label: "Gemini 3.5 Flash" },
  { value: "gemini-3-flash-preview", label: "Gemini 3 Flash" },
  { value: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite" },
];

export const MODEL_IDS = new Set(MODELS.map((model) => model.value));

export const DEFAULT_MODEL = MODELS[0].value;
