# Appium 팩

testhub 실습 환경의 안드로이드 묶음이 받는 팩입니다. Appium 서버(3.9.1)와 uiautomator2 드라이버(8.7.3)를 묶었습니다. 웹 팩(`../`)과 같이 운영체제와 상관없이 하나이고, 공개 저장소(daedalus-testhub-packs)의 Releases에 `pack-appium-v<판>` 태그로 둡니다.

## 만들기와 시험

```bash
cd playground-pack/appium
npm test         # 만든 팩이 있어야 돈다. 없으면 건너뛴다
node build.mjs   # out/testhub-appium-pack-<판>.tar.gz 와 .sha256
node build.mjs && npm test
```

Node 20.19 이상(22.12, 24)과 네트워크(npm)가 필요합니다.

## 팩의 모양

```text
manifest.json         {"pack": "appium", "version", "platform": "any", "appium", "uiautomator2"}
LICENSES.md           들어 있는 패키지와 라이선스
node_modules/appium   Appium 서버. 실행은 node node_modules/appium/index.js --address 127.0.0.1 --port 4723
appium-home/          APPIUM_HOME. uiautomator2 드라이버가 설치되어 있다
```

## 플랫폼 공통으로 만드는 방법

- Appium의 선택 의존성 `sharp`(이미지 처리 네이티브 모듈)는 뺍니다. 운영체제마다 다른 실행 파일이라 하나로 묶을 수 없고, Appium은 이미지 비교 같은 기능을 쓸 때만 불러서 없어도 서버가 켜지고 테스트가 돕니다. 그 기능을 쓰면 `Cannot load the 'sharp' module needed for images processing`로 알려 줍니다
- 빌드가 `.node` 파일과 운영체제, CPU를 가리는 패키지를 찾으면 실패합니다 (`nativeViolations`)
- `appium driver install`이 만드는 심볼릭 링크(만든 컴퓨터의 절대 경로)는 지웁니다. 안전한 압축 풀기가 절대 경로 링크를 거절합니다. 링크가 없어도 `appium-home`이 팩 안에 있어 드라이버가 위쪽 폴더의 `node_modules/appium`을 찾습니다
- `appium-home/node_modules/.cache`(설치한 컴퓨터의 절대 경로가 든 목록)도 지웁니다. Appium이 첫 실행 때 풀린 위치로 다시 만듭니다
- 라이선스가 `MIT or GPL-2.0`처럼 둘 중 고르는 표기(`unorm`)는 쓸 수 있는 쪽을 고르면 되므로 통과합니다 (`../lib/checks.mjs`의 `forbidden`)
