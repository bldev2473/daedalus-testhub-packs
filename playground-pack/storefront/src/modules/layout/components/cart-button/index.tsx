import { retrieveCart } from "@lib/data/cart"
import { faultOn } from "@lib/faults"
import CartDropdown from "../cart-dropdown"

export default async function CartButton() {
  const cart = await retrieveCart().catch(() => null)

  // testhub 결함 F06: 머리글의 장바구니 개수가 수량 합이 아니라 상품 종류 수다
  return <CartDropdown cart={cart} countLines={faultOn("F06")} />
}
