import Medusa from "@medusajs/js-sdk"
import AsyncStorage from "@react-native-async-storage/async-storage"
import Constants from "expo-constants"

const MEDUSA_BACKEND_URL =
  Constants.expoConfig?.extra?.EXPO_PUBLIC_MEDUSA_URL ||
  process.env.EXPO_PUBLIC_MEDUSA_URL ||
  "http://localhost:9000"

// testhub 실습 환경이 모든 설치에서 쓰는 고정 publishable key (src/testhub/playground/components.py의
// FIXED_PUBLISHABLE_KEY와 같아야 한다). 다른 Medusa에 붙일 때는 EXPO_PUBLIC_MEDUSA_PUBLISHABLE_API_KEY로 바꾼다
const TESTHUB_PUBLISHABLE_API_KEY =
  "pk_00000000testhub0000000000000000000000000000000000000000000000000"

const MEDUSA_PUBLISHABLE_API_KEY =
  Constants.expoConfig?.extra?.EXPO_PUBLIC_MEDUSA_PUBLISHABLE_API_KEY ||
  process.env.EXPO_PUBLIC_MEDUSA_PUBLISHABLE_API_KEY ||
  TESTHUB_PUBLISHABLE_API_KEY

export const sdk = new Medusa({
  baseUrl: MEDUSA_BACKEND_URL,
  debug: __DEV__,
  auth: {
    type: "jwt",
    jwtTokenStorageMethod: "custom",
    storage: AsyncStorage,
  },
  publishableKey: MEDUSA_PUBLISHABLE_API_KEY,
})
