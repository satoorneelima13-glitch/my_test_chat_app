from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration loaded from environment variables."""

    pinecone_api_key: str = Field(alias="PINECONE_API_KEY")
    google_genai_api_key: str = Field(alias="GOOGLE_GENAI_API_KEY")
    rag_chat_model: str = Field(default="gemini-3.6-flash", alias="RAG_CHAT_MODEL")
    pinecone_cloud: str = Field(default="aws", alias="PINECONE_CLOUD")
    pinecone_region: str = Field(default="us-east-1", alias="PINECONE_REGION")
    pinecone_embed_model: str = Field(
        default="llama-text-embed-v2", alias="PINECONE_EMBED_MODEL"
    )
    rag_namespace: str = Field(default="pages", alias="RAG_NAMESPACE")
    rag_top_k: int = Field(default=5, ge=1, le=20, alias="RAG_TOP_K")
    rag_max_upload_mb: int = Field(default=20, ge=1, le=100, alias="RAG_MAX_UPLOAD_MB")
    rag_allowed_origins: str = Field(
        default="http://localhost:3000", alias="RAG_ALLOWED_ORIGINS"
    )

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
    )

    @property
    def allowed_origins(self) -> list[str]:
        return [origin.strip() for origin in self.rag_allowed_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
