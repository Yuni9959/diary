# Phase 2 Serverless API

이번 단계의 목표는 PWA에서 보낸 일기 텍스트를 GitHub 저장소의 `Diary_formyWife/inbox/new/*.txt`로 넣을 수 있는 서버리스 API 초안을 만드는 것입니다.

아직 PWA 글쓰기 화면과 연결하지 않았습니다. Phase 2는 Worker API 준비까지만 포함합니다.

## 추가된 파일

- `worker/src/index.js`
- `worker/wrangler.toml`
- `Diary_formyWife/tools/check_worker_phase2.ps1`

## API

```text
POST /api/diary
```

요청 예시:

```json
{
  "date": "2026-06-08",
  "title": "오늘의 마음",
  "body": "긴 일기 본문...",
  "clientId": "pwa"
}
```

인증은 브라우저 코드에 GitHub 토큰을 넣지 않기 위해 Worker에서 처리합니다. 클라이언트는 쓰기 토큰만 보냅니다.

권장 헤더:

```text
Authorization: Bearer <WRITE_TOKEN>
Content-Type: application/json
```

또는:

```text
X-Write-Token: <WRITE_TOKEN>
```

## Worker가 하는 일

1. `POST /api/diary`만 허용
2. `WRITE_TOKEN` 확인
3. Origin 허용 목록 확인
4. 날짜와 본문 검증
5. GitHub Contents API로 `Diary_formyWife/inbox/new/YYYY-MM-DD-YYYYMMDDHHMMSS-pwa.txt` 생성
6. 성공/실패 JSON 응답 반환

생성되는 txt 형식:

```text
2026년 6월 8일

제목: 오늘의 마음

긴 일기 본문...
```

이 형식은 기존 `tools/diary_pipeline.py sync`가 처리하기 쉬운 형태입니다.

## 환경 변수와 Secret

`worker/wrangler.toml`에 공개 설정 값을 넣습니다.

```toml
GITHUB_OWNER = "YOUR_GITHUB_OWNER"
GITHUB_REPO = "YOUR_REPOSITORY_NAME"
GITHUB_BRANCH = "main"
ALLOWED_ORIGINS = "http://localhost:8000,https://YOUR_SITE.example"
```

민감한 값은 코드나 Git에 넣지 말고 Cloudflare secret으로 설정합니다.

```powershell
cd "C:\Users\tmddb\Desktop\BUBU\Diary_formyWife\worker"
wrangler secret put GITHUB_TOKEN
wrangler secret put WRITE_TOKEN
```

- `GITHUB_TOKEN`: GitHub repository contents write 권한이 있는 토큰
- `WRITE_TOKEN`: PWA에서 Worker로 보낼 쓰기 비밀번호/토큰

GitHub 토큰은 PWA 코드에 절대 넣지 않습니다.

## 로컬 Worker 테스트

Wrangler가 설치되어 있고 Cloudflare 로그인이 되어 있다는 전제입니다.

```powershell
cd "C:\Users\tmddb\Desktop\BUBU\Diary_formyWife\worker"
wrangler dev
```

다른 PowerShell에서:

```powershell
$body = @{
  date = "2026-06-08"
  title = "오늘의 마음"
  body = "긴 일기 본문..."
  clientId = "pwa"
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "http://localhost:8787/api/diary" `
  -Headers @{ Authorization = "Bearer YOUR_WRITE_TOKEN" } `
  -ContentType "application/json" `
  -Body $body
```

성공하면 GitHub 저장소에 `Diary_formyWife/inbox/new/*.txt` 파일이 생성됩니다.

## 정적 검증

```powershell
powershell -ExecutionPolicy Bypass -File .\Diary_formyWife\tools\check_worker_phase2.ps1
```

## Phase 2 범위 밖

- PWA 글쓰기 화면과 실제 업로드 연결
- GitHub Actions 자동 변환
- Pages 배포 자동화
- 사진 업로드
- 읽기 접근 제한

## 보안 주의

- GitHub 토큰은 Worker secret에만 둡니다.
- 공개 배포된 정적 사이트는 `data/` 파일을 직접 접근할 수 있습니다.
- 이 API는 쓰기 보호용 초안입니다. 운영 전에는 rate limit, 더 강한 인증, 로그 모니터링을 추가하는 것이 좋습니다.
