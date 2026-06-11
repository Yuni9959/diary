# Pre-GitHub Checklist

GitHub owner/repo 값과 토큰은 마지막 단계에서만 설정합니다. 그 전에는 아래 상태를 유지합니다.

## 지금 완료한 안전 기준

- `GITHUB_TOKEN`은 브라우저 코드에 넣지 않습니다.
- Worker만 `env.GITHUB_TOKEN`을 읽습니다.
- `worker/wrangler.toml`에는 실제 owner/repo/token 값을 넣지 않고 placeholder를 유지합니다.
- WRITE_TOKEN은 브라우저 `localStorage`에 영구 저장하지 않고 현재 탭의 `sessionStorage`에만 둡니다.
- 일기 업로드 실패 시 원문 draft는 보존되고 outbox에 남습니다.

## 로컬 안전점검

```powershell
powershell -ExecutionPolicy Bypass -File .\Diary_formyWife\tools\check_pre_github_safety.ps1
```

## 마지막 GitHub 연결 단계에서만 할 일

1. `worker/wrangler.toml`의 `GITHUB_OWNER`, `GITHUB_REPO`, `ALLOWED_ORIGINS`를 실제 값으로 바꿉니다.
2. Cloudflare에 `GITHUB_TOKEN`, `WRITE_TOKEN`을 secret으로 등록합니다.
3. `wrangler deploy`로 Worker를 배포합니다.
4. PWA 업로드 설정에 Worker API URL과 WRITE_TOKEN을 입력해 실제 업로드를 테스트합니다.
5. GitHub Actions 실행과 Pages 반영을 확인합니다.
