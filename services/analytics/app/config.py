from pydantic_settings import BaseSettings
from pydantic import Field
from typing import List


class Settings(BaseSettings):
    APP_NAME: str = "FinCore Analytics"
    DEBUG: bool = False
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    LOG_LEVEL: str = "INFO"

    DATABASE_URL: str = Field(
        default="postgresql://postgres:postgres@localhost:5432/fincore",
        description="PostgreSQL connection URL"
    )
    DATABASE_POOL_SIZE: int = 20
    DATABASE_MAX_OVERFLOW: int = 10

    REDIS_URL: str = Field(
        default="redis://localhost:6379/0",
        description="Redis connection URL"
    )

    CORS_ORIGINS: List[str] = Field(
        default=["http://localhost:3000", "http://localhost:4000"],
        description="Allowed CORS origins"
    )

    API_V1_PREFIX: str = "/api/v1"

    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()