"use client";

import { FormEvent, useState } from "react";
import { Database, FileUp, Search, X } from "lucide-react";

interface UploadResult {
  index_name: string;
  filename: string;
  pages_indexed: number;
  message: string;
}
interface SourcePage {
  filename: string;
  page_number: number;
  score?: number | null;
}

interface QueryResult {
  answer: string;
  sources: SourcePage[];
}

interface DocumentQaProps {
  onClose: () => void;
}

async function readError(response: Response, fallback: string): Promise<string> {
  const data = await response.json().catch(() => ({}));
  return typeof data.error === "string" ? data.error : fallback;
}

export default function DocumentQa({ onClose }: DocumentQaProps) {
  const [file, setFile] = useState<File | null>(null);
  const [upload, setUpload] = useState<UploadResult | null>(null);
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [status, setStatus] = useState("");
  const [uploading, setUploading] = useState(false);
  const [asking, setAsking] = useState(false);

  const uploadPdf = async () => {
    if (!file || uploading) return;
    setUploading(true);
    setStatus("Creating a new Pinecone index and indexing pages...");
    setUpload(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.set("file", file);
      const response = await fetch("/api/rag/upload", { method: "POST", body: formData });
      if (!response.ok) throw new Error(await readError(response, "Upload failed."));
      const data = (await response.json()) as UploadResult;
      setUpload(data);
      setStatus(`${data.pages_indexed} pages indexed in ${data.index_name}.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const askQuestion = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedQuestion = question.trim();
    if (!upload || !trimmedQuestion || asking) return;
    setAsking(true);
    setStatus("Searching the uploaded PDF...");
    setResult(null);

    try {
      const response = await fetch("/api/rag/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index_name: upload.index_name, question: trimmedQuestion }),
      });
      if (!response.ok) throw new Error(await readError(response, "Question failed."));
      const data = (await response.json()) as QueryResult;
      setResult(data);
      setStatus("Answer grounded in the uploaded PDF.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Question failed.");
    } finally {
      setAsking(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="document-qa-title">
      <section className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 id="document-qa-title" className="flex items-center gap-2 text-2xl font-semibold text-gray-900">
              <Database size={24} className="text-blue-600" />
              PDF Q&amp;A with Pinecone
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              Each upload creates a new index. The PDF is stored as one vector record per page.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close document Q&A" className="rounded-lg p-2 text-gray-500 hover:bg-gray-100">
            <X size={20} />
          </button>
        </div>

        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
          <label htmlFor="rag-pdf" className="mb-2 block font-medium text-gray-900">1. Upload a PDF</label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              id="rag-pdf"
              aria-label="PDF file"
              type="file"
              accept="application/pdf,.pdf"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800"
            />
            <button
              type="button"
              onClick={uploadPdf}
              disabled={!file || uploading}
              className="flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              <FileUp size={18} /> {uploading ? "Indexing..." : "Create index"}
            </button>
          </div>
          {upload && (
            <p className="mt-3 text-sm text-green-700">
              Ready: {upload.filename} · {upload.pages_indexed} pages · index <code>{upload.index_name}</code>
            </p>
          )}
        </div>

        <form onSubmit={askQuestion} className="mt-5 rounded-xl border border-gray-200 p-4">
          <label htmlFor="rag-question" className="mb-2 block font-medium text-gray-900">2. Ask a question</label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              id="rag-question"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="What was Apple revenue by product in 2025?"
              disabled={!upload || asking}
              className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-gray-900 disabled:bg-gray-100"
            />
            <button
              type="submit"
              disabled={!upload || !question.trim() || asking}
              className="flex items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-2 font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              <Search size={18} /> {asking ? "Searching..." : "Ask PDF"}
            </button>
          </div>
        </form>

        {status && <p className="mt-4 text-sm text-gray-600" role="status">{status}</p>}
        {result && (
          <div className="mt-5 rounded-xl border border-blue-200 bg-blue-50 p-4">
            <h3 className="font-semibold text-gray-900">Answer</h3>
            <p className="mt-2 whitespace-pre-wrap leading-relaxed text-gray-800">{result.answer}</p>
            <h4 className="mt-4 text-sm font-semibold text-gray-900">Retrieved source pages</h4>
            <ul className="mt-1 flex flex-wrap gap-2 text-sm text-gray-700">
              {result.sources.map((source) => (
                <li key={`${source.filename}-${source.page_number}`} className="rounded-full bg-white px-3 py-1">
                  {source.filename}, page {source.page_number}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
