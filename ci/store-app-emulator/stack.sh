#!/usr/bin/env bash
# 웹 실습 팩으로 상점 서버(PostgreSQL, Medusa)를 켜고 끈다. testhub 관리자가 하는 일을 팩의 스크립트로 직접 한다.
# 쓰는 법: bash stack.sh install | start [결함 번호,...] | stop
# 필요한 환경 변수: WEB_PACK(풀어 둔 웹 팩, PostgreSQL 패키지를 넣은 것), STACK_DIR(데이터와 로그를 둘 폴더)
# 서버는 이 스크립트가 끝난 뒤에도 남는다 (백그라운드로 두고, 출력은 STACK_DIR/logs로 보낸다)
set -euo pipefail

PG_PORT="${PG_PORT:-55432}"
MEDUSA_PORT="${MEDUSA_PORT:-9000}"
# 이 값은 src/testhub/playground/components.py의 FIXED_PUBLISHABLE_KEY와 같다
FIXED_KEY="pk_00000000testhub0000000000000000000000000000000000000000000000000"

_medusa_env() {
  export HOME="$STACK_DIR/home" USERPROFILE="$STACK_DIR/home" XDG_CONFIG_HOME="$STACK_DIR/xdg"
  export DATABASE_URL="postgres://postgres:postgres@localhost:$PG_PORT/medusa"
  export STORE_CORS="http://localhost:8000" ADMIN_CORS="http://localhost:$MEDUSA_PORT"
  export AUTH_CORS="http://localhost:$MEDUSA_PORT,http://localhost:8000"
  export JWT_SECRET=ci-jwt COOKIE_SECRET=ci-cookie PORT="$MEDUSA_PORT" NODE_ENV=production
}

stack_install() {
  mkdir -p "$STACK_DIR/home" "$STACK_DIR/xdg" "$STACK_DIR/logs"
  node "$WEB_PACK/bin/db.mjs" init "$STACK_DIR/pg"
  # PostgreSQL은 표준 입력이 닫히면 꺼진다 (--until-stdin-closes). 입력을 열어 둔 채 백그라운드로 둔다
  { sleep 100000 2>/dev/null | node "$WEB_PACK/bin/db.mjs" start "$STACK_DIR/pg" "$PG_PORT" --until-stdin-closes \
    >"$STACK_DIR/logs/postgres.log" 2>&1; } >/dev/null 2>&1 &
  for _ in $(seq 1 60); do grep -q "PG READY" "$STACK_DIR/logs/postgres.log" && break; sleep 1; done
  grep -q "PG READY" "$STACK_DIR/logs/postgres.log"
  node "$WEB_PACK/bin/db.mjs" create "$PG_PORT" medusa
  (
    _medusa_env
    node "$WEB_PACK/bin/medusa.mjs" db:migrate >"$STACK_DIR/logs/migrate.log" 2>&1
  )
  node "$WEB_PACK/bin/db.mjs" reader "$PG_PORT" ci-reader
  # 시드가 만든 무작위 키를 앱에 들어 있는 고정 키로 바꾼다 (스냅숏 전에)
  KEY="$(node "$WEB_PACK/bin/db.mjs" publishable-key "$PG_PORT" "$FIXED_KEY" | tail -1)"
  [ "$KEY" = "$FIXED_KEY" ] || { echo "키가 고정되지 않았다: $KEY"; return 1; }
  node "$WEB_PACK/bin/db.mjs" snapshot "$PG_PORT"
}

stack_start() {
  # $1: 켤 결함 번호 (쉼표로 구분, 없으면 결함 없음)
  stack_stop_medusa
  (
    _medusa_env
    if [ -n "${1:-}" ]; then export TESTHUB_FAULTS="$1"; fi
    cd "$WEB_PACK"
    nohup node "$WEB_PACK/bin/medusa.mjs" start >"$STACK_DIR/logs/medusa-${1:-none}.log" 2>&1 &
    echo $! >"$STACK_DIR/medusa.pid"
  )
  for _ in $(seq 1 120); do
    curl -fsS "http://localhost:$MEDUSA_PORT/health" >/dev/null 2>&1 && return 0
    sleep 1
  done
  echo "Medusa가 켜지지 않았다"; tail -30 "$STACK_DIR/logs/medusa-${1:-none}.log"; return 1
}

stack_stop_medusa() {
  if [ -f "$STACK_DIR/medusa.pid" ]; then
    kill "$(cat "$STACK_DIR/medusa.pid")" 2>/dev/null || true
    for _ in $(seq 1 30); do
      curl -fsS "http://localhost:$MEDUSA_PORT/health" >/dev/null 2>&1 || break
      sleep 1
    done
    rm -f "$STACK_DIR/medusa.pid"
  fi
}

stack_stop() {
  stack_stop_medusa
  node "$WEB_PACK/bin/db.mjs" stop "$STACK_DIR/pg" >/dev/null 2>&1 || true
}

case "${1:-}" in
  install) stack_install ;;
  start) stack_start "${2:-}" ;;
  stop) stack_stop ;;
  *) echo "사용법: stack.sh install | start [결함] | stop"; exit 2 ;;
esac
