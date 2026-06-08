#!/usr/bin/env python3
"""Import diary text into Obsidian Markdown and build web data files."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE_CANDIDATES = ("diart.txt", "diary.txt")
DATE_RE = re.compile(
    r"^\s*(?P<year>19\d{2}|20\d{2})\s*(?:년|\.)\s*"
    r"(?P<month>0?[1-9]|1[0-2])\s*(?:월|\.)\s*"
    r"(?P<day>0?[1-9]|[12]\d|3[01])\s*(?:일|\.)?"
    r"(?:\s*(?:\([월화수목금토일]\)|[월화수목금토일](?:요일)?))?\s*$"
)
BODY_START = "<!-- diary-body:start -->"
BODY_END = "<!-- diary-body:end -->"
GENERATED_MARKER = "generated_by: diary_importer.py"


def now_stamp() -> str:
    return dt.datetime.now().strftime("%Y%m%d-%H%M%S")


def today_iso() -> str:
    return dt.datetime.now().isoformat(timespec="seconds")


def normalize_newlines(text: str) -> str:
    return text.replace("\r\n", "\n").replace("\r", "\n")


def read_text_with_fallback(path: Path) -> tuple[str, str]:
    data = path.read_bytes()
    last_error = None
    for encoding in ("utf-8-sig", "utf-8", "cp949"):
        try:
            return normalize_newlines(data.decode(encoding)), encoding
        except UnicodeDecodeError as exc:
            last_error = exc
    raise UnicodeDecodeError("unknown", data, 0, 1, str(last_error))


def source_path() -> Path:
    for name in SOURCE_CANDIDATES:
        candidate = ROOT / name
        if candidate.exists():
            return candidate
    raise FileNotFoundError("diart.txt or diary.txt was not found in the project root")


def date_key(year: int, month: int, day: int) -> str:
    return f"{year:04d}-{month:02d}-{day:02d}"


def display_title(key: str) -> str:
    year, month, day = (int(part) for part in key.split("-"))
    return f"{year}년 {month}월 {day}일"


def wikilink_for(key: str) -> str:
    year = key[:4]
    return f"[[diaries/{year}/{key}|{display_title(key)}]]"


def parse_entries(text: str) -> tuple[dict[str, list[str]], str, list[str]]:
    entries: dict[str, list[str]] = {}
    warnings: list[str] = []
    current_key: str | None = None
    current_lines: list[str] = []
    unmatched: list[str] = []

    def flush() -> None:
        nonlocal current_lines
        if current_key is None:
            if any(line.strip() for line in current_lines):
                unmatched.extend(current_lines)
            current_lines = []
            return
        body = "\n".join(current_lines).strip("\n")
        entries.setdefault(current_key, []).append(body)
        current_lines = []

    for line in text.split("\n"):
        match = DATE_RE.match(line)
        if match:
            flush()
            y = int(match.group("year"))
            m = int(match.group("month"))
            d = int(match.group("day"))
            try:
                dt.date(y, m, d)
            except ValueError:
                warnings.append(f"잘못된 날짜를 건너뜀: {line}")
                current_key = None
                current_lines = []
                continue
            current_key = date_key(y, m, d)
            continue
        current_lines.append(line)

    flush()
    return entries, "\n".join(unmatched).strip("\n"), warnings


def ensure_dirs() -> None:
    for path in (
        ROOT / "obsidian" / "diaries",
        ROOT / "data" / "entries",
        ROOT / "data" / "texts",
        ROOT / "data" / "photos",
        ROOT / "backups",
    ):
        path.mkdir(parents=True, exist_ok=True)


def backup_existing(paths: list[Path], reason: str) -> Path | None:
    existing = [p for p in paths if p.exists()]
    if not existing:
        return None
    backup_dir = ROOT / "backups" / f"{reason}-{now_stamp()}"
    backup_dir.mkdir(parents=True, exist_ok=True)
    for path in existing:
        target = backup_dir / path.relative_to(ROOT)
        target.parent.mkdir(parents=True, exist_ok=True)
        if path.is_dir():
            shutil.copytree(path, target, dirs_exist_ok=True)
        else:
            shutil.copy2(path, target)
    return backup_dir


def combined_body(parts: list[str]) -> str:
    chunks: list[str] = []
    for idx, part in enumerate(parts, start=1):
        if idx > 1:
            chunks.append(f"---\n<!-- duplicate-source-entry: {idx} -->")
        chunks.append(part.strip("\n"))
    return "\n\n".join(chunks).strip("\n") + "\n"


def markdown_for(key: str, body: str, prev_key: str | None, next_key: str | None, source_name: str) -> str:
    year = key[:4]
    nav_parts = []
    if prev_key:
        nav_parts.append(f"이전: {wikilink_for(prev_key)}")
    if next_key:
        nav_parts.append(f"다음: {wikilink_for(next_key)}")
    nav = " | ".join(nav_parts)
    nav_block = f"\n{nav}\n" if nav else ""
    return (
        "---\n"
        f"date: {key}\n"
        f"title: {display_title(key)}\n"
        "tags:\n"
        "  - diary\n"
        "  - for-wife\n"
        "photos: []\n"
        f"source: {source_name}\n"
        f"web_entry: data/entries/{key}.json\n"
        f"web_text: data/texts/{key}.txt\n"
        f"{GENERATED_MARKER}\n"
        "---\n\n"
        f"# {display_title(key)}\n\n"
        "[[Diary Index|목록으로]]\n"
        f"{nav_block}\n"
        f"{BODY_START}\n"
        f"{body.rstrip()}\n"
        f"{BODY_END}\n"
    )


def can_overwrite_md(path: Path) -> bool:
    if not path.exists():
        return True
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return False
    return GENERATED_MARKER in text


def write_md_files(entries: dict[str, list[str]], source_name: str, report: dict) -> None:
    keys = sorted(entries)
    skipped: list[str] = []
    new_files: list[str] = []
    backup_existing([ROOT / "obsidian" / "diaries", ROOT / "obsidian" / "Diary Index.md"], "import-md")

    for idx, key in enumerate(keys):
        year = key[:4]
        path = ROOT / "obsidian" / "diaries" / year / f"{key}.md"
        path.parent.mkdir(parents=True, exist_ok=True)
        text = markdown_for(
            key,
            combined_body(entries[key]),
            keys[idx - 1] if idx > 0 else None,
            keys[idx + 1] if idx < len(keys) - 1 else None,
            source_name,
        )
        if can_overwrite_md(path):
            path.write_text(text, encoding="utf-8", newline="\n")
            new_files.append(str(path.relative_to(ROOT)))
        else:
            new_path = path.with_suffix(path.suffix + ".new")
            new_path.write_text(text, encoding="utf-8", newline="\n")
            skipped.append(str(path.relative_to(ROOT)))
            new_files.append(str(new_path.relative_to(ROOT)))

    write_obsidian_index(keys)
    report["md_files_written"] = new_files
    report["manual_review_md"] = skipped


def write_obsidian_index(keys: list[str]) -> None:
    lines = ["# Diary Index", ""]
    current_month = None
    for key in keys:
        year, month, _day = (int(part) for part in key.split("-"))
        month_heading = f"{year}년 {month}월"
        if month_heading != current_month:
            if current_month is not None:
                lines.append("")
            lines.append(f"## {month_heading}")
            current_month = month_heading
        lines.append(f"- {wikilink_for(key)}")
    lines.append("")
    path = ROOT / "obsidian" / "Diary Index.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8", newline="\n")


def parse_frontmatter(text: str) -> tuple[dict, str]:
    if not text.startswith("---\n"):
        return {}, text
    end = text.find("\n---\n", 4)
    if end == -1:
        return {}, text
    raw = text[4:end]
    body = text[end + 5 :]
    meta: dict = {}
    lines = raw.split("\n")
    idx = 0
    while idx < len(lines):
        line = lines[idx]
        if ":" not in line:
            idx += 1
            continue
        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip()
        if key == "photos":
            if value == "[]":
                meta[key] = []
            elif value:
                try:
                    meta[key] = json.loads(value)
                except json.JSONDecodeError:
                    meta[key] = []
            else:
                photos = []
                idx += 1
                current = None
                while idx < len(lines) and (lines[idx].startswith("  ") or lines[idx].startswith("-")):
                    item = lines[idx].strip()
                    if item.startswith("- "):
                        if current:
                            photos.append(current)
                        current = {}
                        item = item[2:]
                    if ":" in item and current is not None:
                        k, v = item.split(":", 1)
                        current[k.strip()] = v.strip().strip('"').strip("'")
                    idx += 1
                if current:
                    photos.append(current)
                meta[key] = photos
                continue
        else:
            meta[key] = value.strip('"').strip("'")
        idx += 1
    return meta, body


def extract_diary_body(text: str) -> str:
    start = text.find(BODY_START)
    end = text.find(BODY_END)
    if start == -1 or end == -1 or end < start:
        return text.strip("\n") + "\n"
    body = text[start + len(BODY_START) : end]
    return body.strip("\n") + "\n"


def read_md_entries() -> tuple[dict[str, dict], list[str]]:
    md_root = ROOT / "obsidian" / "diaries"
    entries: dict[str, dict] = {}
    warnings: list[str] = []
    for path in sorted(md_root.glob("*/*.md")):
        match = re.match(r"(\d{4}-\d{2}-\d{2})\.md$", path.name)
        if not match:
            continue
        key = match.group(1)
        text = path.read_text(encoding="utf-8")
        meta, body_with_markers = parse_frontmatter(text)
        entries[key] = {
            "title": meta.get("title") or display_title(key),
            "photos": meta.get("photos") or [],
            "body": extract_diary_body(body_with_markers),
            "sourceMd": str(path.relative_to(ROOT)).replace("\\", "/"),
        }
        if BODY_START not in text or BODY_END not in text:
            warnings.append(f"{path.relative_to(ROOT)}: diary-body marker가 없어 전체 본문을 사용함")
    return entries, warnings


def build_web_data(report: dict) -> None:
    ensure_dirs()
    backup_existing(
        [ROOT / "data" / "diary-index.json", ROOT / "data" / "entries", ROOT / "data" / "texts"],
        "build-web-data",
    )
    entries, warnings = read_md_entries()
    index = {}
    written_entries = []
    written_texts = []
    for key in sorted(entries):
        item = entries[key]
        title = item["title"]
        photos = item["photos"] if isinstance(item["photos"], list) else []
        index[key] = {
            "title": title,
            "entryUrl": f"data/entries/{key}.json",
            "hasPhotos": bool(photos),
        }
        entry_json = {
            "date": key,
            "title": title,
            "bodyUrl": f"data/texts/{key}.txt",
            "sourceMd": item["sourceMd"],
            "photos": photos,
        }
        entry_path = ROOT / "data" / "entries" / f"{key}.json"
        text_path = ROOT / "data" / "texts" / f"{key}.txt"
        entry_path.parent.mkdir(parents=True, exist_ok=True)
        text_path.parent.mkdir(parents=True, exist_ok=True)
        entry_path.write_text(json.dumps(entry_json, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        text_path.write_text(item["body"], encoding="utf-8", newline="\n")
        written_entries.append(str(entry_path.relative_to(ROOT)))
        written_texts.append(str(text_path.relative_to(ROOT)))

    (ROOT / "data" / "diary-index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (ROOT / "data" / "photos").mkdir(parents=True, exist_ok=True)
    report["web_entries"] = written_entries
    report["web_texts"] = written_texts
    report["web_warnings"] = warnings
    report["entry_count"] = len(entries)
    if entries:
        keys = sorted(entries)
        report["first_date"] = keys[0]
        report["last_date"] = keys[-1]


def write_import_report(report: dict) -> None:
    duplicates = report.get("duplicates", {})
    warnings = report.get("warnings", []) + report.get("web_warnings", [])
    manual_review = report.get("manual_review_md", [])
    lines = [
        "# Import Report",
        "",
        f"- 실행 일시: {report.get('run_at', today_iso())}",
        f"- 읽은 원본 파일: {report.get('source_file', '')}",
        f"- 원본 인코딩: {report.get('source_encoding', '')}",
        f"- 감지한 일기 개수: {report.get('detected_entries', 0)}",
        f"- 생성한 md 파일 개수: {len(report.get('md_files_written', []))}",
        f"- 생성한 data entry 개수: {len(report.get('web_entries', []))}",
        f"- 첫 날짜: {report.get('first_date', '없음')}",
        f"- 마지막 날짜: {report.get('last_date', '없음')}",
        f"- 날짜 이전 unmatched 텍스트 존재 여부: {'있음' if report.get('unmatched_before_first_date') else '없음'}",
        "",
        "## 중복 날짜",
        "",
    ]
    if duplicates:
        for key, count in duplicates.items():
            lines.append(f"- {key}: {count}개 본문을 하나로 합침")
    else:
        lines.append("- 없음")
    lines.extend(["", "## 경고/확인 필요 사항", ""])
    if warnings or manual_review:
        for item in warnings:
            lines.append(f"- {item}")
        for item in manual_review:
            lines.append(f"- 기존 md 파일 보호: {item} 대신 .new 파일 생성, 수동 확인 필요")
    else:
        lines.append("- 없음")
    lines.extend(["", "## 생성 파일 요약", ""])
    for item in report.get("md_files_written", [])[:200]:
        lines.append(f"- {item}")
    for item in report.get("web_entries", [])[:200]:
        lines.append(f"- {item}")
    if len(report.get("web_entries", [])) > 200:
        lines.append("- ...")
    lines.append("")
    (ROOT / "IMPORT_REPORT.md").write_text("\n".join(lines), encoding="utf-8", newline="\n")


def write_guide() -> None:
    text = """# Diary Import Guide

## 1. diart.txt에서 처음 가져오기

프로젝트 루트에 `diart.txt`를 두고 아래 명령을 실행합니다. 현재 저장소처럼 `diart.txt`가 없고 `diary.txt`가 있으면 스크립트가 `diary.txt`를 대체 입력으로 사용합니다.

```bash
python tools/diary_importer.py import
```

이 명령은 날짜별 Markdown 파일을 `obsidian/diaries/YYYY/YYYY-MM-DD.md`에 만들고, 홈페이지용 `data/` 파일도 함께 생성합니다.

## 2. Obsidian에서 md 파일 수정하기

원본처럼 관리할 파일은 `obsidian/diaries/YYYY/YYYY-MM-DD.md`입니다. 본문은 반드시 아래 두 마커 사이에서 수정하세요.

```markdown
<!-- diary-body:start -->
여기에 본문을 수정합니다.
<!-- diary-body:end -->
```

YAML frontmatter의 `title`을 바꾸면 홈페이지에 표시되는 제목도 바뀝니다.

## 3. 수정 후 홈페이지용 data 다시 만들기

Obsidian에서 md 파일을 수정한 뒤에는 아래 명령만 실행합니다.

```bash
python tools/diary_importer.py build-web
```

이 명령은 md 파일을 수정하지 않고 `data/diary-index.json`, `data/entries/*.json`, `data/texts/*.txt`만 다시 생성합니다.

## 4. 사진 추가 방법

사진 파일은 `data/photos/`에 넣고, 해당 날짜 md 파일의 `photos`에 추가합니다.

```yaml
photos:
  - src: data/photos/2026-02-28-01.jpg
    alt: 사진 설명
    caption: 사진 아래에 보여줄 문구
```

그러고 나서 `python tools/diary_importer.py build-web`을 실행하면 홈페이지용 entry JSON에 반영됩니다.

## 5. 로컬 테스트 방법

`file://`로 `index.html`을 직접 열면 브라우저 보안 정책 때문에 `fetch`가 실패할 수 있습니다. 로컬 서버로 확인하세요.

```bash
python -m http.server 8000
```

브라우저에서 아래 주소를 엽니다.

```text
http://localhost:8000
```
"""
    (ROOT / "DATA_IMPORT_GUIDE.md").write_text(text, encoding="utf-8", newline="\n")


def run_import() -> dict:
    ensure_dirs()
    src = source_path()
    text, encoding = read_text_with_fallback(src)
    entries, unmatched, warnings = parse_entries(text)
    if unmatched:
        unmatched_path = ROOT / "obsidian" / "_unmatched-before-first-date.md"
        unmatched_path.parent.mkdir(parents=True, exist_ok=True)
        unmatched_path.write_text(unmatched + "\n", encoding="utf-8", newline="\n")
        warnings.append("날짜 이전 텍스트를 obsidian/_unmatched-before-first-date.md에 저장함")

    duplicates = {key: len(parts) for key, parts in entries.items() if len(parts) > 1}
    report = {
        "run_at": today_iso(),
        "source_file": str(src.relative_to(ROOT)),
        "source_encoding": encoding,
        "detected_entries": sum(len(parts) for parts in entries.values()),
        "duplicates": duplicates,
        "unmatched_before_first_date": bool(unmatched),
        "warnings": warnings,
    }
    if entries:
        keys = sorted(entries)
        report["first_date"] = keys[0]
        report["last_date"] = keys[-1]

    write_md_files(entries, src.name, report)
    build_web_data(report)
    write_guide()
    write_import_report(report)
    return report


def run_build_web() -> dict:
    report = {
        "run_at": today_iso(),
        "source_file": "obsidian/diaries/**/*.md",
        "source_encoding": "utf-8",
        "detected_entries": 0,
        "duplicates": {},
        "unmatched_before_first_date": False,
        "warnings": [],
    }
    build_web_data(report)
    report["detected_entries"] = report.get("entry_count", 0)
    write_guide()
    write_import_report(report)
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="Import diary text and build web data")
    parser.add_argument("command", choices=("import", "build-web"))
    args = parser.parse_args()

    if args.command == "import":
        report = run_import()
    else:
        report = run_build_web()

    print(f"entries: {report.get('detected_entries', 0)}")
    print(f"first: {report.get('first_date', '없음')}")
    print(f"last: {report.get('last_date', '없음')}")
    print("report: IMPORT_REPORT.md")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
