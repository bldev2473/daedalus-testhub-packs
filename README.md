# testhub 실습 팩

[testhub](https://github.com/bldev2473/daedalus-testhub)의 실습 환경이 내려받는 팩을 만들고 [Releases](../../releases)에 두는 저장소입니다.

testhub 앱의 **실습 환경** 화면에서 받기를 누르면 앱이 팩을 알아서 받습니다. 직접 받을 필요는 없습니다.

## 팩

| 팩 | 태그 | 파일 |
| --- | --- | --- |
| 웹 (쇼핑몰) | `pack-web-v<판>` | `testhub-web-pack-<판>.tar.gz`, `.sha256` |

- 팩은 운영체제와 상관없이 하나입니다. macOS(Apple 실리콘, Intel)와 Windows x64가 같은 팩을 받습니다
- 웹 팩에는 Medusa 2.18.0 서버와 관리자 화면, 상점(Next.js)이 들어 있습니다. PostgreSQL 실행 파일은 팩에 없고, 학습자 컴퓨터에서 그 운영체제의 것을 넣습니다 (데스크톱 앱에 들어 있고, 앱 밖에서는 npm에서 받아 sha512 무결성 값을 확인합니다)
- 앱은 `.sha256`의 체크섬이 맞을 때만 팩을 풉니다
- 비밀 값과 관리자 계정은 팩에 없고, 학습자 컴퓨터에서 처음 받을 때 만듭니다

## 만드는 곳

`playground-pack/`은 testhub 저장소의 같은 폴더를 옮겨 온 것입니다. `main`에 올라오면 [pack 워크플로](.github/workflows/pack.yml)가 Linux에서 팩을 만들고 시험한 뒤, 그 판의 릴리스가 아직 없으면 릴리스를 만들어 올립니다. 만드는 법과 시험은 [playground-pack/README.md](playground-pack/README.md)에 있습니다.

## 라이선스

이 저장소의 코드는 Apache-2.0([LICENSE](LICENSE))입니다. 상점과 백엔드 스타터는 MIT(`playground-pack/*/LICENSE.dtc-starter`)입니다. 팩에 든 제3자 소프트웨어와 npm 패키지의 라이선스는 팩 안의 `LICENSES.md`에 있습니다.
