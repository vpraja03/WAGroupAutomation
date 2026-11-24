from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd

from wa_groups.classifier import classify_row, load_rules
from wa_groups.phones import normalize_phone


def _normalize_columns(frame: pd.DataFrame) -> pd.DataFrame:
    frame = frame.copy()
    frame.columns = [str(col).strip().lower() for col in frame.columns]
    return frame


def load_contacts(path: Path) -> list[dict[str, Any]]:
    suffix = path.suffix.lower()
    if suffix in {".xlsx", ".xls"}:
        frame = pd.read_excel(path, dtype=str)
    else:
        frame = pd.read_csv(path, dtype=str)
    frame = _normalize_columns(frame).fillna("")
    if "phone" not in frame.columns:
        raise ValueError("contacts file must include a `phone` column")
    return frame.to_dict(orient="records")


def classify_contacts(
    rows: list[dict[str, Any]],
    rules_path: Path,
    default_region: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    config = load_rules(rules_path)
    classified: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []

    for index, row in enumerate(rows, start=2):
        record = {str(key): str(value).strip() for key, value in row.items()}
        try:
            phone = normalize_phone(record.get("phone", ""), default_region)
        except Exception as exc:  # phonenumbers.NumberParseException and ValueError
            skipped.append({"row": index, "phone": record.get("phone", ""), "reason": str(exc)})
            continue

        assignment = classify_row(record, config)
        if assignment is None:
            skipped.append(
                {
                    "row": index,
                    "phone": phone,
                    "reason": "no matching classifier rule and empty group column",
                }
            )
            continue

        classified.append(
            {
                **record,
                "phone": phone,
                "group": assignment["group"],
                "group_description": assignment["description"],
                "join_approval_mode": assignment["join_approval_mode"],
            }
        )
    return classified, skipped


def groups_from_classified(classified: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    groups: dict[str, dict[str, Any]] = {}
    for contact in classified:
        name = contact["group"]
        bucket = groups.setdefault(
            name,
            {
                "subject": name,
                "description": contact.get("group_description") or "",
                "join_approval_mode": contact.get("join_approval_mode") or "auto_approve",
                "members": [],
            },
        )
        if contact.get("group_description") and not bucket["description"]:
            bucket["description"] = contact["group_description"]
        bucket["members"].append(
            {"phone": contact["phone"], "name": contact.get("name", "")}
        )
    return groups
