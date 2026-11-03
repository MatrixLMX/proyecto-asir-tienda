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
    # Por defecto Gemini (tiene capa gratuita); también admite "groq" y "anthropic".
    llm_provider: str = "google_genai"
    llm_model: str = "gemini-flash-lite-latest"
    google_api_key: str | None = None
    groq_api_key: str | None = None
    anthropic_api_key: str | None = None
    # Modelo de reserva si el principal falla (saturado, sin cuota...).
    # Opcional: p. ej. LLM_RESERVA_PROVIDER=groq y LLM_RESERVA_MODEL=openai/gpt-oss-120b
    llm_reserva_provider: str | None = None
    llm_reserva_model: str | None = None

    cors_origins: str = "http://localhost:5173"

    # Nombre que aparece en la web y en los tickets
    nombre_tienda: str = "Mi Tienda"
    # Datos fiscales para el ticket (factura simplificada)
    nif_tienda: str = ""
    direccion_tienda: str = ""
    # Login: intentos fallidos permitidos por IP antes de bloquear 15 minutos
    login_max_intentos: int = 5


settings = Settings()
