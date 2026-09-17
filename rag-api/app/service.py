import re
import time
import uuid
from pathlib import Path
from typing import Any

from langchain_community.document_loaders import PyPDFLoader
from langchain_core.prompts import ChatPromptTemplate
from langchain_google_genai import ChatGoogleGenerativeAI
from pinecone import Pinecone

from .config import Settings
from .schemas import QuestionResponse, SourcePage, UploadResponse


RAG_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            "You answer questions only from the supplied PDF context. "
            "If the answer is absent, say that the document does not provide it. "
            "Keep numbers and units exact. End with source page references in the form "
            "[PDF page N]. Do not use outside knowledge.\n\nContext:\n{context}",
        ),
        ("human", "{question}"),
    ]
)


def make_index_name(filename: str) -> str:
    """Return a unique Pinecone-safe index name of at most 45 characters."""

    stem = Path(filename).stem.lower()
    slug = re.sub(r"[^a-z0-9]+", "-", stem).strip("-") or "document"
    suffix = uuid.uuid4().hex[:8]
    return f"rag-{slug[:31]}-{suffix}"[:45].rstrip("-")


def load_pdf_pages(path: Path, filename: str) -> list[dict[str, Any]]:
    """Load one record per non-empty PDF page; no cross-page chunks are created."""

    documents = PyPDFLoader(str(path), mode="page").load()
    records: list[dict[str, Any]] = []
    for fallback_page, document in enumerate(documents, start=1):
        text = " ".join(document.page_content.split())
        if not text:
            continue
        page_number = int(document.metadata.get("page", fallback_page - 1)) + 1
        records.append(
            {
                "_id": f"page-{page_number}",
                "chunk_text": text,
                "filename": filename,
                "page_number": page_number,
                "chunk_strategy": "page",
            }
        )
    return records


def _as_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if hasattr(value, "to_dict"):
        return value.to_dict()
    if hasattr(value, "model_dump"):
        return value.model_dump()
    raise TypeError("Pinecone returned an unsupported response type")


class RagService:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.pc = Pinecone(api_key=settings.pinecone_api_key)
        self.llm = ChatGoogleGenerativeAI(
            model=settings.rag_chat_model,
            google_api_key=settings.google_genai_api_key,
            temperature=0,
        )

    def _wait_until_ready(self, index_name: str, timeout_seconds: int = 120) -> None:
        deadline = time.monotonic() + timeout_seconds
        while time.monotonic() < deadline:
            description = self.pc.describe_index(index_name)
            status = getattr(description, "status", None)
            ready = getattr(status, "ready", None)
            if ready is None and isinstance(status, dict):
                ready = status.get("ready")
            if ready:
                return
            time.sleep(1)
        raise TimeoutError(f"Pinecone index {index_name!r} was not ready in time")

    @staticmethod
    def _wait_until_records_indexed(index: Any, expected: int, timeout_seconds: int = 120) -> None:
        """Wait for Pinecone's eventually consistent record count before reporting success."""

        deadline = time.monotonic() + timeout_seconds
        while time.monotonic() < deadline:
            stats = index.describe_index_stats()
            total = getattr(stats, "total_vector_count", None)
            if total is None and isinstance(stats, dict):
                total = stats.get("total_vector_count")
            if int(total or 0) >= expected:
                return
            time.sleep(1)
        raise TimeoutError("Uploaded pages were not searchable in Pinecone in time")

    def ingest_pdf(self, path: Path, filename: str) -> UploadResponse:
        records = load_pdf_pages(path, filename)
        if not records:
            raise ValueError("The PDF does not contain extractable text.")

        index_name = make_index_name(filename)
        self.pc.create_index_for_model(
            name=index_name,
            cloud=self.settings.pinecone_cloud,
            region=self.settings.pinecone_region,
            embed={
                "model": self.settings.pinecone_embed_model,
                "field_map": {"text": "chunk_text"},
            },
        )
        self._wait_until_ready(index_name)
        index = self.pc.Index(index_name)

        # Pinecone accepts at most 96 text records per integrated-embedding batch.
        for start in range(0, len(records), 96):
            index.upsert_records(
                self.settings.rag_namespace,
                records[start : start + 96],
            )
        self._wait_until_records_indexed(index, len(records))

        return UploadResponse(
            index_name=index_name,
            filename=filename,
            pages_indexed=len(records),
            message="PDF indexed successfully. You can now ask questions about it.",
        )

    def answer(self, index_name: str, question: str) -> QuestionResponse:
        known_indexes = set(self.pc.list_indexes().names())
        if index_name not in known_indexes:
            raise LookupError("The requested Pinecone index does not exist.")

        index = self.pc.Index(index_name)
        raw_result = index.search(
            namespace=self.settings.rag_namespace,
            query={"inputs": {"text": question}, "top_k": self.settings.rag_top_k},
            fields=["chunk_text", "filename", "page_number"],
        )
        result = _as_dict(raw_result)
        hits = result.get("result", {}).get("hits", [])
        if not hits:
            raise LookupError("No relevant pages were found in this document.")

        context_parts: list[str] = []
        sources: list[SourcePage] = []
        seen_pages: set[int] = set()
        for hit in hits:
            fields = hit.get("fields", {})
            page_number = int(fields.get("page_number", 0))
            filename = str(fields.get("filename", "uploaded PDF"))
            text = str(fields.get("chunk_text", ""))
            context_parts.append(f"PDF page {page_number} ({filename}):\n{text}")
            if page_number not in seen_pages:
                sources.append(
                    SourcePage(
                        filename=filename,
                        page_number=page_number,
                        score=hit.get("_score"),
                    )
                )
                seen_pages.add(page_number)

        messages = RAG_PROMPT.format_messages(
            context="\n\n---\n\n".join(context_parts), question=question
        )
        response = self.llm.invoke(messages)
        answer = response.content if isinstance(response.content, str) else str(response.content)
        return QuestionResponse(answer=answer, index_name=index_name, sources=sources)
