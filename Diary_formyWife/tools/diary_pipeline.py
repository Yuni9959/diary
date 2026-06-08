#!/usr/bin/env python3
"""Daily diary sync pipeline.

Static-file only: this script never uses an external database.
"""

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
PHOTOS_DIR = DATA_DIR / "photos"
REPORT_PATH = ROOT / "DIARY_PIPELINE_REPORT.md"

BODY_START = "<!-- diary-body:start -->"
BODY_END = "<!-- diary-body:end -->"
GENERATED_MARKER = "generated_by: diary_pipeline.py"

DATE_LINE_RE = re.compile(
    r"^\s*(?P<year>19\d{2}|20\d{2})\s*(?:년|[.\-_/]?)\s*"
    r"(?P<month>0?[1-9]|1[0-2])\s*(?:월|[.\-_/]?)\s*"
    r"(?P<day>0?[1-9]|[12]\d|3[01])\s*(?:일|[.]?)"
    r"(?:\s*(?:\([월화수목금토일]\)|[월화수목금토일](?:요일)?))?\s*$"
)
DATE_IN_NAME_RE = re.compile(
    r"(?P<year>19\d{2}|20\d{2})[._\- ]?(?P<month>0[1-9]|1[0-2]|[1-9])[._\- ]?(?P<day>0[1-9]|[12]\d|3[01]|[1-9])"
)


def now() -> dt.datetime:
    return dt.datetime.now()


def stamp() -> str:
    return now().strftime("%Y%m%d-%H%M%S")


def iso_now() -> str:
    return now().isoformat(timespec="seconds")


def ensure_dirs() -> None:
    for path in (
        INBOX_NEW,
        INBOX_PROCESSED,
        INBOX_REJECTED,
        DIARIES_DIR,
        DATA_DIR / "entries",
        DATA_DIR / "texts",
        PHOTOS_DIR,
        ROOT / "backups" / "pipeline",
    ):
        path.mkdir(parents=True, exist_ok=True)


def normalize_newlines(text: str) -> str:
    return text.replace("\r\n", "\n").replace("\r", "\n")


def read_text(path: Path) -> tuple[str, str]:
    data = path.read_bytes()
    last_error: Exception | None = None
    for encoding in ("utf-8-sig", "utf-8", "cp949"):
        try:
            return normalize_newlines(data.decode(encoding)), encoding
        except UnicodeDecodeError as exc:
            last_error = exc
    raise UnicodeDecodeError("unknown", data, 0, 1, str(last_error))


def date_key(year: int, month: int, day: int) -> str | None:
    try:
        parsed = dt.date(year, month, day)
    except ValueError:
        return None
    return parsed.isoformat()


def date_from_match(match: re.Match[str]) -> str | None:
    return date_key(int(match.group("year")), int(match.group("month")), int(match.group("day")))


def title_for(key: str) -> str:
    year, month, day = (int(part) for part in key.split("-"))
    return f"{year}년 {month}월 {day}일"


def wikilink(key: str) -> str:
    return f"[[diaries/{key[:4]}/{key}|{title_for(key)}]]"


def md_path_for(key: str) -> Path:
    return DIARIES_DIR / key[:4] / f"{key}.md"


def entry_path_for(key: str) -> Path:
    return DATA_DIR / "entries" / f"{key}.json"


def text_path_for(key: str) -> Path:
    return DATA_DIR / "texts" / f"{key}.txt"


def parse_dated_sections(text: str, fallback_key: str | None = None) -> tuple[dict[str, list[str]], list[str]]:
    sections: dict[str, list[str]] = {}
    warnings: list[str] = []
    current_key: str | None = None
    current_lines: list[str] = []
    unmatched: list[str] = []

    def flush() -> None:
        nonlocal current_lines
        body = "\n".join(current_lines).strip("\n")
        if current_key:
            sections.setdefault(current_key, []).append(body)
        elif body.strip():
            unmatched.append(body)
        current_lines = []

    for line in text.split("\n"):
        match = DATE_LINE_RE.match(line)
        if match:
            key = date_from_match(match)
            if not key:
                warnings.append(f"실제 존재하지 않는 날짜: {line}")
                current_lines.append(line)
                continue
            flush()
            current_key = key
            continue
        current_lines.append(line)
    flush()

    if not sections and fallback_key:
        body = text.strip("\n")
        if body.strip():
            sections[fallback_key] = [body]
            unmatched = []
    elif unmatched:
        warnings.append("첫 날짜 이전 또는 날짜 밖 텍스트가 있어 해당 부분은 가져오지 않음")

    return sections, warnings


def date_from_filename(path: Path) -> str | None:
    match = DATE_IN_NAME_RE.search(path.stem)
    if not match:
        return None
    return date_from_match(match)


def backup_file(path: Path, run_stamp: str) -> None:
    if not path.exists():
        return
    target = ROOT / "backups" / "pipeline" / run_stamp / path.relative_to(ROOT)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, target)


def parse_frontmatter(text: str) -> tuple[dict[str, object], str]:
    if not text.startswith("---\n"):
        return {}, text
    end = text.find("\n---\n", 4)
    if end == -1:
        return {}, text
    raw = text[4:end]
    rest = text[end + 5 :]
    meta: dict[str, object] = {}
    lines = raw.split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]
        if ":" not in line:
            i += 1
            continue
        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip()
        if key == "photos_json" and value:
            try:
                meta["photos"] = json.loads(value)
            except json.JSONDecodeError:
                meta["photos"] = []
        elif key == "photos":
            if value == "[]":
                meta["photos"] = []
            elif value:
                try:
                    meta["photos"] = json.loads(value)
                except json.JSONDecodeError:
                    meta["photos"] = []
            else:
                photos: list[dict[str, str]] = []
                current: dict[str, str] | None = None
                i += 1
                while i < len(lines) and (lines[i].startswith("  ") or lines[i].startswith("-")):
                    item = lines[i].strip()
                    if item.startswith("- "):
                        if current:
                            photos.append(current)
                        current = {}
                        item = item[2:].strip()
                    if ":" in item and current is not None:
                        k, v = item.split(":", 1)
                        current[k.strip()] = v.strip().strip('"').strip("'")
                    i += 1
                if current:
                    photos.append(current)
                meta["photos"] = photos
                continue
        else:
            meta[key] = value.strip('"').strip("'")
        i += 1
    return meta, rest


def extract_body(md_text: str) -> str:
    start = md_text.find(BODY_START)
    end = md_text.find(BODY_END)
    if start == -1 or end == -1 or end < start:
        return md_text.strip("\n") + "\n"
    return md_text[start + len(BODY_START) : end].strip("\n") + "\n"


def replace_body(md_text: str, new_body: str) -> str:
    start = md_text.find(BODY_START)
    end = md_text.find(BODY_END)
    if start == -1 or end == -1 or end < start:
        return md_text.rstrip() + f"\n\n{BODY_START}\n{new_body.rstrip()}\n{BODY_END}\n"
    return md_text[: start + len(BODY_START)] + "\n" + new_body.rstrip() + "\n" + md_text[end:]


def make_md(key: str, body: str, source: str, prev_key: str | None, next_key: str | None) -> str:
    nav = []
    if prev_key:
        nav.append(f"이전: {wikilink(prev_key)}")
    if next_key:
        nav.append(f"다음: {wikilink(next_key)}")
    nav_block = "\n".join(nav)
    if nav_block:
        nav_block += "\n\n"
    return (
        "---\n"
        f"date: {key}\n"
        f"title: {title_for(key)}\n"
        "tags:\n"
        "  - diary\n"
        "  - for-wife\n"
        "photos: []\n"
        f"source: {source}\n"
        f"web_entry: data/entries/{key}.json\n"
        f"web_text: data/texts/{key}.txt\n"
        f"{GENERATED_MARKER}\n"
        "---\n\n"
        f"# {title_for(key)}\n\n"
        "[[Diary Index|목록으로]]\n\n"
        f"{nav_block}"
        f"{BODY_START}\n"
        f"{body.rstrip()}\n"
        f"{BODY_END}\n"
    )


def existing_keys() -> list[str]:
    if not DIARIES_DIR.exists():
        return []
    keys = []
    for path in DIARIES_DIR.glob("*/*.md"):
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}\.md", path.name):
            keys.append(path.stem)
    return sorted(set(keys))


def write_diary_index(keys: list[str]) -> None:
    lines = ["# Diary Index", ""]
    current_month = ""
    for key in keys:
        y, m, _d = (int(part) for part in key.split("-"))
        month = f"{y}년 {m}월"
        if month != current_month:
            if current_month:
                lines.append("")
            lines.append(f"## {month}")
            current_month = month
        lines.append(f"- {wikilink(key)}")
    lines.append("")
    (OBSIDIAN_DIR / "Diary Index.md").parent.mkdir(parents=True, exist_ok=True)
    (OBSIDIAN_DIR / "Diary Index.md").write_text("\n".join(lines), encoding="utf-8", newline="\n")


def add_or_append_md(key: str, body: str, source: str, run_stamp: str, report: dict) -> None:
    path = md_path_for(key)
    path.parent.mkdir(parents=True, exist_ok=True)
    all_keys = sorted(set(existing_keys() + [key]))
    idx = all_keys.index(key)
    prev_key = all_keys[idx - 1] if idx > 0 else None
    next_key = all_keys[idx + 1] if idx < len(all_keys) - 1 else None

    if path.exists():
        backup_file(path, run_stamp)
        old = path.read_text(encoding="utf-8")
        old_body = extract_body(old).rstrip()
        marker = f"---\n<!-- appended-from-inbox: {source} / {iso_now()} -->"
        merged = (old_body + "\n\n" + marker + "\n" + body.strip("\n")).strip("\n") + "\n"
        path.write_text(replace_body(old, merged), encoding="utf-8", newline="\n")
        report["updated_md"] += 1
        report["merged_dates"].append(key)
    else:
        path.write_text(make_md(key, body, source, prev_key, next_key), encoding="utf-8", newline="\n")
        report["created_md"] += 1


def read_md_entries() -> tuple[dict[str, dict], list[str]]:
    entries: dict[str, dict] = {}
    warnings: list[str] = []
    for path in sorted(DIARIES_DIR.glob("*/*.md")):
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}\.md", path.name):
            continue
        key = path.stem
        text = path.read_text(encoding="utf-8")
        meta, rest = parse_frontmatter(text)
        photos = meta.get("photos", [])
        if not isinstance(photos, list):
            photos = []
        title = str(meta.get("title") or title_for(key))
        entries[key] = {
            "title": title,
            "photos": photos,
            "body": extract_body(rest),
            "sourceMd": str(path.relative_to(ROOT)).replace("\\", "/"),
        }
        if BODY_START not in text or BODY_END not in text:
            warnings.append(f"{path.relative_to(ROOT)}: diary-body marker 없음")
    return entries, warnings


def build_web(report: dict | None = None) -> dict:
    ensure_dirs()
    if report is None:
        report = new_report("build-web")
    entries, warnings = read_md_entries()
    for folder in (DATA_DIR / "entries", DATA_DIR / "texts"):
        folder.mkdir(parents=True, exist_ok=True)
        for path in folder.glob("*"):
            if path.is_file():
                path.unlink()
    PHOTOS_DIR.mkdir(parents=True, exist_ok=True)

    index: dict[str, dict] = {}
    for key in sorted(entries):
        item = entries[key]
        photos = item["photos"]
        index[key] = {
            "title": item["title"],
            "entryUrl": f"data/entries/{key}.json",
            "hasPhotos": bool(photos),
        }
        entry = {
            "date": key,
            "title": item["title"],
            "bodyUrl": f"data/texts/{key}.txt",
            "sourceMd": item["sourceMd"],
            "photos": photos,
        }
        entry_path_for(key).write_text(json.dumps(entry, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        text_path_for(key).write_text(item["body"], encoding="utf-8", newline="\n")

    (DATA_DIR / "diary-index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    report["data_entries"] = len(entries)
    report["warnings"].extend(warnings)
    if entries:
        keys = sorted(entries)
        report["first_date"] = keys[0]
        report["last_date"] = keys[-1]
    return report


def unique_target(path: Path) -> Path:
    if not path.exists():
        return path
    base = path.with_suffix("")
    suffix = path.suffix
    i = 2
    while True:
        candidate = Path(f"{base}-{i}{suffix}")
        if not candidate.exists():
            return candidate
        i += 1


def move_processed(path: Path, keys: list[str]) -> None:
    year = keys[0][:4] if keys else str(now().year)
    target_dir = INBOX_PROCESSED / year
    target_dir.mkdir(parents=True, exist_ok=True)
    shutil.move(str(path), str(unique_target(target_dir / path.name)))


def reject_file(path: Path, reason: str, report: dict) -> None:
    INBOX_REJECTED.mkdir(parents=True, exist_ok=True)
    target = unique_target(INBOX_REJECTED / path.name)
    shutil.move(str(path), str(target))
    target.with_suffix(target.suffix + ".reason.txt").write_text(reason + "\n", encoding="utf-8")
    report["rejected_files"] += 1
    report["warnings"].append(f"{path.name}: {reason}")


def process_inbox_file(path: Path, run_stamp: str, report: dict) -> None:
    try:
        text, encoding = read_text(path)
    except Exception as exc:
        reject_file(path, f"읽기 실패: {exc}", report)
        return
    fallback = date_from_filename(path)
    sections, warnings = parse_dated_sections(text, fallback)
    report["warnings"].extend([f"{path.name}: {warning}" for warning in warnings])
    if not sections:
        reject_file(path, "날짜를 찾지 못함", report)
        return
    processed_keys = []
    for key, bodies in sorted(sections.items()):
        for body in bodies:
            add_or_append_md(key, body, path.name, run_stamp, report)
        processed_keys.append(key)
    report["processed_files"] += 1
    report["input_encodings"].append(f"{path.name}: {encoding}")
    move_processed(path, processed_keys)


def sync() -> dict:
    ensure_dirs()
    report = new_report("sync")
    run_stamp = stamp()
    files = sorted([p for p in INBOX_NEW.iterdir() if p.is_file() and p.suffix.lower() in (".txt", ".md")])
    for path in files:
        process_inbox_file(path, run_stamp, report)
    write_diary_index(existing_keys())
    build_web(report)
    write_report(report)
    return report


def import_diart() -> dict:
    ensure_dirs()
    report = new_report("import-diart")
    run_stamp = stamp()
    source = ROOT / "diart.txt"
    if not source.exists():
        source = ROOT / "diary.txt"
    if not source.exists():
        report["warnings"].append("diart.txt 또는 diary.txt를 찾지 못함")
        write_report(report)
        return report
    text, encoding = read_text(source)
    sections, warnings = parse_dated_sections(text)
    report["warnings"].extend(warnings)
    report["input_encodings"].append(f"{source.name}: {encoding}")
    for key, bodies in sorted(sections.items()):
        for body in bodies:
            add_or_append_md(key, body, source.name, run_stamp, report)
    report["processed_files"] = 1 if sections else 0
    write_diary_index(existing_keys())
    build_web(report)
    write_report(report)
    return report


def git_status() -> str:
    if not (ROOT / ".git").exists():
        return "Git 저장소가 아닙니다."
    try:
        proc = subprocess.run(
            ["git", "status", "--short"],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=False,
        )
    except OSError as exc:
        return f"git status 실행 실패: {exc}"
    return proc.stdout.strip() or "변경 없음"


def new_report(command: str) -> dict:
    return {
        "run_at": iso_now(),
        "command": command,
        "processed_files": 0,
        "created_md": 0,
        "updated_md": 0,
        "rejected_files": 0,
        "data_entries": 0,
        "first_date": "없음",
        "last_date": "없음",
        "merged_dates": [],
        "warnings": [],
        "input_encodings": [],
    }


def write_report(report: dict) -> None:
    git = git_status()
    lines = [
        "# Diary Pipeline Report",
        "",
        f"- 실행 시각: {report['run_at']}",
        f"- 실행 명령: {report['command']}",
        f"- 처리한 inbox 파일 수: {report['processed_files']}",
        f"- 생성한 md 파일 수: {report['created_md']}",
        f"- 갱신한 md 파일 수: {report['updated_md']}",
        f"- rejected 파일 수: {report['rejected_files']}",
        f"- 생성/갱신한 data entry 수: {report['data_entries']}",
        f"- 첫 날짜: {report['first_date']}",
        f"- 마지막 날짜: {report['last_date']}",
        "",
        "## 중복/추가 병합된 날짜",
        "",
    ]
    if report["merged_dates"]:
        for key in sorted(set(report["merged_dates"])):
            lines.append(f"- {key}")
    else:
        lines.append("- 없음")
    lines.extend(["", "## 입력 인코딩", ""])
    lines.extend([f"- {item}" for item in report["input_encodings"]] or ["- 없음"])
    lines.extend(["", "## 경고", ""])
    lines.extend([f"- {item}" for item in report["warnings"]] or ["- 없음"])
    lines.extend(["", "## Git status", "", "```text", git, "```", ""])
    REPORT_PATH.write_text("\n".join(lines), encoding="utf-8", newline="\n")


def status() -> None:
    ensure_dirs()
    obsidian_count = len(existing_keys())
    data_index_count = 0
    index_path = DATA_DIR / "diary-index.json"
    if index_path.exists():
        try:
            data_index_count = len(json.loads(index_path.read_text(encoding="utf-8")))
        except json.JSONDecodeError:
            data_index_count = -1
    pending = len([p for p in INBOX_NEW.iterdir() if p.is_file() and p.suffix.lower() in (".txt", ".md")])
    print(f"Obsidian diaries: {obsidian_count}")
    print(f"Data index entries: {data_index_count}")
    print(f"Inbox pending files: {pending}")
    if REPORT_PATH.exists():
        print("Last report:")
        for line in REPORT_PATH.read_text(encoding="utf-8").splitlines()[:14]:
            print(line)
    else:
        print("Last report: none")
    print("Git status:")
    print(git_status())


def validate_json_files() -> None:
    json.loads((DATA_DIR / "diary-index.json").read_text(encoding="utf-8"))
    for path in (DATA_DIR / "entries").glob("*.json"):
        json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync diary inbox to Obsidian md and static web data")
    parser.add_argument("command", choices=("sync", "build-web", "import-diart", "status"))
    args = parser.parse_args()

    if args.command == "sync":
        report = sync()
        validate_json_files()
        print(f"sync complete: {report['data_entries']} entries")
    elif args.command == "build-web":
        ensure_dirs()
        report = build_web(new_report("build-web"))
        write_report(report)
        validate_json_files()
        print(f"build-web complete: {report['data_entries']} entries")
    elif args.command == "import-diart":
        report = import_diart()
        validate_json_files()
        print(f"import-diart complete: {report['data_entries']} entries")
    else:
        status()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
