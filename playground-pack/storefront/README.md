# 실습 상점

웹 실습 팩의 상점입니다. [medusajs/dtc-starter](https://github.com/medusajs/dtc-starter)(MIT)의 커밋 `1fc1edd6c91f4992b89750b6d5cd39bc9baed503` `apps/storefront`를 가져와 고쳤습니다. 원문 라이선스는 [LICENSE.dtc-starter](LICENSE.dtc-starter)입니다.

## 실행

팩 안에서는 `node storefront/server.js`로 띄웁니다 (Next.js standalone).

| 환경 변수 | 뜻 |
| --- | --- |
| `PORT`, `HOSTNAME` | 들을 포트와 이름. 이름은 `localhost`로 둡니다 (Medusa CORS) |
| `MEDUSA_BACKEND_URL` | Medusa 주소. 실행 중에 읽으므로 포트를 바꿔도 다시 빌드하지 않습니다 |
| `MEDUSA_PUBLISHABLE_KEY` | `bin/db.mjs publishable-key`로 읽은 키 |
| `DEFAULT_REGION` | 기본 국가 코드 (`dk`) |
| `NEXT_TELEMETRY_DISABLED=1` | Next.js 사용 통계를 끕니다 |

- 프로세스 이름: Next.js는 뜨고 나면 프로세스 이름을 `next-server (v15.5.21)`로 바꿉니다. 명령줄의 `server.js`로 찾으면 못 찾습니다. PID로 관리합니다
- 상품 이미지는 시드대로 Medusa의 S3 주소를 가리킵니다. 인터넷에 연결되지 않으면 보이지 않습니다

## 상류에서 가져온 것 (1fc1edd 뒤의 dtc-starter 커밋)

| 커밋 | 내용 |
| --- | --- |
| `1d897a2` | 옵션을 고르기 전 담기 버튼에 "Out of stock"이 뜨던 것을 "Select variant"로 |
| `9b93e68` | 배송 방법이 없는 주문의 상세 페이지가 죽던 것 |
| `8d414f2` | 상품, 분류, 컬렉션 페이지의 미리 그리기(`generateStaticParams`) 제거. 빌드에 Medusa가 필요 없어지고, 관리자 화면에서 바꾼 상품과 초기화가 바로 보입니다 |

## testhub가 고친 것

코드에는 `testhub 실습 환경:` 주석을 달았습니다.

- **주소와 키를 실행 중에 받기**: `src/lib/config.ts`, `src/middleware.ts`가 `NEXT_PUBLIC_*` 대신 위 환경 변수를 읽습니다. `NEXT_PUBLIC_*`는 빌드할 때 코드에 박혀 포트를 바꿀 수 없습니다. 빌드 때의 환경 변수 검사(`check-env-variables.js`)는 뺐습니다
- **브라우저가 Medusa를 직접 부르지 않기**: 상품 목록의 옵션 선택기(`options-picker`)가 브라우저에서 Medusa를 부르던 것을 서버 액션 `src/lib/data/product-options.ts`로 옮겼습니다. 그래서 브라우저 묶음에 Medusa 주소가 박히지 않고, Medusa CORS도 상점 주소 하나만 허용하면 됩니다
- **담은 뒤 머리글 장바구니 수**: 빠르게 누르는 화면 자동화에서 담기가 끝나도 머리글이 `Cart (0)`으로 남는 일이 10~20% 있었습니다. 서버는 새 장바구니를 읽어 응답했지만, 그 응답이 화면에 반영되지 않았습니다 (Next.js 15 클라이언트 라우터). 그래서 담기가 끝나면 `src/lib/util/cart-events.ts`로 알리고, 머리글(`cart-dropdown`)이 서버 액션으로 장바구니를 직접 다시 읽습니다. 고친 뒤 40번 시도에서 모두 바로 바뀌었습니다
  - 함께 `retrieveCart`의 `force-cache`를 `no-store`로 바꿨습니다. 쿠키가 없을 때 태그 없이 캐시돼 다시 읽어도 옛 값이 나올 수 있습니다
  - 효과가 없어 되돌린 것: 장바구니 액션마다 `revalidatePath`, 옵션 선택 때 `router.replace` 대신 `history.replaceState`, 머리글의 `Suspense` 제거
- **standalone 빌드**: `next.config.js`에 `output: "standalone"`, `outputFileTracingRoot: __dirname`(위 폴더의 lockfile을 루트로 잡지 않게)
- **sharp 빼기**: `outputFileTracingExcludes`로 `sharp`와 `@img/*`를 standalone에서 뺍니다. 이미지 최적화를 쓰지 않고(`images.unoptimized`), 같이 들어오는 libvips가 LGPL-3.0이라 팩의 라이선스 원칙에 맞지 않습니다
- `package.json`: `lint` 스크립트 제거(모노레포의 eslint 설정에 기댐), 모노레포 루트의 `@types/react` 고정을 `overrides`로 옮김. npm으로 설치하는 `package-lock.json`을 둡니다
