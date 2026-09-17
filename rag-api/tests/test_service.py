from pathlib import Path
from unittest.mock import patch

from langchain_core.documents import Document

from app.service import RagService, extract_response_text, load_pdf_pages, make_index_name


def test_index_name_is_unique_safe_and_within_pinecone_limit() -> None:
    first = make_index_name("Apple 10-K (2025) As Filed.pdf")
    second = make_index_name("Apple 10-K (2025) As Filed.pdf")

    assert first != second
    assert len(first) <= 45
    assert first.replace("-", "").isalnum()
    assert first == first.lower()


def test_loader_creates_one_record_per_non_empty_page() -> None:
    pages = [
        Document(page_content="First page text", metadata={"page": 0}),
        Document(page_content="   ", metadata={"page": 1}),
        Document(page_content="Third\npage text", metadata={"page": 2}),
    ]
    with patch("app.service.PyPDFLoader") as loader:
        loader.return_value.load.return_value = pages
        records = load_pdf_pages(Path("sample.pdf"), "sample.pdf")

    assert [record["_id"] for record in records] == ["page-1", "page-3"]
    assert records[0]["chunk_strategy"] == "page"
    assert records[1]["chunk_text"] == "Third page text"
    assert records[1]["filename"] == "sample.pdf"


def test_wait_for_records_accepts_object_stats() -> None:
    class Stats:
        total_vector_count = 80

    class Index:
        def describe_index_stats(self) -> Stats:
            return Stats()

    RagService._wait_until_records_indexed(Index(), expected=80, timeout_seconds=1)


def test_extract_response_text_supports_gemini_structured_content() -> None:
    content = [
        {
            "type": "text",
            "text": "Apple revenue answer.",
            "extras": {"signature": "must-not-be-displayed"},
        }
    ]

    assert extract_response_text(content) == "Apple revenue answer."
