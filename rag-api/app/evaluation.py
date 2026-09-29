import time
from typing import Any

from langchain_core.prompts import ChatPromptTemplate
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_openai import ChatOpenAI
from pinecone import Pinecone

from .config import Settings
from .service import _as_dict, extract_response_text


ANSWER_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            "Answer the question using only the supplied reference text. "
            "If the reference does not contain the answer, say that the "
            "document does not provide it. Keep numbers and units exact.\n\n"
            "Reference:\n{context}",
        ),
        ("human", "{question}"),
    ]
)


EVALUATION_PROMPT = ChatPromptTemplate.from_template(
    """
You are given a question, an answer and reference text. You must determine
whether the given answer correctly answers the question based on the
reference text.

[BEGIN DATA]
************
[Question]: {question}
************
[Reference]: {context}
************
[Answer]: {sampled_answer}
[END DATA]

Your response must be a single word, either "correct" or "incorrect", and
must not contain any other text or characters. "correct" means the question
is correctly and fully answered by the answer. "incorrect" means the
question is not correctly or is only partially answered by the answer.
"""
)


class JudgeQuotaExceeded(Exception):
    """The judge model reported that its usage quota has been exhausted."""


class JudgeUnavailable(Exception):
    """The judge model stayed unavailable across all retry attempts."""


def _invoke_judge_with_retries(judge_model: ChatGoogleGenerativeAI, judge_messages: list[Any]) -> Any:
    last_error: Exception | None = None

    for attempt in range(5):
        try:
            return judge_model.invoke(judge_messages)
        except Exception as error:
            message = str(error)

            if "429" in message or "RESOURCE_EXHAUSTED" in message or "quota" in message.lower():
                raise JudgeQuotaExceeded(
                    "The judge model's usage quota has been exceeded."
                ) from error

            if "503" in message or "UNAVAILABLE" in message:
                last_error = error
                if attempt == 4:
                    raise JudgeUnavailable(
                        "The judge model is temporarily unavailable."
                    ) from error
                wait_seconds = 5 * (attempt + 1)
                print(f"Gemini is busy. Retrying in {wait_seconds} seconds...")
                time.sleep(wait_seconds)
                continue

            raise

    raise JudgeUnavailable("The judge model is temporarily unavailable.") from last_error


def judge_answer(settings: Settings, question: str, context: str, answer: str) -> str:
    """Judge whether `answer` correctly answers `question` given `context`.

    Evaluates the exact answer and context passed in — never regenerates the
    answer or retrieves different pages. Returns "correct" or "incorrect".
    Raises JudgeQuotaExceeded or JudgeUnavailable for retryable judge-model
    failures so callers can surface 429/503 without crashing the request.
    """

    judge_model = ChatGoogleGenerativeAI(
        model=settings.judge_model,
        google_api_key=settings.google_genai_api_key,
        temperature=0,
    )

    judge_messages = EVALUATION_PROMPT.format_messages(
        question=question,
        context=context,
        sampled_answer=answer,
    )

    judge_response = _invoke_judge_with_retries(judge_model, judge_messages)
    verdict = extract_response_text(judge_response.content).lower().strip()

    if verdict not in {"correct", "incorrect"}:
        raise ValueError("Judge model must return only 'correct' or 'incorrect'.")

    return verdict


class RagEvaluator:
    """Batch evaluator: generates its own answer with GPT-4o-mini, then judges
    it against the retrieved context with the shared Gemini `judge_answer`."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self.pc = Pinecone(api_key=settings.pinecone_api_key)

        self.answer_model = ChatOpenAI(
            model=settings.initial_answer_model,
            api_key=settings.openai_api_key,
            temperature=0,
        )

    def retrieve_context(
        self, index_name: str, question: str
    ) -> tuple[str, list[dict[str, Any]]]:
        known_indexes = set(self.pc.list_indexes().names())
        if index_name not in known_indexes:
            raise LookupError("The requested Pinecone index does not exist.")

        index = self.pc.Index(index_name)
        raw_result = index.search(
            namespace=self.settings.rag_namespace,
            query={
                "inputs": {"text": question},
                "top_k": self.settings.rag_top_k,
            },
            fields=["chunk_text", "filename", "page_number"],
        )

        result = _as_dict(raw_result)
        hits = result.get("result", {}).get("hits", [])

        if not hits:
            raise LookupError("No relevant pages were found.")

        context_parts: list[str] = []
        sources: list[dict[str, Any]] = []

        for hit in hits:
            fields = hit.get("fields", {})
            page_number = int(fields.get("page_number", 0))
            filename = str(fields.get("filename", "uploaded PDF"))
            text = str(fields.get("chunk_text", ""))

            context_parts.append(
                f"PDF page {page_number} ({filename}):\n{text}"
            )
            sources.append(
                {
                    "filename": filename,
                    "page_number": page_number,
                    "score": hit.get("_score"),
                }
            )

        context = "\n\n---\n\n".join(context_parts)
        return context, sources

    def evaluate(self, index_name: str, question: str) -> dict[str, Any]:
        context, sources = self.retrieve_context(index_name, question)

        answer_messages = ANSWER_PROMPT.format_messages(
            question=question,
            context=context,
        )
        answer_response = self.answer_model.invoke(answer_messages)
        sampled_answer = extract_response_text(answer_response.content)

        evaluation = judge_answer(self.settings, question, context, sampled_answer)

        return {
            "question": question,
            "answer": sampled_answer,
            "evaluation": evaluation,
            "answer_model": self.settings.initial_answer_model,
            "judge_model": self.settings.judge_model,
            "sources": sources,
        }
