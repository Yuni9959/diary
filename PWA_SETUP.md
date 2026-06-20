# PWA Setup

## 추가된 파일

- `manifest.webmanifest`
- `sw.js`
- `icons/icon-192.png`
- `icons/icon-512.png`
- `icons/maskable-192.png`
- `icons/maskable-512.png`
- `icons/apple-touch-icon.png`
- `Diary_formyWife/tools/generate_pwa_icons.ps1`
- `Diary_formyWife/tools/check_pwa.ps1`

## 로컬 테스트 방법

```powershell
cd "C:\Users\tmddb\Desktop\BUBU\Diary_formyWife"
py -3 -m http.server 8000
```

브라우저에서 아래 주소를 엽니다.

```text
http://localhost:8000
```

`file://`로 직접 열면 PWA 설치와 service worker 검증이 되지 않습니다. localhost 또는 HTTPS에서 테스트해야 합니다.

## Chrome DevTools 확인 방법

1. Chrome에서 `http://localhost:8000`을 엽니다.
2. DevTools를 열고 Application 탭으로 이동합니다.
3. Manifest에서 앱 이름, 아이콘, start_url을 확인합니다.
4. Service Workers에서 `sw.js` 등록 상태를 확인합니다.
5. Cache Storage에서 `diary-pwa-v1-*` 캐시를 확인합니다.

## 휴대폰 설치 방법

Android Chrome:

- 사이트에 접속한 뒤 브라우저 메뉴 또는 설치 배너에서 앱 설치/홈 화면 추가를 선택합니다.

iPhone Safari:

- 사이트에 접속한 뒤 공유 버튼을 누르고 홈 화면에 추가를 선택합니다.

## Git push 방법

자동 commit/push는 하지 않습니다. 확인 후 직접 실행하세요.

```powershell
git status
git add index.html manifest.webmanifest sw.js icons Diary_formyWife/tools PWA_SETUP.md
git commit -m "Add PWA support"
git push
```

## 주의사항

- PWA는 보안이나 로그인 기능이 아닙니다.
- 공개 URL로 배포하면 `data/` 폴더의 일기 본문과 사진도 직접 접근할 수 있습니다.
- service worker 캐시 때문에 수정 후 바로 반영되지 않으면 DevTools > Application > Service Workers에서 Update/Unregister를 사용하거나 Clear storage를 실행하세요.
- `inbox`, `obsidian`, `backups`, `tools` 폴더는 service worker가 공개 리소스로 캐시하지 않도록 제외했습니다.

## 일기 추가 후 배포 흐름

```powershell
.\sync_diary.ps1
py -3 -m http.server 8000
git status
git add obsidian data inbox
git commit -m "Update diary data"
git push
```
