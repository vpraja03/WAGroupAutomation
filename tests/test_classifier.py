from pathlib import Path

from wa_groups.contacts import classify_contacts, groups_from_classified, load_contacts

ROOT = Path(__file__).resolve().parents[1]


def test_sample_contacts_split_into_expected_groups():
    rows = load_contacts(ROOT / "data" / "contacts.csv")
    classified, skipped = classify_contacts(rows, ROOT / "config" / "groups.yaml", "IN")
    groups = groups_from_classified(classified)

    assert {row["phone"] for row in classified} == {
        "919000000001",
        "919000000002",
        "919000000003",
        "919000000004",
        "919000000005",
        "919000000006",
    }
    assert groups["IT Team"]["members"][0]["phone"] == "919000000001"
    assert len(groups["IT Team"]["members"]) == 2
    assert len(groups["Sales Team"]["members"]) == 3
    assert "HR Team" in groups
    assert any(item["reason"].startswith("no matching") for item in skipped)
    assert any("not-a-number" in str(item["phone"]) for item in skipped)
