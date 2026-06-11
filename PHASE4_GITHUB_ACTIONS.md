# Phase 4 GitHub Actions 자동 변환

이번 단계는 Worker가 GitHub 저장소에 `Diary_formyWife/inbox/new/*.txt`를 만들었을 때, GitHub Actions가 자동으로 일기 데이터를 변환하고 GitHub Pages에 배포하도록 만드는 단계입니다.

## 추가된 파일

- `.github/workflows/diary-sync.yml`
- `Diary_formyWife/tools/check_actions_phase4.ps1`

## 동작 흐름

1. Worker가 `Diary_formyWife/inbox/new/*.txt` 파일을 push합니다.
2. GitHub Actions가 실행됩니다.
3. `python tools/diary_pipeline.py sync`를 `Diary_formyWife` 폴더에서 실행합니다.
4. 생성/갱신된 `Diary_formyWife/obsidian`, `Diary_formyWife/data`, `Diary_formyWife/inbox`, `DIARY_PIPELINE_REPORT.md`를 commit합니다.
5. `_site` 폴더에 Pages 공개 파일만 조립합니다.
6. GitHub Pages artifact를 업로드하고 같은 워크플로 안에서 배포합니다.

## Pages에 배포되는 파일

공개되는 파일:

- `index.html`
- `manifest.webmanifest`
- `sw.js`
- `icons/`
- `img/`
- `Diary_formyWife/data/`

공개 artifact에 넣지 않는 폴더:

- `Diary_formyWife/inbox/`
- `Diary_formyWife/obsidian/`
- `Diary_formyWife/tools/`
- `Diary_formyWife/backups/`

단, GitHub 저장소가 public이면 저장소 파일 자체는 볼 수 있습니다. 정말 비공개 일기라면 Pages 배포 방식과 저장소 공개 범위를 별도로 검토해야 합니다.

## GitHub Pages 설정

저장소 Settings > Pages에서 Source를 GitHub Actions로 설정하세요.

이 워크플로는 GitHub 공식 Pages Actions 흐름인 `configure-pages`, `upload-pages-artifact`, `deploy-pages`를 사용합니다.

## 권한

워크플로 권한:

```yaml
permissions:
  contents: write
  pages: write
  id-token: write
```

- `contents: write`: 생성된 data/obsidian/inbox 변경 commit
- `pages: write`: Pages 배포
- `id-token: write`: Pages 배포 인증

## 주의사항

GitHub Actions의 `GITHUB_TOKEN`으로 push한 커밋은 별도의 Pages 빌드를 다시 트리거하지 않을 수 있습니다. 그래서 이 워크플로는 data 생성 후 같은 실행 안에서 Pages artifact를 직접 배포합니다.

## 수동 실행

GitHub Actions 탭에서 `Diary sync and Pages deploy` 워크플로를 선택하고 `Run workflow`를 누르면 수동 실행할 수 있습니다.

## 로컬 정적 검증

```powershell
powershell -ExecutionPolicy Bypass -File .\Diary_formyWife\tools\check_actions_phase4.ps1
```

## Phase 4 범위 밖

- 사진 업로드
- 접근 제한/로그인
- Worker 배포 자동화
- Cloudflare 설정 자동화
