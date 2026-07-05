#!/usr/bin/env python3
"""Build diary markdown and static web data from text files."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import shutil
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INBOX_NEW = ROOT / "inbox" / "new"
INBOX_PROCESSED = ROOT / "inbox" / "processed"
INBOX_REJECTED = ROOT / "inbox" / "rejected"
OBSIDIAN_DIR = ROOT / "obsidian"
DIARIES_DIR = OBSIDIAN_DIR / "diaries"
DATA_DIR = ROOT / "data"
REPORT_PATH = ROOT / "DIARY_PIPELINE_REPORT.md"

BODY_START = "<!-- diary-body:start -->"
BODY_END = "<!-- diary-body:end -->"
GENERATED_BY = "diary_pipeline.py"

DATE_RE = re.compile(
    r"(?P<year>19\d{2}|20\d{2})\s*(?:년|[.\-_/ ])\s*"
    r"(?P<month>0?[1-9]|1[0-2])\s*(?:월|[.\-_/ ])\s*"
    r"(?P<day>0?[1-9]|[12]\d|3[01])\s*(?:일)?"
)
DATE_IN_NAME_RE = re.compile(
    r"(?P<year>19\d{2}|20\d{2})[._\- ]?"
    r"(?P<month>0[1-9]|1[0-2]|[1-9])[._\- ]?"
    r"(?P<day>0[1-9]|[12]\d|3[01]|[1-9])"
)


def ensure_dirs() -> None:
    for path in (
        INBOX_NEW,
        INBOX_PROCESSED,
        INBOX_REJECTED,
        DIARIES_DIR,
        DATA_DIR / "entries",
        DATA_DIR / "texts",
        DATA_DIR / "photos",
    ):
        path.mkdir(parents=True, exist_ok=True)


def read_text(path: Path) -> tuple[str, str]:
    data = path.read_bytes()
    last_error: Exception | None = None
    for encoding in ("utf-8-sig", "utf-8", "cp949"):
        try:
            text = data.decode(encoding)
            return text.replace("\r\n", "\n").replace("\r", "\n"), encoding
        except UnicodeDecodeError as exc:
            last_error = exc
    raise UnicodeDecodeError("unknown", data, 0, 1, str(last_error))


def write_text(path: Path, text: str) -> bool:
    path.parent.mkdir(parents=True, exist_ok=True)
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    if path.exists():
        try:
            if path.read_text(encoding="utf-8") == normalized:
                return False
        except UnicodeDecodeError:
            pass
    path.write_text(normalized, encoding="utf-8", newline="\n")
    return True


def date_key(year: int, month: int, day: int) -> str | None:
    try:
        return dt.date(year, month, day).isoformat()
    except ValueError:
        return None


def date_from_match(match: re.Match[str]) -> str | None:
    return date_key(int(match["year"]), int(match["month"]), int(match["day"]))


def date_from_filename(path: Path) -> str | None:
    match = DATE_IN_NAME_RE.search(path.stem)
    return date_from_match(match) if match else None


def title_for(key: str) -> str:
    year, month, day = (int(part) for part in key.split("-"))
    return f"{year}년 {month}월 {day}일"


def md_path_for(key: str) -> Path:
    return DIARIES_DIR / key[:4] / f"{key}.md"


def entry_path_for(key: str) -> Path:
    return DATA_DIR / "entries" / f"{key}.json"


def text_path_for(key: str) -> Path:
    return DATA_DIR / "texts" / f"{key}.txt"


def parse_sections(text: str, fallback_key: str | None) -> dict[str, list[str]]:
    sections: dict[str, list[str]] = {}
    current_key: str | None = None
    current_lines: list[str] = []

    def flush() -> None:
        nonlocal current_lines
        body = "\n".join(current_lines).strip()
        if body and current_key:
            sections.setdefault(current_key, []).append(body)
        current_lines = []

    for line in text.split("\n"):
        stripped = line.strip()
        match = DATE_RE.fullmatch(stripped)
        if match:
            key = date_from_match(match)
            if key:
                flush()
                current_key = key
                continue
        current_lines.append(line)
    flush()

    if not sections and fallback_key:
        body = text.strip()
        if body:
            sections[fallback_key] = [body]
    return sections


def parse_frontmatter(text: str) -> tuple[dict[str, object], str]:
    if not text.startswith("---\n"):
        return {}, text
    end = text.find("\n---\n", 4)
    if end == -1:
        return {}, text
    raw = text[4:end]
    rest = text[end + 5 :]
    meta: dict[str, object] = {}
    for line in raw.splitlines():
        if ":" not in line or line.startswith(" "):
            continue
        key, value = line.split(":", 1)
        meta[key.strip()] = value.strip().strip('"').strip("'")
    return meta, rest


def extract_body(md_text: str) -> str:
    start = md_text.find(BODY_START)
    end = md_text.find(BODY_END)
    if start == -1 or end == -1 or end < start:
        return md_text.strip() + "\n"
    return md_text[start + len(BODY_START) : end].strip() + "\n"


def make_md(key: str, body: str, source: str) -> str:
    return (
        "---\n"
        f"date: {key}\n"
        f"title: {title_for(key)}\n"
        "tags:\n"
        "  - diary\n"
        "  - for-wife\n"
        "photos: []\n"
        f"source: {json.dumps(source, ensure_ascii=False)}\n"
        f"web_entry: data/entries/{key}.json\n"
        f"web_text: data/texts/{key}.txt\n"
        f"generated_by: {GENERATED_BY}\n"
        "---\n\n"
        f"# {title_for(key)}\n\n"
        "[[Diary Index|목록으로]]\n\n"
        f"{BODY_START}\n"
        f"{body.strip()}\n"
        f"{BODY_END}\n"
    )


def existing_keys() -> list[str]:
    if not DIARIES_DIR.exists():
        return []
    keys = [
        path.stem
        for path in DIARIES_DIR.glob("*/*.md")
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}\.md", path.name)
    ]
    return sorted(set(keys))


def write_diary_index(keys: list[str]) -> None:
    lines = ["# Diary Index", ""]
    current_month = ""
    for key in keys:
        year, month, _day = (int(part) for part in key.split("-"))
        month_title = f"{year}년 {month}월"
        if month_title != current_month:
            if current_month:
                lines.append("")
            lines.append(f"## {month_title}")
            current_month = month_title
        lines.append(f"- [[diaries/{key[:4]}/{key}|{title_for(key)}]]")
    lines.append("")
    write_text(OBSIDIAN_DIR / "Diary Index.md", "\n".join(lines))


def add_or_append_md(key: str, body: str, source: str) -> str:
    path = md_path_for(key)
    if not path.exists():
        write_text(path, make_md(key, body, source))
        return "created"

    old = path.read_text(encoding="utf-8")
    old_body = extract_body(old).strip()
    new_body = body.strip()
    if not new_body or new_body in old_body:
        return "skipped"

    marker = f"\n\n---\n<!-- appended-from-inbox: {source} / {dt.datetime.now().isoformat(timespec='seconds')} -->\n"
    merged = old_body + marker + new_body
    start = old.find(BODY_START)
    end = old.find(BODY_END)
    if start == -1 or end == -1 or end < start:
        updated = old.rstrip() + f"\n\n{BODY_START}\n{merged}\n{BODY_END}\n"
    else:
        updated = old[: start + len(BODY_START)] + "\n" + merged + "\n" + old[end:]
    write_text(path, updated)
    return "updated"


def unique_path(path: Path) -> Path:
    if not path.exists():
        return path
    base = path.with_suffix("")
    suffix = path.suffix
    index = 2
    while True:
        candidate = Path(f"{base}-{index}{suffix}")
        if not candidate.exists():
            return candidate
        index += 1


def move_processed(path: Path, keys: list[str]) -> None:
    year = keys[0][:4] if keys else str(dt.date.today().year)
    target_dir = INBOX_PROCESSED / year
    target_dir.mkdir(parents=True, exist_ok=True)
    shutil.move(str(path), str(unique_path(target_dir / path.name)))


def reject_file(path: Path, reason: str) -> None:
    target = unique_path(INBOX_REJECTED / path.name)
    INBOX_REJECTED.mkdir(parents=True, exist_ok=True)
    shutil.move(str(path), str(target))
    write_text(target.with_suffix(target.suffix + ".reason.txt"), reason + "\n")


def read_md_entries() -> dict[str, dict[str, object]]:
    entries: dict[str, dict[str, object]] = {}
    for path in sorted(DIARIES_DIR.glob("*/*.md")):
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}\.md", path.name):
            continue
        key = path.stem
        text = path.read_text(encoding="utf-8")
        _meta, rest = parse_frontmatter(text)
        existing_text_path = text_path_for(key)
        body = existing_text_path.read_text(encoding="utf-8") if existing_text_path.exists() else extract_body(rest)
        entries[key] = {
            "title": title_for(key),
            "body": body,
            "sourceMd": str(path.relative_to(ROOT)).replace("\\", "/"),
            "photos": [],
        }
    return entries


def build_web() -> int:
    ensure_dirs()
    entries = read_md_entries()
    desired_files: set[Path] = set()
    index: dict[str, dict[str, object]] = {}

    for key in sorted(entries):
        item = entries[key]
        entry_path = entry_path_for(key)
        text_path = text_path_for(key)
        desired_files.update((entry_path, text_path))

        index[key] = {
            "title": item["title"],
            "entryUrl": f"data/entries/{key}.json",
            "hasPhotos": False,
        }
        entry = {
            "date": key,
            "title": item["title"],
            "bodyUrl": f"data/texts/{key}.txt",
            "sourceMd": item["sourceMd"],
            "photos": item["photos"],
        }
        write_text(entry_path, json.dumps(entry, ensure_ascii=False, indent=2) + "\n")
        write_text(text_path, str(item["body"]))

    for folder in (DATA_DIR / "entries", DATA_DIR / "texts"):
        for path in folder.glob("*"):
            if path.is_file() and path not in desired_files:
                path.unlink()

    write_text(DATA_DIR / "diary-index.json", json.dumps(index, ensure_ascii=False, indent=2) + "\n")
    return len(entries)


def git_status() -> str:
    git_root = ROOT
    while git_root != git_root.parent and not (git_root / ".git").exists():
        git_root = git_root.parent
    if not (git_root / ".git").exists():
        return "Git repository not found."
    proc = subprocess.run(
        ["git", "status", "--short"],
        cwd=git_root,
        text=True,
        capture_output=True,
        check=False,
    )
    return proc.stdout.strip() or "clean"


def write_report(command: str, lines: list[str]) -> None:
    report = [
        "# Diary Pipeline Report",
        "",
        f"- run_at: {dt.datetime.now().isoformat(timespec='seconds')}",
        f"- command: {command}",
        *lines,
        "",
        "## Git status",
        "",
        "```text",
        git_status(),
        "```",
        "",
    ]
    try:
        write_text(REPORT_PATH, "\n".join(report))
    except PermissionError:
        pass


def sync() -> int:
    ensure_dirs()
    processed = created = updated = skipped = rejected = 0

    files = sorted(path for path in INBOX_NEW.iterdir() if path.is_file() and path.suffix.lower() in {".txt", ".md"})
    for path in files:
        if path.name == ".gitkeep":
            continue
        try:
            text, _encoding = read_text(path)
            sections = parse_sections(text, date_from_filename(path))
        except Exception as exc:
            reject_file(path, f"read failed: {exc}")
            rejected += 1
            continue

        if not sections:
            reject_file(path, "date not found")
            rejected += 1
            continue

        wrote = False
        keys: list[str] = []
        for key, bodies in sorted(sections.items()):
            keys.append(key)
            for body in bodies:
                result = add_or_append_md(key, body, path.name)
                if result == "created":
                    created += 1
                    wrote = True
                elif result == "updated":
                    updated += 1
                    wrote = True
                else:
                    skipped += 1
        if wrote:
            processed += 1
            move_processed(path, keys)
        else:
            path.unlink()

    keys = existing_keys()
    write_diary_index(keys)
    data_count = build_web()
    write_report(
        "sync",
        [
            f"- processed_files: {processed}",
            f"- created_md: {created}",
            f"- updated_md: {updated}",
            f"- skipped_entries: {skipped}",
            f"- rejected_files: {rejected}",
            f"- data_entries: {data_count}",
        ],
    )
    return data_count


def import_diart() -> int:
    ensure_dirs()
    source = ROOT / "diart.txt"
    if not source.exists():
        source = ROOT / "diary.txt"
    if not source.exists():
        print("diart.txt or diary.txt not found")
        return build_web()

    text, _encoding = read_text(source)
    sections = parse_sections(text, None)
    created = updated = skipped = 0
    for key, bodies in sorted(sections.items()):
        for body in bodies:
            result = add_or_append_md(key, body, source.name)
            if result == "created":
                created += 1
            elif result == "updated":
                updated += 1
            else:
                skipped += 1

    write_diary_index(existing_keys())
    data_count = build_web()
    write_report(
        "import-diart",
        [
            f"- created_md: {created}",
            f"- updated_md: {updated}",
            f"- skipped_entries: {skipped}",
            f"- data_entries: {data_count}",
        ],
    )
    return data_count


def validate_json_files() -> None:
    json.loads((DATA_DIR / "diary-index.json").read_text(encoding="utf-8"))
    for path in (DATA_DIR / "entries").glob("*.json"):
        json.loads(path.read_text(encoding="utf-8"))


def status() -> None:
    ensure_dirs()
    index_count = 0
    index_path = DATA_DIR / "diary-index.json"
    if index_path.exists():
        index_count = len(json.loads(index_path.read_text(encoding="utf-8")))
    pending = len([p for p in INBOX_NEW.iterdir() if p.is_file() and p.name != ".gitkeep"])
    print(f"Obsidian diaries: {len(existing_keys())}")
    print(f"Data index entries: {index_count}")
    print(f"Inbox pending files: {pending}")
    print("Git status:")
    print(git_status())


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync diary inbox to Obsidian and static web data")
    parser.add_argument("command", choices=("sync", "build-web", "import-diart", "status"))
    args = parser.parse_args()

    if args.command == "sync":
        count = sync()
        validate_json_files()
        print(f"sync complete: {count} entries")
    elif args.command == "build-web":
        count = build_web()
        write_report("build-web", [f"- data_entries: {count}"])
        validate_json_files()
        print(f"build-web complete: {count} entries")
    elif args.command == "import-diart":
        count = import_diart()
        validate_json_files()
        print(f"import-diart complete: {count} entries")
    else:
        status()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
