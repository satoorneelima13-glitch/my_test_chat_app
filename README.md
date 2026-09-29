# Gemini Chat App with Pinecone PDF RAG

A full-stack assistant with general Gemini chat and PDF Q&A using FastAPI, LangChain, page-based chunking, and Pinecone.

The Week 5 implementation creates a **new Pinecone index for every uploaded PDF**. Each non-empty PDF page becomes one vector record, keeping its filename and page number as metadata for citations.

## Architecture

```mermaid
flowchart TD
    U[User] -->|Upload PDF| N[Next.js chat UI]
    N -->|Multipart proxy| F[FastAPI RAG service]
    F -->|PyPDFLoader page mode| C[One record per PDF page]
    C -->|New index and text upsert| P[(Pinecone)]
    U -->|Ask question| N
    N -->|Question and index name| F
    F -->|Semantic search| P
    P -->|Relevant pages| F
    F -->|LangChain context prompt| G[Gemini]
    G -->|Grounded answer| F
    F -->|Answer, source pages, evaluation_id| N
    U -->|Evaluate this answer| N
    N -->|evaluation_id| F
    F -->|Stored question/context/answer| J[Gemini judge]
    J -->|correct or incorrect| F
    F -->|Verdict| N
```

## Week 6: live answer evaluation

Every `/query` answer can be checked with an **"Evaluate this answer"** button in the PDF Q&A dialog. The judge (Gemini, `JUDGE_MODEL`) evaluates the exact answer already on screen against the exact retrieved page text that produced it — it never re-retrieves pages or regenerates the answer.

How it works:

- `RagService.answer()` stores `{question, context, answer}` server-side in an in-memory `EvaluationStore` (`rag-api/app/evaluation_store.py`, TTL + size-capped) and returns an opaque `evaluation_id` alongside the normal `/query` response. The reference page text never reaches the browser.
- Clicking the button calls the Next.js proxy `POST /api/rag/evaluate` → FastAPI `POST /evaluate`, which looks up the stored record by id and judges it with the shared `judge_answer()` helper in `rag-api/app/evaluation.py` (also used by the batch script `run_evaluations.py`, which still generates its own answers with `INITIAL_ANSWER_MODEL` / GPT-4o-mini before judging them).
- The response is only ever `{"verdict": "correct"}` or `{"verdict": "incorrect"}`.
- Evaluation is entirely optional: asking a question never calls the judge, so a judge outage cannot block or slow down normal Q&A. The button surfaces four states of its own: loading, a verdict (correct/incorrect), **quota exceeded** (HTTP 429), **temporarily unavailable** (HTTP 503, after the judge's own retry attempts are exhausted), and a generic error for anything else.
- The evaluation store is in-memory per FastAPI process — evaluation ids do not survive a server restart and are not shared across multiple workers/instances.

## RAG design

| Requirement | Implementation |
| --- | --- |
| Pinecone vector store | Serverless Pinecone index with integrated `llama-text-embed-v2` embeddings |
| New index per file | Unique filename-based index name with a random suffix |
| Chunking by page | LangChain `PyPDFLoader(mode="page")`; one non-empty page per record |
| LangChain | PDF loading, prompt construction, and Gemini model orchestration |
| FastAPI | `/documents`, `/query`, and `/health` endpoints |
| Chat integration | **PDF Q&A** dialog in the existing Next.js assistant |
| Citations | Filename and one-based PDF page number stored and returned as metadata |

## Apple 2025 Form 10-K answers

Upload `rag-api/sample_docs/apple-10-k-2025.pdf`, then ask the homework questions.

### 1. Apple revenue by products and services

Fiscal 2025 net sales (dollars in millions):

| Category | Net sales |
| --- | ---: |
| iPhone | $209,586 million |
| Mac | $33,708 million |
| iPad | $28,023 million |
| Wearables, Home and Accessories | $35,686 million |
| Services | $109,158 million |
| **Total** | **$416,161 million** |

Source: PDF page 26 (printed Form 10-K page 23).

### 2. Apple headquarters

**One Apple Park Way, Cupertino, California 95014.**

Sources: PDF pages 1 and 20. See [`rag-api/EXPECTED_ANSWERS.md`](rag-api/EXPECTED_ANSWERS.md) for the verification checklist.

## Prerequisites

- Node.js 20+
- Python 3.11+
- A [Pinecone API key](https://app.pinecone.io/)
- A [Google AI Studio API key](https://aistudio.google.com/apikey)

The Pinecone skills requested for the assignment were installed with:

```bash
npx skills add pinecone-io/skills
```

They are recorded in `.agents/skills/` and `skills-lock.json`.

## Setup

### 1. FastAPI RAG service

```bash
cd rag-api
python -m venv .venv
```

Windows PowerShell:

```powershell
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```

macOS/Linux:

```bash
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Set real values for `PINECONE_API_KEY`, `GOOGLE_GENAI_API_KEY`, and `OPENAI_API_KEY` (used by the Week 6 batch evaluation script) in `rag-api/.env`, then run:

```bash
uvicorn app.main:app --reload --port 8000
```

FastAPI docs: [http://localhost:8000/docs](http://localhost:8000/docs).

### 2. Next.js chatbot

From the repository root:

```bash
npm install
```

Copy `.env.local.example` to `.env.local`, set your Google key, and keep:

```text
RAG_API_BASE_URL=http://localhost:8000
```

Run `npm run dev`, open [http://localhost:3000](http://localhost:3000), choose **PDF Q&A**, upload the Apple filing, and ask questions.

> Pinecone plans limit index counts. Since the homework requires a new index per upload, delete old practice indexes when you reach your plan limit.

## API contract

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Service health check |
| `POST` | `/documents` | Upload PDF, create index, and index each page |
| `POST` | `/query` | Ask a question using the returned `index_name`; response includes an `evaluation_id` |
| `POST` | `/evaluate` | Judge the answer behind an `evaluation_id`; returns `{"verdict": "correct" \| "incorrect"}` |

Example query:

```json
{
  "index_name": "rag-10-k-2025-as-filed-a1b2c3d4",
  "question": "Where is Apple headquarters?"
}
```

## Original chat features

- Gemini model selection and streaming
- Temperature, Top P, Top K, output tokens, frequency penalty, presence penalty, stop sequences, and seed
- Explanatory tooltips and client/server validation
- Cancellation, partial-response preservation, and sanitized errors

## Verification

```bash
npx tsc --noEmit
npm run test:unit
npm run test:ui

cd rag-api
pytest -q
```

Automated tests use mocks/local fixtures and do not spend API quota. A live cloud test requires your keys.

## Security

- Never commit `.env`, `.env.local`, or API keys.
- The browser uses server-side Next.js proxy routes, so keys are not exposed in client code.
- Uploads are limited to valid PDFs and 20 MB by default.
- Temporary files are deleted after ingestion.
