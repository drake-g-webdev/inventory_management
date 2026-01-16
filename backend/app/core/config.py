from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    # Database
    DATABASE_URL: str = "postgresql://postgres:postgres@localhost:5432/purchasing_db"

    # JWT - MUST be set in .env file, no insecure default
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 43200  # 30 days

    # CORS
    FRONTEND_URL: str = "http://localhost:3001"

    # Environment
    ENVIRONMENT: str = "development"

    # OpenAI API Key (for AI vision and receipt OCR)
    OPENAI_API_KEY: Optional[str] = None

    # Email Settings (Gmail SMTP)
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USER: Optional[str] = None  # Your Gmail address
    SMTP_PASSWORD: Optional[str] = None  # Gmail App Password
    EMAIL_FROM_NAME: str = "SUKAKPAK Purchasing System"
    EMAIL_ENABLED: bool = False  # Set to True when email is configured

    class Config:
        env_file = ".env"
        case_sensitive = True
        extra = "ignore"  # Ignore any extra env vars not defined here


settings = Settings()
