# 실습 상점 앱 (Medusa, React Native, Expo)

testhub의 웹 실습 환경(Medusa 2.18.0)에 붙는 모바일 상점 앱입니다. 지역 선택, 상품 목록과 상세, 장바구니, 결제(배송지, 배송 방법, 결제 수단), 주문 확인이 있습니다. 안드로이드 실습(Appium)의 테스트 대상으로 쓰려고 만들었습니다.

## 출처와 라이선스

- 앱 코드는 Medusa 공식 안내서 [Implement Mobile App with React Native, Expo, and Medusa](https://docs.medusajs.com/resources/storefront-development/guides/react-native-expo)의 코드입니다. 안내서 원문은 `medusajs/medusa` 저장소의 `www/apps/resources/app/storefront-development/guides/react-native-expo/page.mdx`이고, 그 저장소는 `ENTERPRISE-LICENSE.md`에 적은 경로를 빼면 MIT입니다 (`www/`는 그 경로에 없습니다). 받은 날은 2026-11-17입니다
- 공식 예제 저장소(`medusajs/examples`의 `react-native-expo`)는 LICENSE가 없어서 쓰지 않았습니다
- 안내서는 조각(`// TODO`를 채우는 방식)으로 되어 있어, 조각을 순서대로 합쳐 파일을 만들었습니다. 합친 뒤 고친 것은 아래 "바꾼 것"에 있습니다
- 바탕은 `create-expo-app`의 기본 템플릿(Expo SDK 54)입니다. 안내서의 2단계가 이것을 쓰고, `hooks/`, `components/haptic-tab.tsx`, `components/ui/icon-symbol*` 등이 템플릿 파일입니다
- 고지: [NOTICE.md](NOTICE.md)

## 바꾼 것

- Appium이 요소를 찾도록 `testID`를 달았습니다 (아래 "Appium이 찾는 이름"). 안드로이드에서 `testID`는 `resource-id`가 됩니다
- `lib/sdk.ts`의 기본 publishable key를 testhub 실습 환경의 고정 키로 했습니다 (`src/testhub/playground/components.py`의 `FIXED_PUBLISHABLE_KEY`와 같아야 하고, 테스트가 확인합니다). 다른 Medusa에 붙일 때는 `EXPO_PUBLIC_MEDUSA_PUBLISHABLE_API_KEY`로 바꿉니다
- `app.json`에 안드로이드 패키지 이름(`com.testhub.shop`)을 정했습니다

- `@medusajs/js-sdk`, `@medusajs/types`를 `2.18.0`으로 고정했습니다 (안내서는 버전을 적지 않고, 예제 저장소는 `preview`입니다)
- `.env.template`을 더했습니다

## 확인한 것

2026-11-17, 실습 팩 0.3.0(Medusa 2.18.0)에서 Expo 웹 빌드(`npx expo export -p web`)를 브라우저(Chromium)로 돌렸습니다.

- 타입 검사(`npx tsc --noEmit`) 통과
- 지역 7개, 상품 4개(시드 가격 그대로), 상품 상세(옵션 색상, 크기, 수량), 담기, 장바구니(`M / Black` 2개 €20.00), 결제 3단계(배송 옵션 `Standard Shipping`, `Express Shipping`, 결제 수단 `Manual Payment`), 주문 확인(주문 번호, 항목, 주소, 합계 €30.00)까지 끝까지 됩니다. 브라우저 콘솔 오류와 API 오류(4xx, 5xx)가 없었습니다
- 결함을 켜면 앱에도 증상이 나옵니다. F01은 수량 2로 담아도 장바구니에 1개가 보이고, F02는 XL을 담으면 "Failed to add product to cart"(API 500)가 뜹니다

확인하지 못한 것: 안드로이드 기기나 에뮬레이터에서 실제로 돌려 보지 않았습니다 (클라우드 세션에 가상화와 안드로이드 도구가 없습니다). 네이티브 쪽(AsyncStorage 3.x, 선택 상자, 하단 탭)은 웹과 다를 수 있습니다.

## Appium이 찾는 이름

| 화면 | `testID` |
| --- | --- |
| 하단 탭 | `tab-home`, `tab-cart` |
| 상품 카드 | `product-card-<상품 handle>` (예: `product-card-t-shirt`) |
| 상품 상세 | `option-<옵션 이름>-<값>` (예: `option-Size-M`), `quantity-decrease`, `quantity-increase`, `quantity-value`, `add-to-cart-button` |
| 장바구니 | `cart-empty`, `cart-subtotal`, `cart-total`, `cart-checkout-button` |
| 장바구니 줄 | `cart-item-<상품 handle>-<옵션>`, 그 안의 `cart-item-price-…`, `cart-item-quantity-…`, `cart-item-increase-…`, `cart-item-decrease-…`, `cart-item-remove-…` (옵션 예: `M / Black`) |

## 돌리기

```bash
cp .env.template .env      # 실습 환경에 붙일 때는 키를 넣지 않아도 된다 (고정 키가 기본값)
npm ci
npx expo start             # testhub가 켠 에뮬레이터에서는 adb reverse로 localhost:9000이 Medusa에 닿는다 (직접 켠 에뮬레이터는 adb reverse tcp:9000 tcp:9000)
```

웹으로 볼 때는 Medusa의 `STORE_CORS`, `AUTH_CORS`에 Expo 주소(`http://localhost:8081`)가 있어야 합니다. 실습 팩은 웹 상점 주소만 허용하므로, 브라우저로 직접 열려면 상점 자리(8000)에 웹 빌드를 올려야 합니다. 네이티브 앱은 CORS와 상관이 없습니다.

## 남은 것

- 안드로이드 에뮬레이터에서 돌려 보기 (로드맵 D가 먼저입니다)
- Appium이 화면 요소를 찾을 수 있게 `testID` 달기
- publishable key를 앱을 빌드할 때가 아니라 실행할 때 넘기는 방법
- APK 빌드와 공개 팩 저장소에 올리기
