"""Configuración leída de variables de entorno o del fichero .env."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../../.env"), extra="ignore")

    db_host: str = "localhost"
    db_port: int = 3306
    db_name: str = "tienda"
    db_admin_password: str
    db_dependiente_password: str
    db_auth_password: str

    jwt_secret: str
    jwt_horas: int = 12

    # Asistente virtual (LangChain). Si no hay clave, el chat se desactiva.
    # Por defecto Groq (tiene capa gratuita); también admite "anthropic".
    llm_provider: str = "groq"
    llm_model: str = "openai/gpt-oss-120b"
    groq_api_key: str | None = None
    anthropic_api_key: str | None = None

    cors_origins: str = "http://localhost:5173"


settings = Settings()
