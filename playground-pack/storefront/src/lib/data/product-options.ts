"use server"

import { sdk } from "@lib/config"
import { HttpTypes } from "@medusajs/types"

// testhub 실습 환경: options-picker 가 브라우저에서 부르던 것을 서버 액션으로 옮겼다.
// Medusa 주소와 publishable key 를 서버만 알면 되고, 브라우저 묶음에 주소가 박히지 않는다
export async function listProductOptions(): Promise<
  HttpTypes.StoreProductOption[]
> {
  const response = await sdk.client.fetch<{
    product_options?: HttpTypes.StoreProductOption[]
  }>("/store/product-options", {
    method: "GET",
    query: {
      is_exclusive: false,
      fields: "*values",
    },
    cache: "no-store",
  })

  return response?.product_options ?? []
}
