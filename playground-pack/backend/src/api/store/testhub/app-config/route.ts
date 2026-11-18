// testhub 실습 환경: 상점 앱(모바일)이 시작할 때 읽는, 앱 화면에서 낼 결함 번호.
// 웹 상점의 결함 F03, F06, F07은 상점 서버가 TESTHUB_FAULTS를 읽어 내지만, 앱은 환경 변수를 읽을 수 없다.
// 그래서 Medusa가 켜진 결함 중 앱 화면에도 있는 것만 알려 준다 (강사의 시나리오 하나로 웹과 앱의 결함이 함께 켜진다).
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

// 앱 화면에도 있는 결함: F03 합계 계산 오류, F06 장바구니 개수 표시, F07 가격 정렬 오류
const APP_FAULTS = ["F03", "F06", "F07"]

export async function GET(_req: MedusaRequest, res: MedusaResponse) {
  const on = new Set(
    (process.env.TESTHUB_FAULTS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  )
  res.json({ faults: APP_FAULTS.filter((id) => on.has(id)) })
}
