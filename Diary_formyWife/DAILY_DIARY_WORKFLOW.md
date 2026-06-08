# Daily Diary Workflow

## 1. 새 일기를 쓰는 가장 쉬운 방법

1. `inbox/new/2026-02-28.txt` 파일을 만듭니다.
2. 첫 줄에 날짜를 씁니다.

```text
2026년 2월 28일

오늘은 당신에게 이런 마음을 전하고 싶었다.
```

3. 아래 명령을 실행합니다.

```bash
python tools/diary_pipeline.py sync
```

처리된 원본 txt/md 파일은 `inbox/processed/YYYY/`로 이동됩니다. 날짜를 찾지 못한 파일은 `inbox/rejected/`로 이동되고 이유 파일이 함께 생성됩니다.

## 2. Obsidian에서 수정하는 방법

`obsidian/diaries/YYYY/YYYY-MM-DD.md` 파일을 엽니다. 홈페이지에 보여줄 본문은 아래 두 마커 사이에서 수정하세요.

```markdown
<!-- diary-body:start -->
본문
<!-- diary-body:end -->
```

수정 후 홈페이지용 데이터를 다시 만들려면 아래 명령을 실행합니다.

```bash
python tools/diary_pipeline.py build-web
```

## 3. 사진 추가 방법

사진 파일은 `data/photos/`에 넣습니다. 그 다음 날짜 md 파일의 frontmatter에 `photos_json` 또는 `photos`를 추가합니다.

```yaml
photos_json: [{"src":"data/photos/2026-02-28-01.jpg","alt":"사진 설명","caption":"사진 아래 문구"}]
```

또는:

```yaml
photos:
  - src: data/photos/2026-02-28-01.jpg
    alt: 사진 설명
    caption: 사진 아래 문구
```

그 후 다시 빌드합니다.

```bash
python tools/diary_pipeline.py build-web
```

## 4. 홈페이지 확인 방법

`file://`로 `index.html`을 직접 열면 브라우저 보안 정책 때문에 `fetch`가 실패할 수 있습니다. 로컬 서버로 확인하세요.

```bash
python -m http.server 8000
```

브라우저에서 아래 주소로 접속합니다.

```text
http://localhost:8000
```

## 5. Git push 방법

파이프라인은 자동으로 push하지 않습니다. 결과를 확인한 뒤 직접 실행하세요.

```bash
git status
git add obsidian data inbox tools DAILY_DIARY_WORKFLOW.md DIARY_PIPELINE_REPORT.md
git commit -m "Update diary data"
git push
```

PowerShell 보조 스크립트도 사용할 수 있습니다.

```powershell
.\tools\sync_diary.ps1
```

## 6. 주의사항

- 실제 DB는 사용하지 않습니다. 홈페이지 데이터는 Git에 push 가능한 `data/` 폴더의 정적 JSON/TXT 파일입니다.
- 이미 만들어진 md를 직접 고치면 `python tools/diary_pipeline.py build-web`을 다시 실행해야 합니다.
- 홈페이지 데이터는 `data/` 폴더가 기준입니다.
- `data/photos/` 안의 사진 파일은 파이프라인이 삭제하지 않습니다.
