import { GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_MODEL, MODEL_IDS } from "../../lib/models";
import { buildGenerationConfig, SettingsValidationError } from "../../lib/generationSettings";
import { encodeStreamEvent } from "../../lib/streamProtocol";
import { createSyntheticStream, TEST_SYNTHETIC_STREAM_MODEL } from "../../lib/streamTestFixture";

export const runtime = "nodejs";

// Streams any async source of { text } chunks to the client as NDJSON
// StreamEvents (see app/lib/streamProtocol.ts), used for both the real
// Gemini stream and the local test fixture stream so the relay/cleanup
// logic — abort wiring, single-close guarantee, resource release — is
// exercised identically by both.
function streamNdjsonResponse(
  chunkSource: AsyncGenerator<{ text?: string }>,
  modelName: string,
  clientSignal: AbortSignal,
  onAbort?: () => void
): Response {
  const encoder = new TextEncoder();
  let aborted = clientSignal.aborted;

  const handleAbort = () => {
    aborted = true;
    onAbort?.();
  };
  if (aborted) {
    onAbort?.();
  } else {
    clientSignal.addEventListener("abort", handleAbort);
  }

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const safeEnqueue = (event: Parameters<typeof encodeStreamEvent>[0]) => {
        if (closed || aborted) return;
        try {
          controller.enqueue(encoder.encode(encodeStreamEvent(event)));
        } catch {
          // Controller already closed/errored (e.g. client disconnected
          // mid-write) — nothing more we can do, and nothing to crash over.
        }
      };

      try {
        for await (const chunk of chunkSource) {
          if (aborted) break;
          if (chunk.text) safeEnqueue({ type: "chunk", text: chunk.text });
        }
        if (!aborted) safeEnqueue({ type: "done", model: modelName });
      } catch (error) {
        if (!aborted) {
          console.error("Chat stream error:", error);
          safeEnqueue({ type: "error", message: "Streaming failed. Please try again." });
        }
      } finally {
        closed = true;
        clientSignal.removeEventListener("abort", handleAbort);
        try {
          controller.close();
        } catch {
          // Already closed by the runtime (e.g. following a cancel()).
        }
      }
    },
    cancel() {
      // The client stopped reading (Stop button, navigation, or a dropped
      // connection). Make sure the upstream generator is told to give up
      // too, not just that we stop relaying its output.
      handleAbort();
      chunkSource.return?.(undefined).catch(() => {});
    },
  });

  return new Response(body, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
  });
}

export async function POST(request: NextRequest) {
  try {
    const { messages, model, settings, stream } = await request.json();

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: "At least one message is required" },
        { status: 400 }
      );
    }

    if (stream !== undefined && typeof stream !== "boolean") {
      return NextResponse.json(
        { error: '"stream" must be a boolean.' },
        { status: 400 }
      );
    }

    let generationConfig;
    try {
      generationConfig = buildGenerationConfig(settings);
    } catch (validationError) {
      if (validationError instanceof SettingsValidationError) {
        return NextResponse.json(
          { error: validationError.message, field: validationError.field },
          { status: 400 }
        );
      }
      throw validationError;
    }

    // Dev/test-only seam: never reachable in a production build, since
    // NODE_ENV is always "production" there regardless of what a client
    // sends. Lets the local streaming test suite exercise the real
    // ReadableStream relay, abort handling, and client parsing over a real
    // connection without an API key or a call to Gemini.
    if (
      process.env.NODE_ENV !== "production" &&
      stream === true &&
      model === TEST_SYNTHETIC_STREAM_MODEL
    ) {
      return streamNdjsonResponse(createSyntheticStream(), TEST_SYNTHETIC_STREAM_MODEL, request.signal);
    }

    const selectedModel = MODEL_IDS.has(model) ? model : DEFAULT_MODEL;

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

    if (stream === true) {
      // Bridges the client's disconnect/Stop into the SDK's own request, so
      // an aborted client stops the upstream Gemini call too, not just our
      // relay of it.
      const upstreamAbort = new AbortController();
      const generator = await ai.models.generateContentStream({
        model: selectedModel,
        contents,
        config: { ...generationConfig, abortSignal: upstreamAbort.signal },
      });
      return streamNdjsonResponse(generator, selectedModel, request.signal, () =>
        upstreamAbort.abort()
      );
    }

    const response = await ai.models.generateContent({
      model: selectedModel,
      contents,
      config: { ...generationConfig, abortSignal: request.signal },
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
