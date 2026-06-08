# Diary Import Guide

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
