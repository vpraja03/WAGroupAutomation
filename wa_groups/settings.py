from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    whatsapp_token: str = ""
    whatsapp_phone_number_id: str = ""
    whatsapp_business_account_id: str = ""
    whatsapp_api_version: str = "v21.0"
    whatsapp_invite_template_name: str = "group_invite_link"
    whatsapp_invite_template_language: str = "en"
    dry_run: bool = True
    default_region: str = "IN"

    @property
    def graph_base(self) -> str:
        return f"https://graph.facebook.com/{self.whatsapp_api_version}"
