# Diary Write API Worker

## Phase 2 목적

휴대폰 PWA에서 작성한 일기를 Cloudflare Worker API로 받아 GitHub 저장소의 `inbox/new/` 폴더에 txt 파일로 생성합니다. 실제 DB는 사용하지 않고, 최종 저장 위치는 GitHub 저장소 안의 정적 파일입니다.

Phase 3의 PWA 프론트엔드 연결과 GitHub Actions 자동 변환 작업은 이 범위에 포함하지 않습니다.

## API endpoint

- `POST /api/diary`: 일기 txt 파일 생성
- `GET /health`: secret 노출 없는 상태 확인

## wrangler.toml에서 바꿔야 할 값

- `GITHUB_OWNER`: GitHub 저장소 소유자
- `GITHUB_REPO`: GitHub 저장소 이름
- `GITHUB_BRANCH`: 저장할 브랜치, 기본값 `main`
- `ALLOWED_ORIGINS`: 요청을 허용할 PWA origin 목록

`GITHUB_TOKEN`, `WRITE_TOKEN`은 `wrangler.toml`에 넣지 않습니다.

## Cloudflare secret 등록

```powershell
cd "C:\Users\tmddb\Desktop\BUBU\Diary_formyWife\worker"
wrangler secret put GITHUB_TOKEN
wrangler secret put WRITE_TOKEN
```

## GitHub token 권한

GitHub Contents API로 파일을 만들기 때문에 저장소 Contents write 권한이 필요합니다. workflow 파일을 수정할 계획이 없다면 workflow 권한은 필요하지 않습니다.

## 로컬 개발

```powershell
npm install
npm run dev
```

로컬 테스트용 secret은 `.dev.vars`에 넣을 수 있습니다. 실제 값은 커밋하지 말고, 예시는 `.dev.vars.example`만 참고하세요.

## 테스트

```powershell
.\test_api.ps1 -ApiUrl "http://127.0.0.1:8787/api/diary"
```

배포 후에는 Worker URL을 넣어 테스트합니다.

```powershell
.\test_api.ps1 -ApiUrl "https://your-worker.your-account.workers.dev/api/diary"
```

스크립트는 `DIARY_WRITE_TOKEN` 환경 변수를 우선 사용하고, 없으면 실행 중 입력을 받습니다.

## 배포

```powershell
wrangler deploy
```

## 주의사항

- `GITHUB_TOKEN`은 절대 프론트엔드에 넣지 마세요.
- `WRITE_TOKEN`도 `index.html`에 하드코딩하지 마세요.
- Phase 3에서 PWA는 사용자가 `WRITE_TOKEN`을 입력해 `localStorage`에 저장하는 방식으로 연결할 예정입니다.
- 공개 URL로 배포하면 읽기용 `data` 폴더는 별도 보호 없이는 접근 가능할 수 있습니다.
