import { useCart } from "@/context/cart-context"
import { useFaults } from "@/lib/faults"
import { useColorScheme } from "@/hooks/use-color-scheme"
import { Tabs } from "expo-router"
import React from "react"

import { HapticTab } from "@/components/haptic-tab"
import { IconSymbol } from "@/components/ui/icon-symbol"
import { Colors } from "@/constants/theme"

export default function TabLayout() {
  const colorScheme = useColorScheme()
  const { cart } = useCart()
  const faults = useFaults()

  // 하단 탭의 장바구니 배지는 담은 수량의 합이다 (웹 상점의 결함 없는 머리글과 같다. 줄 수가 아니다)
  // testhub 결함 F06: 배지가 수량의 합이 아니라 상품 줄 수로 보인다
  const itemCount = faults.has("F06")
    ? cart?.items?.length || 0
    : cart?.items?.reduce((sum, item) => sum + item.quantity, 0) || 0

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme ?? "light"].tint,
        headerShown: true,
        tabBarButton: HapticTab,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="(home)"
        options={{
          title: "Medusa Store",
          tabBarButtonTestID: "tab-home",
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="house.fill" color={color} />,
          headerShown: false, // Let the home stack manage its own headers
        }}
      />
      <Tabs.Screen
        name="(cart)"
        options={{
          title: "Cart",
          tabBarButtonTestID: "tab-cart",
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="cart.fill" color={color} />,
          tabBarBadge: itemCount > 0 ? itemCount : undefined,
          tabBarBadgeStyle: {
            backgroundColor: Colors[colorScheme ?? "light"].tint,
          },
          headerShown: false, // Let the cart stack manage its own headers
        }}
      />
    </Tabs>
  )
}
