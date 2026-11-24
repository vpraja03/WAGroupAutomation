from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import yaml


def load_rules(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        data = yaml.safe_load(handle) or {}
    data.setdefault("rules", [])
    data.setdefault("default_join_approval_mode", "auto_approve")
    return data


def _matches(when: dict[str, Any], row: dict[str, Any]) -> bool:
    column = str(when.get("column", "")).strip().lower()
    if not column:
        return False
    value = str(row.get(column, "")).strip()
    if "equals" in when:
        return value.casefold() == str(when["equals"]).strip().casefold()
    if "in" in when:
        allowed = {str(item).strip().casefold() for item in when["in"]}
        return value.casefold() in allowed
    if "regex" in when:
        return bool(re.search(str(when["regex"]), value, flags=re.IGNORECASE))
    return False


def classify_row(row: dict[str, Any], config: dict[str, Any]) -> dict[str, str] | None:
    for rule in config.get("rules", []):
        when = rule.get("when") or {}
        if _matches(when, row):
            return {
                "group": str(rule["group"]).strip(),
                "description": str(rule.get("description") or "").strip(),
                "join_approval_mode": str(
                    rule.get("join_approval_mode") or config["default_join_approval_mode"]
                ).strip(),
            }
    fallback = str(row.get("group") or "").strip()
    if not fallback:
        return None
    return {
        "group": fallback,
        "description": "",
        "join_approval_mode": str(config["default_join_approval_mode"]).strip(),
    }
