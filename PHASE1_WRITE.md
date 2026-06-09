# Phase 1 Write UI

이번 단계의 목표는 서버 연결 없이 휴대폰에서 일기를 편하게 쓰고 잃어버리지 않게 하는 것입니다.

## 포함된 기능

- 글쓰기 버튼
- 날짜 선택
- 제목 입력
- 본문 입력
- `localStorage` 임시 저장
- 작성 중인 글 복구
- `.txt` 다운로드

## 저장 위치

작성 중인 글은 브라우저 내부 `localStorage`에 저장됩니다.

```text
diaryWriterDraft:v1
```

이 단계에서는 서버, GitHub, Cloudflare Worker, API를 사용하지 않습니다.

## txt 형식

다운로드되는 파일은 나중에 `inbox/new/`에 넣기 쉬운 형식입니다.

```text
2026년 6월 8일

제목: 오늘의 마음

긴 일기 본문...
```

## 수동 테스트

```powershell
cd "C:\Users\tmddb\Desktop\BUBU\Diary_formyWife"
py -3 -m http.server 8000
```

브라우저에서 엽니다.

```text
http://localhost:8000
```

확인할 것:

1. `글쓰기` 버튼을 누르면 글쓰기 화면이 열린다.
2. 날짜, 제목, 본문을 입력할 수 있다.
3. `임시 저장`을 누르면 저장 메시지가 나온다.
4. 새로고침 후 다시 `글쓰기`를 누르면 작성 중인 글이 복구된다.
5. `txt 다운로드`를 누르면 `YYYY-MM-DD.txt` 파일이 내려받아진다.
6. 오프라인이어도 이미 열린 화면에서는 draft가 유지된다.

## 자동 검증

```powershell
powershell -ExecutionPolicy Bypass -File .\Diary_formyWife\tools\check_write_phase1.ps1
```

## Phase 1 범위 밖

- 서버 저장
- Cloudflare Worker
- GitHub API 업로드
- GitHub Actions 자동 변환
- 사진 업로드
- 비밀번호/토큰 인증
