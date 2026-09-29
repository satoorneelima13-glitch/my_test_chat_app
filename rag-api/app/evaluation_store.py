import threading
import time
import uuid
from dataclasses import dataclass
from typing import Callable


@dataclass(frozen=True)
class EvaluationRecord:
    question: str
    context: str
    answer: str


@dataclass
class _Entry:
    record: EvaluationRecord
    expires_at: float


class EvaluationStore:
    """Holds the exact question/context/answer behind an opaque evaluation id.

    In-memory and per-process: reference text never leaves the server, and the
    client only ever sees the id. Entries expire after `ttl_seconds` and the
    store is capped at `max_entries` (oldest entry evicted first) so a busy
    server can't grow this without bound.
    """

    def __init__(
        self,
        ttl_seconds: float = 1800,
        max_entries: int = 500,
        clock: Callable[[], float] = time.monotonic,
    ):
        self._ttl_seconds = ttl_seconds
        self._max_entries = max_entries
        self._clock = clock
        self._lock = threading.Lock()
        self._entries: dict[str, _Entry] = {}

    def put(self, question: str, context: str, answer: str) -> str:
        evaluation_id = uuid.uuid4().hex
        entry = _Entry(
            record=EvaluationRecord(question=question, context=context, answer=answer),
            expires_at=self._clock() + self._ttl_seconds,
        )
        with self._lock:
            self._prune_locked()
            if len(self._entries) >= self._max_entries:
                oldest_id = min(self._entries, key=lambda key: self._entries[key].expires_at)
                del self._entries[oldest_id]
            self._entries[evaluation_id] = entry
        return evaluation_id

    def get(self, evaluation_id: str) -> EvaluationRecord | None:
        with self._lock:
            self._prune_locked()
            entry = self._entries.get(evaluation_id)
            return entry.record if entry is not None else None

    def _prune_locked(self) -> None:
        now = self._clock()
        expired = [key for key, entry in self._entries.items() if entry.expires_at <= now]
        for key in expired:
            del self._entries[key]
