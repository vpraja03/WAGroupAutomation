import phonenumbers


def normalize_phone(raw: str, default_region: str = "IN") -> str:
    """Return E.164 digits without '+' (Cloud API `to` field)."""
    text = str(raw).strip()
    if not text:
        raise ValueError("empty phone number")
    parsed = phonenumbers.parse(text, default_region)
    if not phonenumbers.is_possible_number(parsed):
        raise ValueError(f"not a possible number: {raw}")
    return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164).lstrip("+")
