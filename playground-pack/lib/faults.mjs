// 실습 상점에 심어 둔 결함 목록 (docs/superpowers/specs/2026-11-17-playground-faults-design.md 4절).
// 번호는 바뀌지 않는다. 강사의 시나리오 파일이 번호로 가리킨다. 팩의 manifest.json 에 번호 목록이 들어간다.
// 결함 코드: backend/src/api/middlewares.ts (Medusa), storefront/src/lib/faults.ts 를 부르는 곳 (상점)
export const FAULTS = [
  { id: "F01", title: "담기 수량 무시", where: "medusa" },
  { id: "F02", title: "특정 옵션(XL) 담기 실패", where: "medusa" },
  { id: "F03", title: "화면의 합계 계산 오류", where: "storefront" },
  { id: "F04", title: "저장되지 않는 담기", where: "medusa" },
  { id: "F05", title: "상품 목록 지연", where: "medusa" },
  { id: "F06", title: "장바구니 개수 표시가 상품 종류 수", where: "storefront" },
  { id: "F07", title: "가격 정렬 오류", where: "storefront" },
  { id: "F08", title: "수량을 0으로 바꿔도 남음", where: "medusa" },
]

// 함께 켜면 한쪽을 찾을 수 없는 결함. F04 는 담은 상품을 지워, 담은 뒤의 화면이나 수량을 보는 결함을 가린다.
// manifest.json 의 fault_conflicts 로 들어가고, 관리 프로세스가 시나리오를 검사할 때 쓴다
export const FAULT_CONFLICTS = { F04: ["F03", "F06", "F08"] }
