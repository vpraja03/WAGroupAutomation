from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

from wa_groups.cloud_api import WhatsAppCloudClient
from wa_groups.contacts import classify_contacts, groups_from_classified, load_contacts
from wa_groups.settings import Settings


def _paths(args: argparse.Namespace) -> tuple[Path, Path, Path]:
    input_path = Path(args.input)
    rules_path = Path(args.rules)
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)
    return input_path, rules_path, output_dir


def cmd_classify(args: argparse.Namespace) -> int:
    settings = Settings()
    input_path, rules_path, output_dir = _paths(args)
    rows = load_contacts(input_path)
    classified, skipped = classify_contacts(rows, rules_path, settings.default_region)
    groups = groups_from_classified(classified)

    pd.DataFrame(classified).to_csv(output_dir / "classified.csv", index=False)
    pd.DataFrame(skipped).to_csv(output_dir / "skipped.csv", index=False)

    print(f"Classified {len(classified)} numbers into {len(groups)} groups.")
    for name, group in groups.items():
        print(f"  - {name}: {len(group['members'])} members")
    if skipped:
        print(f"Skipped {len(skipped)} rows. See {output_dir / 'skipped.csv'}")
    return 0


def cmd_run(args: argparse.Namespace) -> int:
    settings = Settings()
    live = bool(args.live) and not settings.dry_run
    if args.live and settings.dry_run:
        print("DRY_RUN=true in .env — refusing --live. Set DRY_RUN=false first.")
        return 2

    input_path, rules_path, output_dir = _paths(args)
    rows = load_contacts(input_path)
    classified, skipped = classify_contacts(rows, rules_path, settings.default_region)
    groups = groups_from_classified(classified)

    pd.DataFrame(classified).to_csv(output_dir / "classified.csv", index=False)
    pd.DataFrame(skipped).to_csv(output_dir / "skipped.csv", index=False)

    created: list[dict] = []
    invites: list[dict] = []
    client: WhatsAppCloudClient | None = None

    if live:
        if not settings.whatsapp_token or not settings.whatsapp_phone_number_id:
            print("Missing WHATSAPP_TOKEN or WHATSAPP_PHONE_NUMBER_ID in .env")
            return 2
        client = WhatsAppCloudClient(
            settings.whatsapp_token,
            settings.whatsapp_phone_number_id,
            settings.whatsapp_api_version,
        )

    try:
        for name, group in groups.items():
            record = {
                "subject": group["subject"],
                "description": group["description"],
                "join_approval_mode": group["join_approval_mode"],
                "member_count": len(group["members"]),
                "group_id": "",
                "invite_link": "",
                "status": "dry_run",
            }
            if live and client is not None:
                created_payload = client.create_group(
                    group["subject"],
                    group["description"],
                    group["join_approval_mode"],
                )
                group_id = str(
                    created_payload.get("id") or created_payload.get("group_id") or ""
                )
                invite_link = ""
                if group_id:
                    try:
                        invite_link = client.get_invite_link(group_id)
                    except RuntimeError:
                        invite_link = ""
                record.update(
                    {
                        "group_id": group_id,
                        "invite_link": invite_link,
                        "status": "created",
                        "api_response": created_payload,
                    }
                )
            created.append(record)

            for member in group["members"]:
                invite = {
                    "group": name,
                    "phone": member["phone"],
                    "name": member.get("name", ""),
                    "status": "dry_run",
                }
                if live and client is not None and record.get("group_id"):
                    try:
                        payload = client.send_invite_template(
                            member["phone"],
                            record["group_id"],
                            settings.whatsapp_invite_template_name,
                            settings.whatsapp_invite_template_language,
                        )
                        invite["status"] = "sent"
                        invite["message_id"] = (payload.get("messages") or [{}])[0].get("id", "")
                    except RuntimeError as exc:
                        invite["status"] = "error"
                        invite["error"] = str(exc)
                invites.append(invite)
    finally:
        if client is not None:
            client.close()

    (output_dir / "groups.json").write_text(json.dumps(created, indent=2), encoding="utf-8")
    pd.DataFrame(invites).to_csv(output_dir / "invite_log.csv", index=False)

    mode = "LIVE" if live else "DRY RUN"
    print(f"{mode}: {len(groups)} groups, {len(classified)} invites planned.")
    print(f"Wrote {output_dir / 'groups.json'} and {output_dir / 'invite_log.csv'}")
    if not live:
        print("Re-run with DRY_RUN=false in .env and --live to call the Cloud API.")
    return 0


def _add_io_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--input", default="data/contacts.csv")
    parser.add_argument("--rules", default="config/groups.yaml")
    parser.add_argument("--output", default="output")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Classify numbers and create WhatsApp groups")
    sub = parser.add_subparsers(dest="command", required=True)

    classify = sub.add_parser("classify", help="Classify contacts and write CSVs")
    _add_io_args(classify)
    classify.set_defaults(func=cmd_classify)

    run = sub.add_parser("run", help="Classify, create groups, send invites")
    _add_io_args(run)
    run.add_argument(
        "--live",
        action="store_true",
        help="Call WhatsApp Cloud API (also requires DRY_RUN=false in .env)",
    )
    run.set_defaults(func=cmd_run)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return args.func(args)
