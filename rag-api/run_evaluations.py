from pathlib import Path

from app.config import get_settings
from app.evaluation import RagEvaluator


INDEX_NAME = "rag-10-k-2025-as-filed-53194cfc"
RESULTS_PATH = Path("evaluation_results.txt")
SEPARATOR = "-" * 40

QUESTIONS = [
    "Where is Apple's headquarters?",
    "What were Apple's total net sales in 2025?",
    "How much revenue did iPhone generate in 2025?",
    "How much revenue did Services generate in 2025?",
    "How much revenue did Mac generate in 2025?",
]


def _completed_question_count() -> int:
    """Count fully-written question blocks already saved, so a rerun after an
    interruption (e.g. a quota error) resumes instead of repeating work."""

    if not RESULTS_PATH.exists():
        return 0
    return RESULTS_PATH.read_text(encoding="utf-8").count(f"\n{SEPARATOR}\n")


def _write_header(settings) -> None:
    header_lines = [
        "Week 6 - RAG Response Evaluation",
        f"Answer model: {settings.initial_answer_model} | Judge model: {settings.judge_model}",
        "=" * 40,
        "",
    ]
    RESULTS_PATH.write_text("\n".join(header_lines) + "\n", encoding="utf-8")


def _append_result(number: int, result: dict) -> None:
    block_lines = [
        f"Question {number}: {result['question']}",
        f"Answer: {result['answer']}",
        f"Evaluation: {result['evaluation']}",
        f"Initial answer model: {result['answer_model']}",
        f"Judge model: {result['judge_model']}",
        SEPARATOR,
        "",
    ]
    with RESULTS_PATH.open("a", encoding="utf-8") as output_file:
        output_file.write("\n".join(block_lines) + "\n")


def main() -> None:
    settings = get_settings()
    evaluator = RagEvaluator(settings)

    completed = _completed_question_count()
    if completed >= len(QUESTIONS):
        print(f"All {len(QUESTIONS)} questions already evaluated. Nothing to do.")
        return
    if completed == 0:
        _write_header(settings)
    else:
        print(f"Resuming: {completed} of {len(QUESTIONS)} questions already evaluated.")

    for number, question in enumerate(QUESTIONS, start=1):
        if number <= completed:
            continue

        print(f"Evaluating question {number} of {len(QUESTIONS)}...")
        result = evaluator.evaluate(INDEX_NAME, question)
        _append_result(number, result)

    print(f"Finished. Results saved to {RESULTS_PATH}")


if __name__ == "__main__":
    main()
