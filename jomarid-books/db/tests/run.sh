#!/usr/bin/env bash
# SQL testy oznámení na skutečném PostgreSQL: db/push-notifications.sql proti zjednodušenému schématu Supabase (mock_schema.sql).
#   bash db/tests/run.sh        (nebo: npm run test:sql)
# Potřebuje PostgreSQL 14+ (initdb, pg_ctl, psql v PATH nebo v /usr/lib/postgresql/*/bin). Vytvoří dočasný cluster mimo síť (jen unix socket),
# po doběhnutí ho smaže. Při spuštění jako root používá uživatele postgres. Návratový kód 0 = vše prošlo, 77 = PostgreSQL není k dispozici.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SQL="$HERE/../push-notifications.sql"

BIN=""
for d in $(command -v initdb >/dev/null 2>&1 && dirname "$(command -v initdb)") /usr/lib/postgresql/*/bin; do
  [ -x "$d/initdb" ] && [ -x "$d/pg_ctl" ] && [ -x "$d/psql" ] && BIN="$d" && break
done
if [ -z "$BIN" ]; then echo "PostgreSQL (initdb, pg_ctl, psql) nenalezen: SQL testy se přeskakují." >&2; exit 77; fi

TMP="$(mktemp -d)"
RUNAS=""
if [ "$(id -u)" = "0" ]; then
  id postgres >/dev/null 2>&1 || { echo "Jako root je potřeba uživatel postgres." >&2; rm -rf "$TMP"; exit 77; }
  chown postgres "$TMP"; chmod 755 "$HERE" "$HERE"/*.sql "$SQL" 2>/dev/null || true
  RUNAS="runuser -u postgres --"
fi
run() { $RUNAS "$@"; }
cleanup() { run "$BIN/pg_ctl" -D "$TMP/data" -m immediate stop >/dev/null 2>&1; rm -rf "$TMP"; }
trap cleanup EXIT

run "$BIN/initdb" -D "$TMP/data" -U postgres -A trust -E UTF8 --no-locale >/dev/null || { echo "initdb selhal" >&2; exit 1; }
run "$BIN/pg_ctl" -D "$TMP/data" -w -o "-c listen_addresses= -c unix_socket_directories=$TMP -c fsync=off" -l "$TMP/pg.log" start >/dev/null || { cat "$TMP/pg.log" >&2; exit 1; }
PSQL() { run "$BIN/psql" -h "$TMP" -U postgres -q -X -v ON_ERROR_STOP=1 "$@"; }
PSQLQ() { PSQL -o /dev/null "$@"; }   # bez výpisu výsledků dotazů, zůstanou jen hlášení (NOTICE) testů

# pg_net (HTTP volání) a pg_cron v čistém PostgreSQL nejsou: nahrazuje je mock_schema.sql, řádek s rozšířením se vynechá
sed '/create extension if not exists pg_net/d' "$SQL" > "$TMP/push.sql"
chmod 644 "$TMP/push.sql"
OUT="$TMP/out.txt"
{
  PSQLQ -f "$HERE/mock_schema.sql" &&
  PSQLQ -f "$TMP/push.sql" &&
  PSQLQ -f "$TMP/push.sql" &&   # podruhé: SQL musí jít spustit víckrát
  PSQLQ -f "$HERE/push_logic.test.sql" &&
  PSQLQ -f "$HERE/push_rpc.test.sql"
} >"$OUT" 2>&1
STATUS=$?

# Souběh dvou průchodů plánovače: druhý nesmí nic poslat, dokud první drží zámek (a po uvolnění zase funguje).
# Bez časování na slepo: držící spojení potvrdí získání zámku souborem "locked" a drží ho, dokud nedostane "release".
if [ $STATUS -eq 0 ]; then
  PSQLQ -c "truncate public.push_engage_log, net.calls restart identity;" || STATUS=1
  cat > "$TMP/hold.sql" <<HOLD
begin;
select pg_advisory_xact_lock(hashtext('push_engagement_tick'));
\\! touch "$TMP/locked"
\\! i=0; while [ ! -f "$TMP/release" ] && [ \$i -lt 300 ]; do sleep 0.1; i=\$((i+1)); done
commit;
HOLD
  chmod 644 "$TMP/hold.sql"
  PSQLQ -f "$TMP/hold.sql" >/dev/null 2>&1 &
  HOLD=$!
  for _ in $(seq 1 100); do [ -f "$TMP/locked" ] && break; sleep 0.1; done
  if [ ! -f "$TMP/locked" ]; then
    echo "SELÁHALO: souběh plánovače (držící spojení nezískalo zámek)" >>"$OUT"; STATUS=1; touch "$TMP/release"
  else
    BLOCKED=$(PSQL -At -c "select public.push_engagement_tick('2026-10-09 12:05:00+02')" 2>&1)
    LOGGED_WHILE_LOCKED=$(PSQL -At -c "select count(*) from public.push_engage_log" 2>&1)
    touch "$TMP/release"
  fi
  wait $HOLD
  if [ -f "$TMP/locked" ]; then
    FREE=$(PSQL -At -c "select public.push_engagement_tick('2026-10-09 12:05:00+02')" 2>&1)
    if [ "$BLOCKED" = "0" ] && [ "$LOGGED_WHILE_LOCKED" = "0" ] && [ "${FREE:-0}" -gt 0 ] 2>/dev/null; then
      echo "NOTICE:  OK   souběh plánovače: při drženém zámku nic neodešle a nic nezapíše, po uvolnění zase funguje (odesláno $FREE)" >>"$OUT"
    else
      echo "SELÁHALO: souběh plánovače (zamčený průchod vrátil '$BLOCKED', v deníku $LOGGED_WHILE_LOCKED, po uvolnění '$FREE')" >>"$OUT"; STATUS=1
    fi
  fi
fi

OK=$(grep -c "OK   " "$OUT")
FAILS=$(grep -E "SELÁHALO|ERROR" "$OUT")
if [ $STATUS -ne 0 ] || [ -n "$FAILS" ]; then
  echo "SQL testy: SELHALY (prošlo $OK kontrol)" >&2
  grep -vE "NOTICE:  (OK   |pg_cron|.*(already exists|does not exist), skipping|drop cascades)" "$OUT" | tail -30 >&2
  exit 1
fi
echo "SQL testy: $OK kontrol prošlo"
exit 0
