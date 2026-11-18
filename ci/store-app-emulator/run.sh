#!/usr/bin/env bash
# 에뮬레이터가 켜진 뒤 android-emulator-runner가 부른다 (store-app-emulator-check 워크플로).
# 웹 팩으로 상점 서버를 켜고, adb reverse로 에뮬레이터에서 닿게 하고, 상점 앱을 깔아 Appium 테스트를 돌린다.
# 한 번은 결함 없이(통과해야 한다), 한 번은 F01을 켜고(실패해야 한다) 돌린다.
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
adb reverse --list | tee "$OUT/adb-reverse.txt"

echo "== 앱을 깐다"
adb install -r "$APK" 2>&1 | tee "$OUT/adb-install.txt"
adb shell pm list packages com.testhub.shop | tee "$OUT/package.txt"

echo "== Appium을 켠다"
export APPIUM_HOME="$APPIUM_PACK/appium-home"
node "$APPIUM_PACK/node_modules/appium/index.js" --address 127.0.0.1 --port 4723 >"$OUT/appium.log" 2>&1 &
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

# 다른 이유(요소를 못 찾음 등)로 실패한 것을 결함이 드러난 것으로 세지 않도록, 수량 비교에서 실패했는지 본다
if grep -q "앱 화면의 수량이 2가 아니다: 1 " "$OUT/pytest-f01.log"; then SHOWN="예"; else SHOWN="아니오"; fi
{
  echo "결함 없음: 종료 코드 $CLEAN (0이어야 한다)"
  echo "F01 켬:    종료 코드 $FAULTY (0이 아니어야 한다), 앱 화면의 수량이 1로 드러났는가: $SHOWN"
} | tee "$OUT/result.txt"
if [ "$CLEAN" -ne 0 ] || [ "$FAULTY" -eq 0 ] || [ "$SHOWN" != "예" ]; then exit 1; fi
