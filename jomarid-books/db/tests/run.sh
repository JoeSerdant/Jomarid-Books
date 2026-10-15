#!/usr/bin/env bash
# SQL testy na skutečném PostgreSQL: db/push-notifications.sql (oznámení), db/email-change.sql (změna e-mailu přes správce), db/game-records.sql (herní rekordy a odznaky)
# a db/shop.sql (obchůdek)
# proti zjednodušenému schématu Supabase (mock_schema.sql).
#   bash db/tests/run.sh        (nebo: npm run test:sql)
# Potřebuje PostgreSQL 14+ (initdb, pg_ctl, psql v PATH nebo v /usr/lib/postgresql/*/bin). Vytvoří dočasný cluster mimo síť (jen unix socket),
# po doběhnutí ho smaže. Při spuštění jako root používá uživatele postgres. Návratový kód 0 = vše prošlo, 77 = PostgreSQL není k dispozici.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SQL="$HERE/../push-notifications.sql"
EMAIL_SQL="$HERE/../email-change.sql"
GAME_SQL="$HERE/../game-records.sql"
SHOP_SQL="$HERE/../shop.sql"

BIN=""
for d in $(command -v initdb >/dev/null 2>&1 && dirname "$(command -v initdb)") /usr/lib/postgresql/*/bin; do
  [ -x "$d/initdb" ] && [ -x "$d/pg_ctl" ] && [ -x "$d/psql" ] && BIN="$d" && break
done
if [ -z "$BIN" ]; then echo "PostgreSQL (initdb, pg_ctl, psql) nenalezen: SQL testy se přeskakují." >&2; exit 77; fi

TMP="$(mktemp -d)"
RUNAS=""
if [ "$(id -u)" = "0" ]; then
  id postgres >/dev/null 2>&1 || { echo "Jako root je potřeba uživatel postgres." >&2; rm -rf "$TMP"; exit 77; }
  chown postgres "$TMP"; chmod 755 "$HERE" "$HERE"/*.sql "$SQL" "$EMAIL_SQL" "$GAME_SQL" "$SHOP_SQL" 2>/dev/null || true
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
  PSQLQ -f "$EMAIL_SQL" &&
  PSQLQ -f "$EMAIL_SQL" &&      # i tenhle soubor
  PSQLQ -f "$GAME_SQL" &&
  PSQLQ -f "$GAME_SQL" &&       # i herní rekordy
  PSQLQ -f "$SHOP_SQL" &&
  PSQLQ -f "$SHOP_SQL" &&       # i obchůdek
  PSQLQ -f "$HERE/push_logic.test.sql" &&
  PSQLQ -f "$HERE/push_rpc.test.sql" &&
  PSQLQ -f "$HERE/email_change.test.sql" &&
  PSQLQ -f "$HERE/game_records.test.sql" &&
  PSQLQ -f "$HERE/shop.test.sql"
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

# Kontrola předpokladů v db/shop.sql: nesedí-li tabulka mincí (nebo chybí herní odznaky), soubor se musí zastavit hned při spuštění,
# dřív než cokoli změní, ne až při prvním nákupu. Každý případ se zkouší na rozbité kopii a zase vrací zpět.
if [ $STATUS -eq 0 ]; then
  pf() {  # pf <popis> <text hlášky> <příprava> <úklid>
    PSQLQ -c "update public.shop_items set price = 1 where item_id = 'gamefx_noir'" || STATUS=1
    PSQLQ -c "$3" || STATUS=1
    local out; out=$(PSQL -At -f "$SHOP_SQL" 2>&1); local rc=$?
    PSQLQ -c "$4" || STATUS=1
    local price; price=$(PSQL -At -c "select price from public.shop_items where item_id = 'gamefx_noir'" 2>&1)
    if [ $rc -ne 0 ] && echo "$out" | grep -q "$2" && [ "$price" = "1" ]; then
      echo "NOTICE:  OK   db/shop.sql se zastaví a nic nezmění, když $1" >>"$OUT"
    else
      echo "SELÁHALO: db/shop.sql při '$1' (kód $rc, cena po pokusu '$price'): $out" >>"$OUT"; STATUS=1
    fi
    PSQLQ -f "$SHOP_SQL" 2>/dev/null || STATUS=1   # zpátky do pořádku (cena se srovná)
  }
  pf "zápis do coin_transactions zůstatek vůbec nemění (chybí spoušť)" "zapsanou částku" \
     "alter table public.coin_transactions disable trigger trg_update_coins;" \
     "alter table public.coin_transactions enable trigger trg_update_coins;"
  pf "zápis do coin_transactions změní zůstatek o jinou částku, než se zapsala" "zapsanou částku" \
     "create or replace function public.update_user_coins_balance() returns trigger language plpgsql as \$f\$ begin update public.profiles set coins = coins + 2 * new.amount where id = new.user_id; return new; end \$f\$;" \
     "create or replace function public.update_user_coins_balance() returns trigger language plpgsql as \$f\$ begin update public.profiles set coins = coins + new.amount where id = new.user_id; return new; end \$f\$;"
  pf "tabulka coin_transactions zkušební zápis odmítne" "Zkušební zápis do coin_transactions selhal" \
     "alter table public.coin_transactions add constraint tt_no_cosmetic check (source_type not like 'cosmetic_purchase:%') not valid;" \
     "alter table public.coin_transactions drop constraint tt_no_cosmetic;"
  pf "chybí herní odznaky (game-records.sql)" "Nejdřív spusť db/game-records.sql" \
     "alter table public.game_badge_unlocks rename to tt_unlocks_away;" \
     "alter table public.tt_unlocks_away rename to game_badge_unlocks;"
  PRICE_BACK=$(PSQL -At -c "select price from public.shop_items where item_id = 'gamefx_noir'" 2>&1)
  [ "$PRICE_BACK" = "250" ] || { echo "SELÁHALO: po úklidu zkoušek kontroly předpokladů se cena nesrovnala ($PRICE_BACK)" >>"$OUT"; STATUS=1; }
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
