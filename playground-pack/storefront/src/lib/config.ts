import { getLocaleHeader } from "@lib/util/get-locale-header"
import Medusa, { FetchArgs, FetchInput } from "@medusajs/js-sdk"

// testhub 실습 환경: Medusa 주소와 키를 빌드에 박지 않고 실행 중에 환경 변수에서 읽는다.
// NEXT_PUBLIC_* 는 빌드할 때 코드에 박혀 포트를 바꿀 수 없다. 이 sdk 는 서버 쪽에서만 쓴다
// (브라우저에서 부르던 options-picker 는 서버 액션 lib/data/product-options.ts 로 옮겼다)
const MEDUSA_BACKEND_URL =
  process.env["MEDUSA_BACKEND_URL"] || "http://localhost:9000"

export const sdk = new Medusa({
  baseUrl: MEDUSA_BACKEND_URL,
  debug: process.env.NODE_ENV === "development",
  publishableKey: process.env["MEDUSA_PUBLISHABLE_KEY"],
})

const originalFetch = sdk.client.fetch.bind(sdk.client)

sdk.client.fetch = async <T>(
  input: FetchInput,
  init?: FetchArgs
): Promise<T> => {
  const headers = init?.headers ?? {}
  let localeHeader: Record<string, string | null> | undefined
  try {
    localeHeader = await getLocaleHeader()
    headers["x-medusa-locale"] ??= localeHeader["x-medusa-locale"]
  } catch {}

  const newHeaders = {
    ...localeHeader,
    ...headers,
  }
  init = {
    ...init,
    headers: newHeaders,
  }
  return originalFetch(input, init)
}
