# Allure 팩

testhub가 실행 결과의 보고서를 만들 때 받는 팩입니다. Allure 3 CLI(`allure` 3.33.0)와 그 의존성을 묶었습니다. 웹 팩(`../`), Appium 팩(`../appium`)과 같이 운영체제와 상관없이 하나입니다.

실행 화면의 **Allure 보고서**를 처음 누를 때 받아 앱의 실습 환경 폴더에 풉니다. 보고서는 `allure generate`가 파일 하나짜리 HTML(`index.html`)로 만들고, 서버 없이 브라우저로 열립니다.

## 만들기와 시험

```bash
cd playground-pack/allure
npm test         # 만든 팩이 있어야 돈다. 없으면 건너뛴다
node build.mjs   # out/testhub-allure-pack-<판>.tar.gz 와 .sha256
node build.mjs && npm test
```

Node 22.18 이상과 네트워크(npm)가 필요합니다. Allure 3이 Node 22.18 이상을 요구합니다.

## 팩의 모양

```text
manifest.json         {"pack": "allure", "version", "platform": "any", "allure"}
LICENSES.md           들어 있는 패키지와 라이선스
node_modules/allure   Allure 3 CLI. 실행은 node node_modules/allure/cli.js generate <결과 폴더> --config <설정 파일>
```

## 검사

- 빌드가 `.node` 파일과 운영체제, CPU를 가리는 패키지를 찾으면 실패합니다 (`nativeViolations`). 2026-11-18 기준 3.33.0에는 없었습니다
- 심볼릭 링크와 `.bin` 폴더는 지웁니다 (안전한 압축 풀기가 절대 경로 링크를 거절하고, Windows에서도 문제가 됩니다)
- 라이선스는 `../lib/checks.mjs`로 검사합니다. 2026-11-18 기준 158개 패키지가 통과했습니다
- 시험은 만든 팩을 다른 폴더에 풀어 결과 두 개(통과, 실패)로 보고서를 만들고, 요약이 맞는지 봅니다

## 크기

2026-11-18, Linux에서 만든 값입니다. 팩은 13.1MB(풀면 44MB)이고 패키지가 158개입니다. 결과 8개의 보고서는 약 2.1MB의 파일 하나입니다.
