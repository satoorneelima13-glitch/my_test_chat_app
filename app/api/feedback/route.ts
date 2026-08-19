import { appendFile, mkdir, stat } from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const csvCell = (value: string) => {
  const safeValue = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safeValue.replace(/"/g, '""')}"`;
};

export async function POST(request: NextRequest) {
  try {
    const { prompt, response, feedback } = await request.json();

    if (
      typeof prompt !== "string" ||
      typeof response !== "string" ||
      !["positive", "negative"].includes(feedback)
    ) {
      return NextResponse.json(
        { error: "Invalid feedback data" },
        { status: 400 }
      );
    }

    const dataDirectory = path.join(process.cwd(), "data");
    const csvPath = path.join(dataDirectory, "feedback.csv");
    await mkdir(dataDirectory, { recursive: true });

    let needsHeader = false;
    try {
      const fileStats = await stat(csvPath);
      needsHeader = fileStats.size === 0;
    } catch {
      needsHeader = true;
    }

    const header = needsHeader ? "prompt,response,feedback\n" : "";
    const row = [prompt, response, feedback].map(csvCell).join(",") + "\n";
    await appendFile(csvPath, header + row, "utf8");

    return NextResponse.json({ saved: true });
  } catch (error) {
    console.error("Feedback API error:", error);
    return NextResponse.json(
      { error: "Failed to save feedback" },
      { status: 500 }
    );
  }
}
