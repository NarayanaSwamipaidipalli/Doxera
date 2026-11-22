from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Local conversion limits. Document storage and expiry are owned by solo.storage."""
    model_config = SettingsConfigDict(extra="ignore", hide_input_in_errors=True)
    TMP_STORAGE_DIR: str = "/tmp/doxera-solo"
    TEMP_FILE_RETENTION_HOURS: int = 1
    RETENTION_MODE: str = "enforce"
    OFFICE_CONVERSION_TIMEOUT_SECONDS: int = Field(default=120, ge=1, le=600)
    # HTML to PDF renderer limits (wall clock and CPU seconds; address space in MB).
    HTML_CONVERSION_TIMEOUT_SECONDS: int = Field(default=120, ge=5, le=600)
    HTML_CONVERSION_MEMORY_MB: int = Field(default=2048, ge=512, le=16384)
    # Certificate-based signing. Both are operator settings, never taken from a user request.
    # PEM bundle of root certificates Doxera reports as trusted; empty = no signer is reported as trusted.
    SIGNING_TRUST_ROOTS_FILE: str = ""
    # RFC 3161 timestamp authority (http/https URL); empty = trusted timestamps are not offered.
    SIGNING_TSA_URL: str = ""
    SIGNING_TSA_TIMEOUT_SECONDS: int = Field(default=10, ge=1, le=60)


settings = Settings()
