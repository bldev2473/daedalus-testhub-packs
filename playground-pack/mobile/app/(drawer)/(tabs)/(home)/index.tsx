import { Loading } from "@/components/loading"
import { ProductCard } from "@/components/product-card"
import { Colors } from "@/constants/theme"
import { useRegion } from "@/context/region-context"
import { useColorScheme } from "@/hooks/use-color-scheme"
import { useFaults } from "@/lib/faults"
import { sdk } from "@/lib/sdk"
import type { HttpTypes } from "@medusajs/types"
import { Image } from "expo-image"
import React, { useCallback, useEffect, useMemo, useState } from "react"
import { FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from "react-native"

export default function HomeScreen() {
  const colorScheme = useColorScheme()
  const colors = Colors[colorScheme ?? "light"]
  const { selectedRegion } = useRegion()
  const faults = useFaults()
  const [sortAsc, setSortAsc] = useState(false)
  
  const [products, setProducts] = useState<HttpTypes.StoreProduct[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchProducts = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      
      const { products: fetchedProducts } = await sdk.store.product.list({
        region_id: selectedRegion?.id,
        fields: "*variants.calculated_price,+variants.inventory_quantity",
      })
      
      setProducts(fetchedProducts)
    } catch (err) {
      console.error("Failed to fetch products:", err)
      setError("Failed to load products. Please try again.")
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [selectedRegion])

  useEffect(() => {
    if (selectedRegion) {
      fetchProducts()
    }
  }, [selectedRegion, fetchProducts])

  const onRefresh = () => {
    setRefreshing(true)
    fetchProducts()
  }

  const shown = useMemo(() => {
    if (!sortAsc) return products
    // 상품 카드가 보여 주는 값(첫 variant의 가격)으로 낮은 가격순으로 정렬한다
    const price = (p: HttpTypes.StoreProduct) => p.variants?.[0]?.calculated_price?.calculated_amount ?? Infinity
    const sorted = [...products].sort((a, b) => price(a) - price(b))
    // testhub 결함 F07: 낮은 가격순으로 정렬하면 가장 싼 상품이 맨 뒤에 온다
    return faults.has("F07") && sorted.length > 1 ? [...sorted.slice(1), sorted[0]] : sorted
  }, [products, sortAsc, faults])

  if (loading) {
    return <Loading message="Loading products..." />
  }

  if (error) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: colors.background }]}>
        <Text style={[styles.errorText, { color: colors.text }]}>{error}</Text>
      </View>
    )
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={shown}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={styles.row}
        initialNumToRender={6}
        maxToRenderPerBatch={6}
        windowSize={5}
        removeClippedSubviews={true}
        ListHeaderComponent={
          <View style={styles.header}>
            <Image
              source={{ uri: "https://images.unsplash.com/photo-1600185365483-26d7a4cc7519?w=800" }}
              style={[styles.banner, { backgroundColor: colors.imagePlaceholder }]}
              contentFit="cover"
            />
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Latest Products
            </Text>
            <TouchableOpacity
              testID="sort-price-asc"
              onPress={() => setSortAsc((v) => !v)}
              style={[styles.sortButton, { borderColor: colors.icon }]}
            >
              <Text style={{ color: colors.text }}>{sortAsc ? "Sorted: price low to high" : "Sort: price low to high"}</Text>
            </TouchableOpacity>
          </View>
        }
        renderItem={({ item }) => <ProductCard product={item} />}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.tint}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={[styles.emptyText, { color: colors.text }]}>
              No products available
            </Text>
          </View>
        }
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  header: {
    width: "100%",
  },
  banner: {
    width: "100%",
    height: 200,
  },
  sortButton: {
    alignSelf: "flex-start",
    marginHorizontal: 16,
    marginBottom: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 8,
  },
  sectionTitle: {
    fontSize: 24,
    fontWeight: "700",
    marginTop: 24,
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  listContent: {
    paddingBottom: 20,
  },
  row: {
    justifyContent: "space-between",
    paddingHorizontal: 8,
  },
  errorText: {
    fontSize: 16,
    textAlign: "center",
  },
  emptyContainer: {
    padding: 40,
    alignItems: "center",
  },
  emptyText: {
    fontSize: 16,
  },
})
