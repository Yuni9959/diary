# Phase 2 API Notes

## 상태 요약

Phase 2는 Cloudflare Worker 기반 서버리스 API 구현/검증 단계입니다. 휴대폰 PWA에서 작성한 일기를 `POST /api/diary`로 받아 GitHub 저장소의 `inbox/new/` 폴더에 txt 파일로 생성합니다.

실제 DB는 사용하지 않습니다. 최종 저장 위치는 GitHub 저장소 안의 정적 파일입니다.

## 구현 위치

- API: `POST /api/diary`
- 상태 확인: `GET /health`
- Worker 폴더: `worker/`
- GitHub 저장 위치: `inbox/new/`
- 파일명 패턴: `YYYY-MM-DD-YYYYMMDDHHMMSS-pwa.txt`

## 필요한 secrets

- `GITHUB_TOKEN`
- `WRITE_TOKEN`

등록 명령:

```powershell
cd "C:\Users\tmddb\Desktop\BUBU\Diary_formyWife\worker"
wrangler secret put GITHUB_TOKEN
wrangler secret put WRITE_TOKEN
```

## wrangler.toml에서 수정할 값

- `GITHUB_OWNER`
- `GITHUB_REPO`
- `GITHUB_BRANCH`
- `ALLOWED_ORIGINS`

`GITHUB_TOKEN`, `WRITE_TOKEN` 같은 실제 secret 값은 파일에 쓰지 않습니다.

## Phase 3에서 수정해야 할 것

- PWA 글쓰기 UI에서 Worker API URL 연결
- `WRITE_TOKEN` 입력/저장 방식 결정
- 저장 실패 시 draft 유지

## 범위 밖 작업

- PWA 프론트엔드 실제 연결
- GitHub Actions 자동 변환
- 자동 git commit
- 자동 git push
- 자동 wrangler deploy
