# 일기 데이터 추가 방법

이 프로젝트는 긴 일기 본문을 `index.html`이나 `data/diary-index.json`에 직접 넣지 않습니다. 달력은 가벼운 인덱스 파일만 먼저 읽고, 사용자가 날짜를 눌렀을 때 해당 날짜의 상세 JSON과 본문 TXT를 불러옵니다.

## 폴더 구조

```text
data/
  diary-index.json
  entries/
    YYYY-MM-DD.json
  texts/
    YYYY-MM-DD.txt
  photos/
    YYYY-MM-DD-01.jpg
```

## 새 일기 추가 순서

1. `data/texts/YYYY-MM-DD.txt` 파일을 작성합니다.
   - 실제 긴 일기 본문은 여기에 일반 텍스트로 넣습니다.
   - 빈 줄은 문단 구분으로 표시됩니다.
   - 문단 안의 단일 줄바꿈도 화면에 줄바꿈으로 보존됩니다.

2. `data/entries/YYYY-MM-DD.json` 파일을 작성합니다.

```json
{
  "date": "2026-06-08",
  "title": "비 오는 날의 우리",
  "bodyUrl": "data/texts/2026-06-08.txt",
  "photos": []
}
```

3. `data/diary-index.json`에 날짜를 추가합니다.

```json
{
  "2026-06-08": {
    "title": "비 오는 날의 우리",
    "entryUrl": "data/entries/2026-06-08.json",
    "hasPhotos": false
  }
}
```

4. 사진은 나중에 `data/photos` 폴더에 넣고 `photos` 배열에 추가합니다.

```json
"photos": [
  {
    "src": "data/photos/2026-06-08-01.jpg",
    "alt": "함께 마신 차 사진",
    "caption": "비 오는 날 함께 마신 차"
  }
]
```

기존처럼 문자열 배열도 사용할 수 있습니다.

```json
"photos": ["data/photos/2026-06-08-01.jpg"]
```

## 본문 작성 방식

권장 방식은 `bodyUrl`입니다.

```json
{
  "bodyUrl": "data/texts/2026-06-08.txt"
}
```

호환을 위해 상세 JSON 안에 `body`를 직접 넣는 방식도 지원합니다.

```json
{
  "body": "본문 첫 줄\n본문 둘째 줄"
}
```

또는 문단 배열로도 작성할 수 있습니다.

```json
{
  "body": [
    "첫 번째 문단",
    "두 번째 문단"
  ]
}
```

## 로컬 테스트

`file://`로 `index.html`을 직접 열면 브라우저 보안 정책 때문에 `fetch`가 실패할 수 있습니다. 로컬에서는 프로젝트 폴더에서 간단한 서버를 실행한 뒤 브라우저로 접속하세요.

```bash
python -m http.server 8000
```

그 다음 아래 주소를 엽니다.

```text
http://localhost:8000/
```
