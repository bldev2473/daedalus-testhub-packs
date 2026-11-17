// testhub 실습 환경: 강사가 켜는 결함 (docs/superpowers/specs/2026-11-17-playground-faults-design.md).
// TESTHUB_FAULTS=F01,F04 처럼 켤 결함 번호를 받는다. 없으면 모든 미들웨어가 바로 next()로 넘긴다.
// Medusa 원본 파일은 고치지 않고 이 확장 지점에만 둔다.
import {
  defineMiddlewares,
  type MedusaNextFunction,
  type MedusaRequest,
  type MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

const FAULTS = new Set(
  (process.env.TESTHUB_FAULTS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
)

const on = (id: string) => FAULTS.has(id)

type Body = { variant_id?: string; quantity?: number }

// Medusa는 요청 검사를 이 미들웨어보다 먼저 하고, 처리는 검사를 마친 값(validatedBody)으로 한다
const bodyOf = (req: MedusaRequest) => ((req as any).validatedBody ?? req.body) as Body

// 응답을 보내기 전에 결함을 낸다 (본문을 고치거나 DB를 바꾼다). 다 끝난 뒤에 보내야 바로 다시 조회해도 결함이 보인다
function beforeSend(res: MedusaResponse, fault: (body: any) => Promise<void>) {
  const send = res.json.bind(res)
  res.json = ((body: any) => {
    if (res.statusCode >= 400) return send(body)
    fault(body)
      .catch((e) => console.error(`testhub fault: ${e?.message ?? e}`))
      .finally(() => send(body))
    return res
  }) as typeof res.json
}

async function lineIds(req: MedusaRequest, cartId: string): Promise<Set<string>> {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity: "cart", fields: ["items.id"], filters: { id: cartId } })
  return new Set((data[0]?.items ?? []).map((i: any) => i.id))
}

// F01 담기 수량 무시: 수량을 2 이상으로 담아도 1개만 들어간다
async function f01(req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) {
  const body = bodyOf(req)
  if (on("F01") && typeof body?.quantity === "number" && body.quantity > 1) body.quantity = 1
  next()
}

// F02 특정 옵션 담기 실패: 이름이 XL로 시작하는 옵션(티셔츠 XL 등)을 담으면 500
async function f02(req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) {
  const body = bodyOf(req)
  if (!on("F02") || !body?.variant_id) return next()
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({ entity: "variant", fields: ["title"], filters: { id: body.variant_id } })
  if (String(data[0]?.title ?? "").startsWith("XL")) {
    res.status(500).json({ type: "unknown_error", message: "An unknown error occurred." })
    return
  }
  next()
}

// F04 저장되지 않는 담기: 담긴 장바구니를 돌려준 뒤 새로 담긴 항목을 지운다
async function f04(req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) {
  if (!on("F04")) return next()
  const cartId = req.params.id
  const before = await lineIds(req, cartId)
  beforeSend(res, async (body) => {
    const added = (body?.cart?.items ?? []).map((i: any) => i.id).filter((id: string) => !before.has(id))
    if (added.length) await req.scope.resolve(Modules.CART).deleteLineItems(added)
  })
  next()
}

// F08 수량 0으로 바꿔도 남음: 수량을 0으로 바꾸면 항목이 지워져야 하는데 수량 0인 채로 남는다
async function f08(req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) {
  const body = bodyOf(req)
  if (!on("F08") || body?.quantity !== 0) return next()
  const lineId = req.params.line_id
  body.quantity = 1
  beforeSend(res, async (resBody) => {
    for (const item of resBody?.cart?.items ?? []) if (item.id === lineId) item.quantity = 0
    await req.scope.resolve(Modules.CART).updateLineItems(lineId, { quantity: 0 })
  })
  next()
}

// F05 상품 목록 지연: 상품 목록 요청 다섯 번에 한 번은 3초 늦게 답한다
let productRequests = 0
async function f05(req: MedusaRequest, res: MedusaResponse, next: MedusaNextFunction) {
  if (on("F05") && ++productRequests % 5 === 0) await new Promise((r) => setTimeout(r, 3000))
  next()
}

export default defineMiddlewares({
  routes: [
    { matcher: "/store/carts/:id/line-items", method: ["POST"], middlewares: [f02, f01, f04] },
    { matcher: "/store/carts/:id/line-items/:line_id", method: ["POST"], middlewares: [f08] },
    { matcher: "/store/products", method: ["GET"], middlewares: [f05] },
  ],
})
