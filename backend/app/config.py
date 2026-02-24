from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "sqlite:///./feedback.db"
    frontend_url: str = "http://localhost:3000"
    cors_origins: str = ""  # comma-separated extra origins, e.g. "https://myapp.vercel.app"
    spotify_api_base: str = "https://api.spotify.com/v1"
    ml_model_dir: str = "ml_models"
    ml_min_training_samples: int = 30

    model_config = {"env_file": ".env", "extra": "ignore"}

    def get_cors_origins(self) -> list[str]:
        origins = {"http://localhost:3000", "http://127.0.0.1:3000", self.frontend_url}
        if self.cors_origins:
            origins.update(o.strip() for o in self.cors_origins.split(",") if o.strip())
        return list(origins)


settings = Settings()
