#!/usr/bin/env bash
# 에뮬레이터가 켜진 뒤 android-emulator-runner가 부른다 (store-app-emulator-check 워크플로).
# 웹 팩으로 상점 서버를 켜고, adb reverse로 에뮬레이터에서 닿게 하고, 상점 앱을 깔아 Appium 테스트를 돌린다.
# 결함 없이 한 번(통과해야 한다), 결함 F01, F02, F04를 하나씩 켜고 한 번씩(각각 기대한 이유로 실패해야 한다) 돌린다.
set -euo pipefail

WEB_PACK="${WEB_PACK:?WEB_PACK에 풀어 둔 웹 팩 폴더를 준다}"
APPIUM_PACK="${APPIUM_PACK:?APPIUM_PACK에 풀어 둔 Appium 팩 폴더를 준다}"
APK="${APK:?APK에 상점 앱 APK 경로를 준다}"
OUT="${OUT:-out}"
STACK_DIR="${STACK_DIR:?STACK_DIR에 서버 데이터를 둘 폴더를 준다}"
export WEB_PACK STACK_DIR
mkdir -p "$OUT"
STACK="bash $(dirname "$0")/stack.sh"
FIXED_KEY="pk_00000000testhub0000000000000000000000000000000000000000000000000"
MEDUSA_PORT="${MEDUSA_PORT:-9000}"
PG_PORT="${PG_PORT:-55432}"
APPIUM_PID=""
trap '$STACK stop >/dev/null 2>&1 || true; kill $APPIUM_PID 2>/dev/null || true; cp -r "$STACK_DIR/logs" "$OUT/stack-logs" 2>/dev/null || true' EXIT

echo "== 상점 서버를 켠다"
$STACK install >"$OUT/stack-install.log" 2>&1 || { cat "$OUT/stack-install.log"; exit 1; }
$STACK start >>"$OUT/stack-install.log" 2>&1 || { cat "$OUT/stack-install.log"; exit 1; }
tail -5 "$OUT/stack-install.log"
curl -fsS -H "x-publishable-api-key: $FIXED_KEY" "http://localhost:$MEDUSA_PORT/store/regions" -o "$OUT/regions.json"

echo "== 에뮬레이터를 달랜다"
adb devices -l | tee "$OUT/adb-devices.txt"
adb shell settings put global window_animation_scale 0
adb shell settings put global transition_animation_scale 0
adb shell settings put global animator_duration_scale 0
adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS >/dev/null || true
sleep 45

echo "== 에뮬레이터 안의 localhost:9000을 서버에 잇는다"
adb reverse tcp:9000 "tcp:$MEDUSA_PORT"
adb reverse tcp:8000 "tcp:${STORE_PORT:-8000}"
adb reverse --list | tee "$OUT/adb-reverse.txt"

echo "== 앱을 깐다"
adb install -r "$APK" 2>&1 | tee "$OUT/adb-install.txt"
adb shell pm list packages com.testhub.shop | tee "$OUT/package.txt"

echo "== Appium을 켠다"
export APPIUM_HOME="$APPIUM_PACK/appium-home"
# 모바일 웹(휴대폰 Chrome)은 chromedriver가 필요하다. Chrome 판에 맞는 것을 Appium이 받게 한다
node "$APPIUM_PACK/node_modules/appium/index.js" --address 127.0.0.1 --port 4723 \
  --allow-insecure uiautomator2:chromedriver_autodownload >"$OUT/appium.log" 2>&1 &
APPIUM_PID=$!
for _ in $(seq 1 60); do
  curl -fsS http://127.0.0.1:4723/status >"$OUT/status.json" 2>/dev/null && break
  sleep 1
done

export PG_PORT MEDUSA_PORT FIXED_KEY
export SHOTS="$OUT/shots"
TEST=ci/store-app-emulator/test_store_app.py

# 결함이 없을 때는 통과해야 한다. 실패해도 다음 단계를 보려고 끝까지 간다
set +e
echo "== 1. 결함 없음: 통과해야 한다"
SHOTS="$OUT/shots-clean" python -m pytest -v "$TEST" 2>&1 | tee "$OUT/pytest-clean.log"
CLEAN=${PIPESTATUS[0]}

echo "== 2. F01(담기 수량 무시)을 켠다: 실패해야 한다"
set -e
$STACK start F01 >>"$OUT/stack-install.log" 2>&1 || { tail -30 "$OUT/stack-install.log"; exit 1; }
set +e
SHOTS="$OUT/shots-f01" FAULT=F01 python -m pytest -v "$TEST" -k add_two 2>&1 | tee "$OUT/pytest-f01.log"
FAULTY=${PIPESTATUS[0]}
adb exec-out screencap -p >"$OUT/emulator-screen.png" 2>/dev/null

# 결함마다: 그 결함을 켜고 해당 테스트를 돌려, 요소를 못 찾아서가 아니라 기대한 이유로 실패하는지 본다
fault_phase() { # $1 결함 번호, $2 pytest -k, $3 실패 메시지에 있어야 할 글, $4 로그 이름
  set -e
  $STACK start "$1" >>"$OUT/stack-install.log" 2>&1 || { tail -30 "$OUT/stack-install.log"; exit 1; }
  set +e
  SHOTS="$OUT/shots-$4" python -m pytest -v "$TEST" -k "$2" 2>&1 | tee "$OUT/pytest-$4.log"
  CODE=${PIPESTATUS[0]}
  if grep -q "$3" "$OUT/pytest-$4.log"; then SEEN="예"; else SEEN="아니오"; fi
}

echo "== 3. F02(특정 옵션 담기 실패)를 켠다: 실패해야 한다"
fault_phase F02 xl "XL을 담지 못했다" f02
F02_CODE=$CODE; F02_SEEN=$SEEN
echo "== 4. F04(저장되지 않는 담기)를 켠다: 실패해야 한다"
fault_phase F04 stored "서버에 담긴 항목이 없다" f04
F04_CODE=$CODE; F04_SEEN=$SEEN
echo "== 4-1. 앱 F03(화면의 합계 계산 오류)을 켠다: 실패해야 한다"
fault_phase F03 subtotal "화면의 소계가 API와 다르다" f03-app
F03A_CODE=$CODE; F03A_SEEN=$SEEN
echo "== 4-2. 앱 F06(배지 개수 표시)을 켠다: 실패해야 한다"
fault_phase F06 badge "탭 배지가 담은 수량" f06-app
F06A_CODE=$CODE; F06A_SEEN=$SEEN
echo "== 4-3. 앱 F07(가격 정렬 오류)을 켠다: 실패해야 한다"
fault_phase F07 sort "맨 앞 상품이 가장 싸지 않다" f07-app
F07A_CODE=$CODE; F07A_SEEN=$SEEN
adb exec-out screencap -p >"$OUT/emulator-screen.png" 2>/dev/null

# 모바일 웹: 휴대폰 Chrome으로 웹 상점을 연다. 웹 상점에만 있는 결함(F03, F06, F07)을 찾는다
# MOBILE_WEB_REQUIRED=0으로 두면 이 단계의 실패는 실행의 실패로 세지 않는다 (결과만 남긴다)
MW_TEST=ci/store-app-emulator/test_mobile_web.py
web_phase() { # $1 결함 번호(없으면 빈 값), $2 pytest -k, $3 실패 메시지에 있어야 할 글, $4 이름
  $STACK storefront "$1" >>"$OUT/stack-install.log" 2>&1 || { tail -30 "$OUT/stack-install.log"; CODE=99; SEEN="아니오"; return; }
  set +e
  if [ -n "$2" ]; then K=(-k "$2"); else K=(); fi
  SHOTS="$OUT/shots-$4" python -m pytest -v "$MW_TEST" "${K[@]}" 2>&1 | tee "$OUT/pytest-$4.log"
  CODE=${PIPESTATUS[0]}
  if [ -n "$3" ] && grep -q "$3" "$OUT/pytest-$4.log"; then SEEN="예"; else SEEN="아니오"; fi
}
# 앞 단계에서 켠 Medusa 결함(F04)을 끄고 다시 켠다. 웹 상점의 결함(F03, F06, F07)은 상점을 켤 때 건다
set -e
$STACK start >>"$OUT/stack-install.log" 2>&1 || { tail -30 "$OUT/stack-install.log"; exit 1; }
set +e
echo "== 5. 모바일 웹: 결함 없음 (통과해야 한다)"
web_phase "" "" "" mw-clean; MW_CLEAN=$CODE
echo "== 6. 모바일 웹: F03(합계 계산 오류)"
web_phase F03 subtotal "소계가 35가 아니다" mw-f03; MW_F03=$CODE; MW_F03_SEEN=$SEEN
echo "== 7. 모바일 웹: F06(머리글 개수)"
web_phase F06 subtotal "머리글의 장바구니 개수가" mw-f06; MW_F06=$CODE; MW_F06_SEEN=$SEEN
echo "== 8. 모바일 웹: F07(가격 정렬 오류)"
web_phase F07 sort "가격 정렬이 오름차순이 아니다" mw-f07; MW_F07=$CODE; MW_F07_SEEN=$SEEN

# 다른 이유(요소를 못 찾음 등)로 실패한 것을 결함이 드러난 것으로 세지 않도록, 수량 비교에서 실패했는지 본다
if grep -q "앱 화면의 수량이 2가 아니다: 1 " "$OUT/pytest-f01.log"; then SHOWN="예"; else SHOWN="아니오"; fi
{
  echo "결함 없음: 종료 코드 $CLEAN (0이어야 한다)"
  echo "F01 켬:    종료 코드 $FAULTY (0이 아니어야 한다), 앱 화면의 수량이 1로 드러났는가: $SHOWN"
  echo "F02 켬:    종료 코드 $F02_CODE (0이 아니어야 한다), 담기 실패 안내가 드러났는가: $F02_SEEN"
  echo "F04 켬:    종료 코드 $F04_CODE (0이 아니어야 한다), 서버에 항목이 없음이 드러났는가: $F04_SEEN"
  echo "앱 F03 켬:    종료 코드 $F03A_CODE (0이 아니어야 한다), 화면의 소계 오류가 드러났는가: $F03A_SEEN"
  echo "앱 F06 켬:    종료 코드 $F06A_CODE (0이 아니어야 한다), 배지 오류가 드러났는가: $F06A_SEEN"
  echo "앱 F07 켬:    종료 코드 $F07A_CODE (0이 아니어야 한다), 정렬 오류가 드러났는가: $F07A_SEEN"
  echo "모바일 웹 결함 없음: 종료 코드 $MW_CLEAN (0이어야 한다)"
  echo "모바일 웹 F03 켬:   종료 코드 $MW_F03 (0이 아니어야 한다), 소계 오류가 드러났는가: $MW_F03_SEEN"
  echo "모바일 웹 F06 켬:   종료 코드 $MW_F06 (0이 아니어야 한다), 개수 오류가 드러났는가: $MW_F06_SEEN"
  echo "모바일 웹 F07 켬:   종료 코드 $MW_F07 (0이 아니어야 한다), 정렬 오류가 드러났는가: $MW_F07_SEEN"
} | tee "$OUT/result.txt"
if [ "${MOBILE_WEB_REQUIRED:-1}" = "1" ] && { [ "$MW_CLEAN" -ne 0 ] || [ "$MW_F03_SEEN" != "예" ] || [ "$MW_F06_SEEN" != "예" ] || [ "$MW_F07_SEEN" != "예" ]; }; then exit 1; fi
if [ "$CLEAN" -ne 0 ] || [ "$FAULTY" -eq 0 ] || [ "$SHOWN" != "예" ] \
  || [ "$F02_CODE" -eq 0 ] || [ "$F02_SEEN" != "예" ] || [ "$F04_CODE" -eq 0 ] || [ "$F04_SEEN" != "예" ] \
  || [ "$F03A_CODE" -eq 0 ] || [ "$F03A_SEEN" != "예" ] || [ "$F06A_CODE" -eq 0 ] || [ "$F06A_SEEN" != "예" ] \
  || [ "$F07A_CODE" -eq 0 ] || [ "$F07A_SEEN" != "예" ]; then exit 1; fi
