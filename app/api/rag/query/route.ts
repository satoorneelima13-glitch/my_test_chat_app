import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const ragApiBaseUrl = process.env.RAG_API_BASE_URL;
  if (!ragApiBaseUrl) {
    return NextResponse.json(
      { error: "Document Q&A service is not configured." },
      { status: 503 }
    );
  }

  try {
    const payload = await request.json();
    const response = await fetch(`${ragApiBaseUrl.replace(/\/$/, "")}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: request.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return NextResponse.json(
        { error: data.detail || "The question could not be answered." },
        { status: response.status }
      );
    }
    return NextResponse.json(data);
  } catch (error) {
    console.error("RAG query proxy error:", error);
    return NextResponse.json(
      { error: "The document service is unavailable." },
      { status: 502 }
    );
  }
}
