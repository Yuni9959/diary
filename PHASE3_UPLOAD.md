# Phase 3 Upload Connection

이번 단계는 Phase 1의 글쓰기 화면을 Phase 2의 Cloudflare Worker API에 연결하는 것입니다.

## 포함된 기능

- Worker API URL 입력
- WRITE_TOKEN 입력
- `저장` 버튼으로 `POST /api/diary` 전송
- 업로드 성공 메시지
- 업로드 성공 시 현재 draft 삭제 및 최근 업로드 archive 저장
- 업로드 실패 시 draft 유지
- 업로드 실패/오프라인 시 전송 대기함 보관
- `다시 보내기` 버튼으로 전송 대기 글 재시도

## 브라우저 localStorage 키

```text
diaryWriterDraft:v1
diaryWriterSettings:v1
diaryWriterOutbox:v1
diaryWriterArchive:v1
```

`diaryWriterSettings:v1`에는 Worker API URL만 저장합니다. WRITE_TOKEN은 `sessionStorage`의 `diaryWriterToken:session:v1`에만 보관되어 현재 브라우저 탭 세션이 끝나면 사라집니다.

GitHub 토큰은 브라우저에 저장하지 않습니다. 브라우저에는 GitHub 토큰을 절대 넣지 않고, Worker URL과 WRITE_TOKEN만 입력합니다.

## 사전 준비

Cloudflare Worker가 배포되어 있어야 합니다.

```powershell
cd "C:\Users\tmddb\Desktop\BUBU\Diary_formyWife\worker"
wrangler secret put GITHUB_TOKEN
wrangler secret put WRITE_TOKEN
wrangler deploy
```

`worker/wrangler.toml`의 `ALLOWED_ORIGINS`에는 실제 PWA 주소를 넣어야 합니다.

로컬 테스트라면:

```toml
ALLOWED_ORIGINS = "http://localhost:8000"
```

## 수동 테스트

PWA 실행:

```powershell
cd "C:\Users\tmddb\Desktop\BUBU\Diary_formyWife"
py -3 -m http.server 8000
```

브라우저:

```text
http://localhost:8000
```

테스트 순서:

1. `글쓰기` 버튼을 누릅니다.
2. 날짜, 제목, 본문을 입력합니다.
3. `업로드 설정`을 열고 Worker API URL을 입력합니다.
   - 예: `https://your-worker.your-account.workers.dev/api/diary`
4. WRITE_TOKEN을 입력합니다.
5. `저장` 버튼을 누릅니다.
6. 성공하면 `업로드 완료. 곧 반영돼요.` 메시지가 나옵니다.
7. 실패하면 전송 대기함에 보관되고 `다시 보내기`로 재시도할 수 있습니다.

## 실패 처리

- 네트워크 실패: draft 유지, 전송 대기함 저장
- 오프라인: draft 유지, 전송 대기함 저장
- Worker 오류: draft 유지, 전송 대기함 저장
- 성공: 현재 draft 삭제, archive에 최근 업로드 기록 보관

## 자동 검증

```powershell
powershell -ExecutionPolicy Bypass -File .\Diary_formyWife\tools\check_upload_phase3.ps1
```

## Phase 3 범위 밖

- GitHub Actions 자동 변환
- Pages 자동 배포
- 사진 업로드
- 읽기 접근 제한
- GitHub 토큰을 프론트엔드에 저장하는 방식
