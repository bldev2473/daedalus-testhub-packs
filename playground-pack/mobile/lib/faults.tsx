import { sdk } from "@/lib/sdk"
import React, { createContext, ReactNode, useContext, useEffect, useState } from "react"

// testhub 실습 환경: 앱 화면에서 낼 결함 번호(F03, F06, F07)를 시작할 때 Medusa에서 읽는다 (/store/testhub/app-config).
// 앱은 환경 변수를 읽을 수 없어서 Medusa가 켜진 결함을 알려 준다. 이 주소가 없는 Medusa에 붙이면 목록이 비어 결함이 없다.
const FaultsContext = createContext<ReadonlySet<string>>(new Set())

export function FaultsProvider({ children }: { children: ReactNode }) {
  const [faults, setFaults] = useState<ReadonlySet<string>>(new Set())

  useEffect(() => {
    sdk.client
      .fetch<{ faults?: string[] }>("/store/testhub/app-config")
      .then((r) => setFaults(new Set(r.faults ?? [])))
      .catch(() => setFaults(new Set()))
  }, [])

  return <FaultsContext.Provider value={faults}>{children}</FaultsContext.Provider>
}

export function useFaults(): ReadonlySet<string> {
  return useContext(FaultsContext)
}
