"""공개한 Appium 팩이 실제 안드로이드 에뮬레이터에서 세션을 만들고 설정 앱을 조작하는지 본다.

testhub 없이 Appium-Python-Client만 쓴다. 학습자용 템플릿의 설정 앱 테스트와 같은 일을 한다
(Network & internet을 열고 Internet 항목을 찾는다). 화면(스크린샷)은 실행 결과로 남긴다.
"""

import os

import pytest
from appium import webdriver
from appium.options.android import UiAutomator2Options
from appium.webdriver.common.appiumby import AppiumBy
from selenium.common.exceptions import TimeoutException
from selenium.webdriver.support.ui import WebDriverWait

APPIUM_URL = os.environ.get("APPIUM_URL", "http://127.0.0.1:4723")
SHOTS = os.environ.get("SHOTS", "shots")
TIMEOUT_S = 60


def by_text(text):
    return (AppiumBy.ANDROID_UIAUTOMATOR, f'new UiSelector().text("{text}")')


@pytest.fixture
def driver():
    options = UiAutomator2Options()
    options.udid = os.environ.get("DEVICE_UDID", "emulator-5554")
    options.app_package = "com.android.settings"
    options.app_activity = ".Settings"
    options.no_reset = True
    options.new_command_timeout = 120
    d = webdriver.Remote(APPIUM_URL, options=options)
    os.makedirs(SHOTS, exist_ok=True)
    yield d
    d.quit()


def dump(driver, name):
    """실패했을 때 무엇이 보였는지 남긴다: 화면, 요소 트리, 지금 앱"""
    driver.get_screenshot_as_file(os.path.join(SHOTS, f"{name}.png"))
    with open(os.path.join(SHOTS, f"{name}.xml"), "w", encoding="utf-8") as f:
        f.write(driver.page_source)
    with open(os.path.join(SHOTS, f"{name}.txt"), "w", encoding="utf-8") as f:
        f.write(f"package={driver.current_package}\nactivity={driver.current_activity}\n")


def settle(driver, package="com.android.settings"):
    """부팅 직후의 느린 에뮬레이터를 달랜다: ANR 대화 상자(응답 없음)는 "Wait"로 닫고, 설정 앱이 앞에 없으면 다시 띄운다"""
    for _ in range(6):
        waits = driver.find_elements(*by_text("Wait"))
        if waits:
            waits[0].click()
        if driver.current_package != package:
            driver.activate_app(package)
        if driver.find_elements(*by_text("Network & internet")):
            return


def test_open_network_and_internet(driver):
    wait = WebDriverWait(driver, TIMEOUT_S)
    dump(driver, "0-after-session")
    settle(driver)
    dump(driver, "0-after-settle")
    try:
        wait.until(lambda d: d.find_element(*by_text("Network & internet")))
    except TimeoutException:
        dump(driver, "9-not-found")
        raise
    driver.get_screenshot_as_file(os.path.join(SHOTS, "1-settings.png"))
    driver.find_element(*by_text("Network & internet")).click()
    wait.until(lambda d: d.find_element(*by_text("Internet")))
    driver.get_screenshot_as_file(os.path.join(SHOTS, "2-network.png"))


def test_session_is_android(driver):
    caps = driver.capabilities
    assert caps["platformName"].lower() == "android"
    # 판은 api-level 입력에 따라 다르다. 확인하는 사람이 볼 수 있게 남긴다
    print("platformVersion:", caps.get("platformVersion"), "deviceName:", caps.get("deviceName"))
