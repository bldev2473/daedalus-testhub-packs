// testhub 실습 환경: 강사가 켜는 결함 (docs/superpowers/specs/2026-11-17-playground-faults-design.md).
// TESTHUB_FAULTS=F03,F06 처럼 켤 결함 번호를 실행할 때 받는다. 서버 쪽 코드에서만 부른다
// (브라우저 쪽 부품에는 서버 부품이 결과만 넘긴다).
export function faultOn(id: string): boolean {
  return (process.env.TESTHUB_FAULTS ?? "")
    .split(",")
    .map((s) => s.trim())
    .includes(id)
}
