import tempfile
from functools import lru_cache
from pathlib import Path

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware

from .config import Settings, get_settings
from .schemas import QuestionRequest, QuestionResponse, UploadResponse
from .service import RagService


@lru_cache
def get_rag_service() -> RagService:
    return RagService(get_settings())


settings = get_settings()
app = FastAPI(
    title="Pinecone Page RAG API",
    version="1.0.0",
    description="Upload a PDF into a new Pinecone index and ask grounded questions.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/documents", response_model=UploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_document(
    file: UploadFile = File(...),
    service: RagService = Depends(get_rag_service),
) -> UploadResponse:
    filename = Path(file.filename or "document.pdf").name
    if Path(filename).suffix.lower() != ".pdf":
        raise HTTPException(status_code=415, detail="Only PDF files are supported.")

    max_bytes = settings.rag_max_upload_mb * 1024 * 1024
    contents = await file.read(max_bytes + 1)
    if len(contents) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"PDF exceeds the {settings.rag_max_upload_mb} MB upload limit.",
        )
    if not contents.startswith(b"%PDF-"):
        raise HTTPException(status_code=400, detail="The uploaded file is not a valid PDF.")

    try:
        with tempfile.TemporaryDirectory(prefix="rag-upload-") as temp_dir:
            path = Path(temp_dir) / filename
            path.write_bytes(contents)
            return service.ingest_pdf(path, filename)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Document indexing failed.") from exc


@app.post("/query", response_model=QuestionResponse)
def query_document(
    request: QuestionRequest,
    service: RagService = Depends(get_rag_service),
) -> QuestionResponse:
    try:
        return service.answer(request.index_name, request.question)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Document question answering failed.") from exc
