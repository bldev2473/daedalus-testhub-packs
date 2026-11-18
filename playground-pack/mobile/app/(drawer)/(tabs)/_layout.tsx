import { useCart } from "@/context/cart-context"
import { useColorScheme } from "@/hooks/use-color-scheme"
import { Tabs } from "expo-router"
import React from "react"

import { HapticTab } from "@/components/haptic-tab"
import { IconSymbol } from "@/components/ui/icon-symbol"
import { Colors } from "@/constants/theme"

export default function TabLayout() {
  const colorScheme = useColorScheme()
  const { cart } = useCart()

  // 하단 탭의 장바구니 배지는 담은 수량의 합이다 (웹 상점의 결함 없는 머리글과 같다. 줄 수가 아니다)
  const itemCount = cart?.items?.reduce((sum, item) => sum + item.quantity, 0) || 0

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
