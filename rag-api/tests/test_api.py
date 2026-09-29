import os
from pathlib import Path

from fastapi.testclient import TestClient

os.environ.setdefault("PINECONE_API_KEY", "test-pinecone-key")
os.environ.setdefault("GOOGLE_GENAI_API_KEY", "test-google-key")
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")

from app.evaluation import JudgeQuotaExceeded, JudgeUnavailable  # noqa: E402
from app.main import app, get_evaluation_store, get_judge, get_rag_service  # noqa: E402
from app.schemas import QuestionResponse, SourcePage, UploadResponse  # noqa: E402


class FakeRagService:
    def ingest_pdf(self, path: Path, filename: str) -> UploadResponse:
        assert path.read_bytes().startswith(b"%PDF-")
        return UploadResponse(
            index_name="rag-apple-test1234",
            filename=filename,
            pages_indexed=80,
            message="PDF indexed successfully.",
        )

    def answer(self, index_name: str, question: str) -> QuestionResponse:
        assert question == "Where is Apple headquarters?"
        return QuestionResponse(
            answer="One Apple Park Way, Cupertino, California 95014.",
            index_name=index_name,
            sources=[SourcePage(filename="apple.pdf", page_number=1, score=0.9)],
            evaluation_id="eval-test-fixed-id",
        )


app.dependency_overrides[get_rag_service] = lambda: FakeRagService()
client = TestClient(app)


def test_health() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_rejects_non_pdf() -> None:
    response = client.post("/documents", files={"file": ("notes.txt", b"hello", "text/plain")})
    assert response.status_code == 415


def test_upload_and_query_contract() -> None:
    upload = client.post(
        "/documents",
        files={"file": ("apple.pdf", b"%PDF-1.7 test", "application/pdf")},
    )
    assert upload.status_code == 201
    assert upload.json()["pages_indexed"] == 80

    answer = client.post(
        "/query",
        json={
            "index_name": upload.json()["index_name"],
            "question": "Where is Apple headquarters?",
        },
    )
    assert answer.status_code == 200
    assert answer.json()["sources"][0]["page_number"] == 1
    assert answer.json()["evaluation_id"] == "eval-test-fixed-id"


def test_evaluate_unknown_id_returns_404() -> None:
    response = client.post("/evaluate", json={"evaluation_id": "does-not-exist"})
    assert response.status_code == 404


def test_evaluate_returns_judge_verdict() -> None:
    store = get_evaluation_store()
    evaluation_id = store.put(
        question="Where is Apple headquarters?",
        context="PDF page 1 (apple.pdf):\nOne Apple Park Way, Cupertino, California.",
        answer="One Apple Park Way, Cupertino, California.",
    )

    app.dependency_overrides[get_judge] = lambda: (
        lambda settings, question, context, answer: "correct"
    )
    try:
        response = client.post("/evaluate", json={"evaluation_id": evaluation_id})
    finally:
        del app.dependency_overrides[get_judge]

    assert response.status_code == 200
    assert response.json() == {"verdict": "correct"}


def test_evaluate_quota_exceeded_returns_429() -> None:
    store = get_evaluation_store()
    evaluation_id = store.put(question="Q", context="C", answer="A")

    def raise_quota_exceeded(settings, question, context, answer):
        raise JudgeQuotaExceeded("quota exhausted")

    app.dependency_overrides[get_judge] = lambda: raise_quota_exceeded
    try:
        response = client.post("/evaluate", json={"evaluation_id": evaluation_id})
    finally:
        del app.dependency_overrides[get_judge]

    assert response.status_code == 429


def test_evaluate_unavailable_returns_503() -> None:
    store = get_evaluation_store()
    evaluation_id = store.put(question="Q", context="C", answer="A")

    def raise_unavailable(settings, question, context, answer):
        raise JudgeUnavailable("judge down")

    app.dependency_overrides[get_judge] = lambda: raise_unavailable
    try:
        response = client.post("/evaluate", json={"evaluation_id": evaluation_id})
    finally:
        del app.dependency_overrides[get_judge]

    assert response.status_code == 503
