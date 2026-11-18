#!/usr/bin/env bash
# 에뮬레이터가 켜진 뒤 android-emulator-runner가 부른다 (appium-emulator-check 워크플로).
# 풀어 둔 Appium 팩(APPIUM_PACK)으로 Appium을 켜고 설정 앱 테스트를 돌린다.
set -euo pipefail

PACK="${APPIUM_PACK:?APPIUM_PACK에 풀어 둔 Appium 팩 폴더를 준다}"
OUT="${OUT:-out}"
mkdir -p "$OUT"

adb devices -l | tee "$OUT/adb-devices.txt"
# 느린 CI 에뮬레이터를 달랜다: 애니메이션을 끄고, 부팅 직후의 시스템이 가라앉기를 기다리고, 열린 대화 상자를 닫는다
adb shell settings put global window_animation_scale 0
adb shell settings put global transition_animation_scale 0
adb shell settings put global animator_duration_scale 0
adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS >/dev/null || true
sleep 45
adb shell getprop ro.build.version.release | tee "$OUT/android-version.txt"

export APPIUM_HOME="$PACK/appium-home"
node "$PACK/node_modules/appium/index.js" --address 127.0.0.1 --port 4723 >"$OUT/appium.log" 2>&1 &
APPIUM_PID=$!
trap 'kill $APPIUM_PID 2>/dev/null || true' EXIT

for _ in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:4723/status >"$OUT/status.json" 2>/dev/null; then break; fi
  sleep 1
done
cat "$OUT/status.json"

# 이전에 실패해도 로그와 화면이 남도록 실패를 기록하고 끝까지 간다
set +e
SHOTS="$OUT/shots" python -m pytest -v ci/appium-emulator/test_settings_smoke.py 2>&1 | tee "$OUT/pytest.log"
RESULT=${PIPESTATUS[0]}
adb exec-out screencap -p >"$OUT/emulator-screen.png" 2>/dev/null
echo "$RESULT" >"$OUT/pytest-exit-code.txt"
exit "$RESULT"
