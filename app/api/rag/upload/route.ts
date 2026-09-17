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
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Choose a PDF to upload." }, { status: 400 });
    }

    const upstream = new FormData();
    upstream.set("file", file, file.name);
    const response = await fetch(`${ragApiBaseUrl.replace(/\/$/, "")}/documents`, {
      method: "POST",
      body: upstream,
      signal: request.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return NextResponse.json(
        { error: data.detail || "The PDF could not be indexed." },
        { status: response.status }
      );
    }
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    console.error("RAG upload proxy error:", error);
    return NextResponse.json(
      { error: "The document service is unavailable." },
      { status: 502 }
    );
  }
}
