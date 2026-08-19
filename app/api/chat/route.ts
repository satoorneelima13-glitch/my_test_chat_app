import { GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const allowedModels = new Set([
  "gemini-3.5-flash",
  "gemini-3-flash-preview",
  "gemini-3.1-flash-lite",
]);

export async function POST(request: NextRequest) {
  try {
    const { messages, model } = await request.json();

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: "At least one message is required" },
        { status: 400 }
      );
    }

    const selectedModel = allowedModels.has(model)
      ? model
      : "gemini-3.5-flash";

    const apiKey = process.env.GOOGLE_GENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "API key not configured" },
        { status: 500 }
      );
    }

    const ai = new GoogleGenAI({ apiKey });
    const contents = messages.map(
      (message: { role: string; content: string }) => ({
        role: message.role === "user" ? "user" : "model",
        parts: [{ text: message.content }],
      })
    );

    const response = await ai.models.generateContent({
      model: selectedModel,
      contents,
    });

    const text =
      response.candidates?.[0]?.content?.parts?.[0]?.text ||
      "No response generated";

    return NextResponse.json({ text, model: selectedModel });
  } catch (error) {
    console.error("Chat API error:", error);
    return NextResponse.json(
      { error: "Failed to generate response" },
      { status: 500 }
    );
  }
}
