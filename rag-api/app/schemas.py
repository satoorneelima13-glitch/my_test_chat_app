from pydantic import BaseModel, Field


class UploadResponse(BaseModel):
    index_name: str
    filename: str
    pages_indexed: int
    message: str


class QuestionRequest(BaseModel):
    index_name: str = Field(min_length=1, max_length=45, pattern=r"^[a-z0-9-]+$")
    question: str = Field(min_length=2, max_length=2_000)


class SourcePage(BaseModel):
    filename: str
    page_number: int
    score: float | None = None


class QuestionResponse(BaseModel):
    answer: str
    index_name: str
    sources: list[SourcePage]
