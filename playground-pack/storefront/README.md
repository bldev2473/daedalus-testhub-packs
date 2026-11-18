# 실습 상점

웹 실습 팩의 상점입니다. [medusajs/dtc-starter](https://github.com/medusajs/dtc-starter)(MIT)의 커밋 `1fc1edd6c91f4992b89750b6d5cd39bc9baed503` `apps/storefront`를 가져와 고쳤습니다. 원문 라이선스는 [LICENSE.dtc-starter](LICENSE.dtc-starter)입니다.

## 실행

팩 안에서는 `node storefront/server.js`로 실행합니다(Next.js 스탠드얼론 빌드).

| 환경 변수 | 설명 |
| --- | --- |
| `PORT`, `HOSTNAME` | 수신 대기(바인딩)할 포트와 호스트 이름. 호스트 이름은 `localhost`로 설정합니다(Medusa CORS). |
| `MEDUSA_BACKEND_URL` | Medusa 서버 주소. 런타임에 읽으므로 포트를 변경해도 다시 빌드할 필요가 없습니다. |
| `MEDUSA_PUBLISHABLE_KEY` | `bin/db.mjs publishable-key`로 조회한 publishable key입니다. |
| `DEFAULT_REGION` | 기본 국가 코드(`dk`)입니다. |
| `NEXT_TELEMETRY_DISABLED=1` | Next.js 사용 통계(텔레메트리) 수집을 비활성화합니다. |

- 프로세스 이름: Next.js는 실행 후 프로세스 이름을 `next-server (v15.5.21)`로 변경합니다. 명령줄의 `server.js` 문자열로는 검색되지 않으므로 PID로 프로세스를 관리합니다.
- 상품 이미지는 초기 시드(seed) 설정대로 Medusa의 S3 주소를 가리킵니다. 인터넷에 연결되지 않은 환경에서는 이미지가 표시되지 않습니다.

## 업스트림(Upstream)에서 반영한 커밋 (`1fc1edd` 이후 `dtc-starter` 커밋)

| 커밋 | 내용 |
| --- | --- |
| `1d897a2` | 옵션을 고르기 전 장바구니 담기 버튼에 `"Out of stock"` 대신 `"Select variant"`가 표시되도록 수정 |
| `9b93e68` | 배송 방법이 없는 주문의 상세 페이지에서 오류가 발생하던 문제 수정 |
| `8d414f2` | 상품, 분류, 컬렉션 페이지의 정적 페이지 사전 생성(`generateStaticParams`) 제거. 빌드에 Medusa 서버가 필요 없어지고, 관리자 화면의 변경 사항과 초기화 결과가 즉시 반영됨 |

## testhub에서 수정한 사항

코드에는 `testhub 실습 환경:` 주석을 남겼습니다.

- **런타임에 주소와 키 주입**: `src/lib/config.ts`, `src/middleware.ts`가 빌드 타임 환경 변수인 `NEXT_PUBLIC_*` 대신 위 런타임 환경 변수를 읽습니다. `NEXT_PUBLIC_*`는 빌드 시 코드에 하드코딩되어 포트를 변경할 수 없기 때문입니다. 빌드 시점의 환경 변수 검사(`check-env-variables.js`)도 제거했습니다.
- **브라우저의 Medusa 직접 호출 제거**: 상품 목록의 옵션 선택기(`options-picker`)가 브라우저에서 Medusa API를 직접 호출하던 구조를 서버 액션 `src/lib/data/product-options.ts`로 이전했습니다. 이를 통해 브라우저 번들(클라이언트 번들)에 Medusa 주소가 포함되지 않으며, Medusa CORS 설정도 상점 주소 하나만 허용하면 됩니다.
- **장바구니 담은 후 상단 헤더(머리글) 수량 즉시 갱신**: 빠른 속도로 클릭하는 브라우저 자동화 테스트에서 담기 요청이 완료된 후에도 상단 헤더가 `Cart (0)`으로 유지되는 현상이 10~20% 빈도로 발생했습니다. 서버는 새 장바구니를 정상 응답했으나, Next.js 15 클라이언트 라우터가 화면을 갱신하지 않는 문제였습니다. 이를 해결하기 위해 담기 완료 시 `src/lib/util/cart-events.ts`로 이벤트를 발행하고, 상단 헤더(`cart-dropdown`)가 서버 액션으로 장바구니를 직접 다시 조회하도록 수정했습니다. 수정 후 40회 연속 시도에서 모두 즉시 갱신됨을 확인했습니다.
  - 동시에 `retrieveCart`의 캐시 정책을 `force-cache`에서 `no-store`로 변경했습니다. 쿠키가 없는 상태에서 캐시 태그 없이 캐시되어 재조회 시 이전 값이 반환되는 문제를 막기 위함입니다.
  - 효과가 없어 되돌린 시도: 장바구니 액션마다 `revalidatePath` 호출, 옵션 선택 시 `router.replace` 대신 `history.replaceState` 사용, 상단 헤더의 `Suspense` 제거.
- **스탠드얼론(standalone) 빌드**: `next.config.js`에 `output: "standalone"`, `outputFileTracingRoot: __dirname`(상위 폴더의 lockfile을 루트로 잡지 않도록 설정)을 적용했습니다.
- **sharp 제외**: `outputFileTracingExcludes`로 `sharp`와 `@img/*` 패키지를 스탠드얼론 빌드에서 제외했습니다. 이미지 최적화를 사용하지 않으며(`images.unoptimized`), 함께 포함되는 `libvips`가 `LGPL-3.0` 라이선스여서 실습 팩의 라이선스 정책에 맞지 않기 때문입니다.
- `package.json`: `lint` 스크립트 제거(모노레포 루트의 ESLint 설정에 의존함), 모노레포 루트의 `@types/react` 버전 고정을 `overrides`로 이동. npm 설치용 `package-lock.json`을 포함합니다.
