"""에뮬레이터의 상점 앱에서 상품을 담고, 장바구니 화면, 상점 API, DB가 같은지 본다.

testhub 없이 Appium-Python-Client와 psycopg만 쓴다. 학습자가 하게 될 일과 같다:
앱에서 수량 2로 담고, 앱 화면의 수량을 서버(API, DB)가 아는 수량과 맞춰 본다.
- 결함이 없으면 셋 다 2다
- F01(담기 수량 무시)을 켜면 앱 화면의 수량이 1이라 `앱 화면의 수량` 단계에서 실패한다 (CI가 실패를 기대한다)
"""

import json
import os
import time
import urllib.request

import psycopg
import pytest
from appium import webdriver
from appium.options.android import UiAutomator2Options
from appium.webdriver.common.appiumby import AppiumBy
from selenium.common.exceptions import NoSuchElementException, TimeoutException
from selenium.webdriver.support.ui import WebDriverWait

APP = "com.testhub.shop"
APPIUM_URL = os.environ.get("APPIUM_URL", "http://127.0.0.1:4723")
DEVICE_UDID = os.environ.get("DEVICE_UDID", "emulator-5554")
SHOTS = os.environ.get("SHOTS", "shots")
MEDUSA_URL = f"http://localhost:{os.environ.get('MEDUSA_PORT', '9000')}"
PG_PORT = int(os.environ.get("PG_PORT", "55432"))
KEY = os.environ["FIXED_KEY"]
TIMEOUT_S = 30
FIRST_SCREEN_TIMEOUT_S = 90  # 앱을 처음 띄울 때는 번들을 읽고 서버에서 상품을 받는다


def by_id(test_id):
    return (AppiumBy.ANDROID_UIAUTOMATOR, f'new UiSelector().resourceId("{test_id}")')


def by_id_pattern(pattern):
    return (AppiumBy.ANDROID_UIAUTOMATOR, f'new UiSelector().resourceIdMatches("{pattern}")')


def by_text(text):
    return (AppiumBy.ANDROID_UIAUTOMATOR, f'new UiSelector().text("{text}")')


@pytest.fixture
def driver():
    options = UiAutomator2Options()
    options.udid = DEVICE_UDID
    options.app_package = APP
    options.app_activity = ".MainActivity"
    options.no_reset = True
    options.auto_grant_permissions = True
    options.new_command_timeout = 180
    d = webdriver.Remote(APPIUM_URL, options=options)
    os.makedirs(SHOTS, exist_ok=True)
    # 이전 테스트가 남긴 장바구니와 지역 선택(AsyncStorage)을 지우고 앱을 다시 띄운다 (testhub 템플릿의 픽스처와 같다)
    d.execute_script("mobile: clearApp", {"appId": APP})
    d.activate_app(APP)
    yield d
    d.quit()


def dump(driver, name):
    """무엇이 보였는지 남긴다: 화면, 요소 트리, 지금 앱"""
    driver.get_screenshot_as_file(os.path.join(SHOTS, f"{name}.png"))
    with open(os.path.join(SHOTS, f"{name}.xml"), "w", encoding="utf-8") as f:
        f.write(driver.page_source)
    with open(os.path.join(SHOTS, f"{name}.txt"), "w", encoding="utf-8") as f:
        f.write(f"package={driver.current_package}\nactivity={driver.current_activity}\n")


def settle(driver):
    """부팅 직후의 느린 에뮬레이터를 달랜다: 응답 없음 대화 상자는 "Wait"로 닫고, 앱이 앞에 없으면 다시 띄운다"""
    for _ in range(4):
        waits = driver.find_elements(*by_text("Wait"))
        if waits:
            waits[0].click()
        if driver.current_package != APP:
            driver.activate_app(APP)
        if driver.find_elements(*by_id_pattern("product-card-.*")):
            return


def wait_for(driver, locator, name, timeout=TIMEOUT_S):
    try:
        return WebDriverWait(driver, timeout).until(lambda d: d.find_element(*locator))
    except TimeoutException:
        dump(driver, f"9-not-found-{name}")
        raise


def scroll_to(driver, test_id):
    """화면 아래에 있는 요소로 내려가서 찾는다. 안드로이드는 화면 밖 요소를 요소 트리에 넣지 않는다.
    세로 ScrollView만 쓴다 (상품 이미지 슬라이더는 가로 HorizontalScrollView다)"""
    selector = (
        'new UiScrollable(new UiSelector().className("android.widget.ScrollView"))'
        f'.setMaxSearchSwipes(10).scrollIntoView(new UiSelector().resourceId("{test_id}"))'
    )
    try:
        driver.find_element(AppiumBy.ANDROID_UIAUTOMATOR, selector)
    except NoSuchElementException:
        dump(driver, f"9-not-found-{test_id}")
        raise
    # 내려간 직후에는 화면이 아직 미끄러지고 있어 찾은 요소의 좌표로 누르면 빗나간다. 멈춘 뒤 다시 찾아 쓴다
    time.sleep(1.5)
    return driver.find_element(*by_id(test_id))


def api(path):
    request = urllib.request.Request(f"{MEDUSA_URL}{path}", headers={"x-publishable-api-key": KEY})
    with urllib.request.urlopen(request, timeout=30) as r:
        return json.load(r)


def latest_cart_id():
    with psycopg.connect(host="localhost", port=PG_PORT, user="postgres", password="postgres", dbname="medusa") as c:
        row = c.execute("select id from cart order by created_at desc limit 1").fetchone()
    return row[0] if row else None


def db_quantity(cart_id):
    with psycopg.connect(host="localhost", port=PG_PORT, user="postgres", password="postgres", dbname="medusa") as c:
        rows = c.execute(
            "select quantity from cart_line_item where cart_id = %s and deleted_at is null", (cart_id,)
        ).fetchall()
    return [r[0] for r in rows]


def test_app_reaches_the_store(driver):
    """앱이 고정 키로 localhost:9000(adb reverse)의 상점에 붙어 상품 카드를 그린다"""
    dump(driver, "0-after-session")
    settle(driver)
    wait_for(driver, by_id("product-card-t-shirt"), "product-card", FIRST_SCREEN_TIMEOUT_S)
    dump(driver, "1-home")


def test_add_two_items_and_compare_app_api_and_db(driver):
    settle(driver)
    wait_for(driver, by_id("product-card-t-shirt"), "product-card", FIRST_SCREEN_TIMEOUT_S).click()

    scroll_to(driver, "quantity-increase").click()
    assert driver.find_element(*by_id("quantity-value")).text == "2"
    dump(driver, "2-detail-quantity-2")

    scroll_to(driver, "add-to-cart-button").click()
    wait_for(driver, by_text("Product added to cart!"), "toast")

    driver.find_element(*by_id("tab-cart")).click()
    wait_for(driver, by_id("cart-subtotal"), "cart-subtotal")
    quantity = wait_for(driver, by_id_pattern("cart-item-quantity-.*"), "cart-item-quantity").text
    dump(driver, "3-cart")

    # 서버가 아는 수량: 앱이 만든 가장 최근 장바구니
    cart_id = latest_cart_id()
    assert cart_id, "앱이 장바구니를 만들지 않았다"
    items = api(f"/store/carts/{cart_id}?fields=*items")["cart"]["items"]
    api_quantity = [i["quantity"] for i in items]
    db_quantities = db_quantity(cart_id)
    print("앱 화면:", quantity, "API:", api_quantity, "DB:", db_quantities)

    assert quantity == "2", f"앱 화면의 수량이 2가 아니다: {quantity} (API {api_quantity}, DB {db_quantities})"
    assert api_quantity == [2]
    assert db_quantities == [2]
    # 하단 탭의 장바구니 배지는 줄 수(1)가 아니라 담은 수량의 합(2)이다
    badge = driver.find_element(
        AppiumBy.ANDROID_UIAUTOMATOR,
        'new UiSelector().resourceId("tab-cart").childSelector(new UiSelector().text("2"))',
    )
    assert badge.text == "2"


def test_cart_total_matches_api(driver):
    """앱 장바구니 화면의 소계가 API의 item_subtotal(소수 둘째 자리)과 같다"""
    settle(driver)
    wait_for(driver, by_id("product-card-t-shirt"), "product-card", FIRST_SCREEN_TIMEOUT_S).click()
    scroll_to(driver, "add-to-cart-button").click()
    wait_for(driver, by_text("Product added to cart!"), "toast")
    driver.find_element(*by_id("tab-cart")).click()
    shown = wait_for(driver, by_id("cart-subtotal"), "cart-subtotal").text
    cart = api(f"/store/carts/{latest_cart_id()}?fields=item_subtotal,currency_code")["cart"]
    digits = "".join(ch for ch in shown if ch.isdigit() or ch == ".")
    assert float(digits) == pytest.approx(float(cart["item_subtotal"]), abs=0.01), (shown, cart)


def test_failure_capture_calls_work_on_a_real_device(driver):
    """testhub가 Appium 테스트의 실패 때 남기는 것(화면, 요소 트리, 실패 시점의 앱)을 실제 기기에서 읽을 수 있다.

    testhub/fixtures/appium.py의 save_failure가 부르는 것과 같은 Appium 호출이다
    """
    settle(driver)
    wait_for(driver, by_id("product-card-t-shirt"), "product-card", FIRST_SCREEN_TIMEOUT_S)
    png = driver.get_screenshot_as_png()
    tree = driver.page_source
    assert png[:8] == b"\x89PNG\r\n\x1a\n" and len(png) > 10_000
    assert "<hierarchy" in tree and "product-card-t-shirt" in tree
    assert driver.current_package == APP and driver.current_activity
    dump(driver, "capture")


ADDED = "Product added to cart!"
FAILED = "Failed to add product to cart"


def toast_after_add(driver, size):
    """상품 상세에서 옵션 크기를 고르고 담은 뒤 나온 안내 문구"""
    settle(driver)
    wait_for(driver, by_id("product-card-t-shirt"), "product-card", FIRST_SCREEN_TIMEOUT_S).click()
    scroll_to(driver, f"option-Size-{size}").click()
    scroll_to(driver, "add-to-cart-button").click()
    shown = WebDriverWait(driver, TIMEOUT_S).until(
        lambda d: next(
            (t for t in (ADDED, FAILED) if d.find_elements(AppiumBy.ANDROID_UIAUTOMATOR, f'new UiSelector().text("{t}")')),
            None,
        )
    )
    dump(driver, f"toast-{size}")
    return shown


def test_xl_option_can_be_added(driver):
    """XL을 담을 수 있다. F02(특정 옵션 담기 실패)를 켜면 앱에 담기 실패 안내가 뜬다"""
    shown = toast_after_add(driver, "XL")
    assert shown == ADDED, f"XL을 담지 못했다: 앱 안내 {shown!r}"


def test_added_item_is_stored_on_the_server(driver):
    """담은 항목이 서버에 남는다. F04(저장되지 않는 담기)를 켜면 앱은 담았다고 하지만 서버에는 없다"""
    shown = toast_after_add(driver, "S")
    assert shown == ADDED
    cart_id = latest_cart_id()
    api_items = api(f"/store/carts/{cart_id}?fields=*items")["cart"]["items"]
    db_items = db_quantity(cart_id)
    assert len(api_items) == 1 and db_items == [1], f"서버에 담긴 항목이 없다: API {len(api_items)}개, DB {db_items}"
