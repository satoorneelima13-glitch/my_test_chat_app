from unittest.mock import patch

import pytest

from app.config import Settings
from app.evaluation import JudgeQuotaExceeded, JudgeUnavailable, judge_answer
from app.evaluation_store import EvaluationStore


def _settings() -> Settings:
    return Settings(
        PINECONE_API_KEY="test-pinecone-key",
        GOOGLE_GENAI_API_KEY="test-google-key",
        OPENAI_API_KEY="test-openai-key",
    )


class _FakeResponse:
    def __init__(self, content: str):
        self.content = content


def test_judge_answer_returns_correct_verdict() -> None:
    with patch("app.evaluation.ChatGoogleGenerativeAI") as chat_model:
        chat_model.return_value.invoke.return_value = _FakeResponse("correct")
        verdict = judge_answer(_settings(), "Q", "reference text", "the answer")

    assert verdict == "correct"


def test_judge_answer_rejects_non_binary_verdict() -> None:
    with patch("app.evaluation.ChatGoogleGenerativeAI") as chat_model:
        chat_model.return_value.invoke.return_value = _FakeResponse("maybe")
        with pytest.raises(ValueError):
            judge_answer(_settings(), "Q", "reference text", "the answer")


def test_judge_answer_raises_quota_exceeded_on_429() -> None:
    with patch("app.evaluation.ChatGoogleGenerativeAI") as chat_model:
        chat_model.return_value.invoke.side_effect = Exception(
            "429 RESOURCE_EXHAUSTED: quota exceeded"
        )
        with pytest.raises(JudgeQuotaExceeded):
            judge_answer(_settings(), "Q", "reference text", "the answer")


def test_judge_answer_raises_unavailable_after_retries_exhausted() -> None:
    with patch("app.evaluation.ChatGoogleGenerativeAI") as chat_model, patch(
        "app.evaluation.time.sleep"
    ) as sleep:
        chat_model.return_value.invoke.side_effect = Exception("503 UNAVAILABLE")
        with pytest.raises(JudgeUnavailable):
            judge_answer(_settings(), "Q", "reference text", "the answer")

    assert sleep.call_count == 4


def test_judge_answer_succeeds_after_transient_unavailability() -> None:
    with patch("app.evaluation.ChatGoogleGenerativeAI") as chat_model, patch(
        "app.evaluation.time.sleep"
    ):
        chat_model.return_value.invoke.side_effect = [
            Exception("503 UNAVAILABLE"),
            _FakeResponse("incorrect"),
        ]
        verdict = judge_answer(_settings(), "Q", "reference text", "the answer")

    assert verdict == "incorrect"


def test_evaluation_store_put_and_get_round_trip() -> None:
    store = EvaluationStore()
    evaluation_id = store.put(question="Q", context="C", answer="A")

    record = store.get(evaluation_id)

    assert record is not None
    assert record.question == "Q"
    assert record.context == "C"
    assert record.answer == "A"


def test_evaluation_store_unknown_id_returns_none() -> None:
    store = EvaluationStore()
    assert store.get("unknown-id") is None


def test_evaluation_store_expires_entries() -> None:
    fake_time = [0.0]
    store = EvaluationStore(ttl_seconds=10, clock=lambda: fake_time[0])

    evaluation_id = store.put(question="Q", context="C", answer="A")
    assert store.get(evaluation_id) is not None

    fake_time[0] = 11.0
    assert store.get(evaluation_id) is None


def test_evaluation_store_evicts_oldest_when_full() -> None:
    fake_time = [0.0]
    store = EvaluationStore(ttl_seconds=1000, max_entries=2, clock=lambda: fake_time[0])

    first_id = store.put(question="first", context="C", answer="A")
    fake_time[0] = 1.0
    store.put(question="second", context="C", answer="A")
    fake_time[0] = 2.0
    store.put(question="third", context="C", answer="A")

    assert store.get(first_id) is None
