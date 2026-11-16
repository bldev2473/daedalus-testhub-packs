// testhub 실습 환경: 장바구니가 바뀌었음을 머리글 장바구니(cart-dropdown)에 알린다.
// Next.js 15 에서 담기 서버 액션의 응답이 가끔 화면에 반영되지 않아, 담은 뒤에도 머리글이 Cart (0) 으로
// 남았다 (빠르게 누르는 화면 자동화에서 10~20%). 라우터 갱신에 기대지 않고 머리글이 장바구니를 직접 다시 읽는다
export const CART_CHANGED_EVENT = "testhub:cart-changed"

export function notifyCartChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CART_CHANGED_EVENT))
  }
}
