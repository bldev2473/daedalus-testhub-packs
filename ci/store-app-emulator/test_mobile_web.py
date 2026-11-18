"""에뮬레이터의 Chrome으로 웹 상점을 열어 Appium으로 조작한다 (모바일 웹).

웹 상점에만 있는 결함(F03 합계 계산, F06 머리글 개수, F07 가격 정렬)을 화면 크기가 작은 휴대폰 Chrome에서 찾는다.
에뮬레이터의 localhost:8000은 adb reverse로 컴퓨터의 웹 상점에 이어진다.
요소는 웹 선택자(data-testid)로 찾는다. 웹 화면(CHROMIUM 컨텍스트)은 Appium이 받은 chromedriver로 조작한다.
"""

import os

import pytest
from appium import webdriver
from appium.options.android import UiAutomator2Options
from selenium.common.exceptions import StaleElementReferenceException, TimeoutException
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as ec
from selenium.webdriver.support.ui import WebDriverWait

APPIUM_URL = os.environ.get("APPIUM_URL", "http://127.0.0.1:4723")
DEVICE_UDID = os.environ.get("DEVICE_UDID", "emulator-5554")
SHOTS = os.environ.get("SHOTS", "shots")
STORE = f"http://localhost:{os.environ.get('STORE_PORT', '8000')}"
TIMEOUT_S = 60


def by_testid(name):
    return (By.CSS_SELECTOR, f"[data-testid='{name}']")


def option(text):
    return (By.XPATH, f"//*[@data-testid='option-button'][normalize-space()='{text}']")


@pytest.fixture
def chrome():
    options = UiAutomator2Options()
    options.udid = DEVICE_UDID
    options.browser_name = "Chrome"
    options.auto_grant_permissions = True
    options.new_command_timeout = 180
    # 휴대폰 Chrome의 첫 실행 화면을 건너뛴다. chromedriver는 Appium 서버가 Chrome 판에 맞게 받는다
    options.set_capability("appium:chromedriverAutodownload", True)
    options.set_capability("appium:chromeOptions", {"args": ["--no-first-run", "--disable-fre", "--no-default-browser-check"]})
    d = webdriver.Remote(APPIUM_URL, options=options)
    os.makedirs(SHOTS, exist_ok=True)
    yield d
    d.quit()


def dump(driver, name):
    driver.get_screenshot_as_file(os.path.join(SHOTS, f"{name}.png"))
    with open(os.path.join(SHOTS, f"{name}.html"), "w", encoding="utf-8") as f:
        f.write(driver.page_source)


def click(wait, locator):
    def press(driver):
        try:
            element = driver.find_element(*locator)
            if not (element.is_displayed() and element.is_enabled()):
                return False
            element.click()
            return True
        except StaleElementReferenceException:
            return False
        except Exception:
            return False

    wait.until(press)


def add(driver, wait, product, options, count):
    driver.get(f"{STORE}/dk/products/{product}")
    wait.until(ec.presence_of_element_located(by_testid("add-product-button")))
    for text in options:
        click(wait, option(text))
    wait.until(ec.text_to_be_present_in_element(by_testid("add-product-button"), "Add to cart"))
    click(wait, by_testid("add-product-button"))
    shows = ec.text_to_be_present_in_element(by_testid("nav-cart-link"), f"({count})")
    try:
        WebDriverWait(driver, 10).until(shows)
    except TimeoutException:
        driver.refresh()
        wait.until(shows)


def test_store_lists_four_products_on_a_phone(chrome):
    wait = WebDriverWait(chrome, TIMEOUT_S)
    chrome.get(STORE + "/dk/store")
    try:
        wait.until(ec.presence_of_element_located(by_testid("product-wrapper")))
    except TimeoutException:
        dump(chrome, "9-store")
        raise
    dump(chrome, "1-store")
    assert len(chrome.find_elements(*by_testid("product-wrapper"))) == 4


def test_cart_count_and_subtotal_on_a_phone(chrome):
    """티셔츠 2개와 반바지 1개를 담으면 머리글은 3, 소계는 35다 (F06은 머리글이 2, F03은 소계가 25로 보인다)"""
    wait = WebDriverWait(chrome, TIMEOUT_S)
    add(chrome, wait, "t-shirt", ["Black", "M"], 1)
    add(chrome, wait, "t-shirt", ["Black", "M"], 2)
    # 개수 표시 결함(F06)은 여기서 머리글이 3이 되지 못하고 2로 남아 시간 초과로 드러난다
    try:
        add(chrome, wait, "shorts", ["M"], 3)
    except TimeoutException:
        dump(chrome, "9-count")
        raise AssertionError(f"머리글의 장바구니 개수가 3이 아니다: {chrome.find_element(*by_testid('nav-cart-link')).text!r}")
    chrome.get(f"{STORE}/dk/cart")
    subtotal = wait.until(ec.presence_of_element_located(by_testid("cart-subtotal")))
    dump(chrome, "3-cart")
    value = float(subtotal.get_attribute("data-value"))
    assert value == 35, f"소계가 35가 아니다: {value}"


def test_price_sort_is_ascending_on_a_phone(chrome):
    """낮은 가격순으로 정렬하면 가격이 오름차순이다 (F07은 가장 싼 상품이 맨 뒤에 온다)"""
    wait = WebDriverWait(chrome, TIMEOUT_S)
    chrome.get(STORE + "/dk/store?sortBy=price_asc")
    wait.until(ec.presence_of_element_located(by_testid("price")))
    texts = [e.get_attribute("textContent") for e in chrome.find_elements(*by_testid("price"))]
    prices = [float(t.strip().lstrip("€").replace(",", "")) for t in texts]
    dump(chrome, "4-sort")
    assert prices == sorted(prices), f"가격 정렬이 오름차순이 아니다: {prices}"
