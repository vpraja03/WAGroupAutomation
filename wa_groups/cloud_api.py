from __future__ import annotations

from typing import Any

import httpx


class WhatsAppCloudClient:
    def __init__(self, token: str, phone_number_id: str, api_version: str = "v21.0") -> None:
        self.phone_number_id = phone_number_id
        self.base = f"https://graph.facebook.com/{api_version}"
        self._client = httpx.Client(
            timeout=30.0,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
        )

    def close(self) -> None:
        self._client.close()

    def _raise_for_graph(self, response: httpx.Response) -> dict[str, Any]:
        try:
            payload = response.json()
        except ValueError:
            response.raise_for_status()
            return {}
        if response.is_error:
            error = payload.get("error", payload)
            raise RuntimeError(f"Graph API {response.status_code}: {error}")
        return payload

    def create_group(
        self,
        subject: str,
        description: str = "",
        join_approval_mode: str = "auto_approve",
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "messaging_product": "whatsapp",
            "subject": subject[:128],
            "join_approval_mode": join_approval_mode,
        }
        if description:
            body["description"] = description[:2048]
        response = self._client.post(f"{self.base}/{self.phone_number_id}/groups", json=body)
        return self._raise_for_graph(response)

    def get_invite_link(self, group_id: str) -> str:
        response = self._client.get(f"{self.base}/{group_id}/invite_link")
        payload = self._raise_for_graph(response)
        return str(payload.get("invite_link", ""))

    def send_invite_template(
        self,
        to_phone: str,
        group_id: str,
        template_name: str,
        language: str,
    ) -> dict[str, Any]:
        body = {
            "messaging_product": "whatsapp",
            "to": to_phone,
            "type": "template",
            "template": {
                "name": template_name,
                "language": {"code": language},
                "components": [
                    {
                        "type": "body",
                        "parameters": [{"type": "group_id", "group_id": group_id}],
                    }
                ],
            },
        }
        response = self._client.post(f"{self.base}/{self.phone_number_id}/messages", json=body)
        return self._raise_for_graph(response)
