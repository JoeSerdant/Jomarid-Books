-- SQL testy oznámení, část 2: funkce pro čtenáře a správce (RPC), oprávnění, RLS, adresy push služeb, předvolby, ukázky.
-- Spouští se přes db/tests/run.sh po push_logic.test.sql.
\set ON_ERROR_STOP on
create schema if not exists tt;
grant usage on schema tt to public;
create or replace function tt.ok(c boolean, msg text) returns void language plpgsql as $$ begin if c is not true then raise exception 'SELÁHALO: %', msg; end if; raise notice 'OK   %', msg; end $$;
create or replace function tt.u(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
create or replace function tt.as_user(n int) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', tt.u(n)::text, false); end $$;
grant execute on all functions in schema tt to public;
-- příprava: uživatelé 1-30 (1 = správce) a nastavené odesílání
insert into auth.users select tt.u(g) from generate_series(1, 30) g on conflict do nothing;
insert into public.profiles (id, role) select tt.u(g), case when g = 1 then 'správce' else 'uživatel' end from generate_series(1, 30) g on conflict (id) do update set role = excluded.role;
insert into public.push_settings (id, function_url, secret) values (1, 'https://f.test/send-push', 'sekret') on conflict (id) do update set function_url = excluded.function_url, secret = excluded.secret;
truncate public.push_subscriptions, public.push_prefs, public.push_test_log, net.calls restart identity;

-- ===== zařízení =====
set role authenticated;
select tt.as_user(2);
select public.register_push_subscription('https://fcm.googleapis.com/fcm/send/ep1', repeat('P', 30), repeat('A', 12), 'UA');
select tt.ok((select count(*) from public.push_subscriptions) = 1, 'zařízení se zaregistruje a uživatel vidí jen svoje');
select tt.as_user(3);
select tt.ok((select count(*) from public.push_subscriptions) = 0, 'cizí uživatel zařízení nevidí (RLS)');
select public.register_push_subscription('https://fcm.googleapis.com/fcm/send/ep1', repeat('Q', 30), repeat('B', 12), 'UA2');
reset role;
select tt.ok((select user_id from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/ep1') = tt.u(3) and (select count(*) from public.push_subscriptions) = 1, 'sdílené zařízení se přepíše na toho, kdo se právě přihlásil');
set role authenticated;
select tt.as_user(2);
select public.unregister_push_subscription('https://fcm.googleapis.com/fcm/send/ep1');
reset role;
select tt.ok((select count(*) from public.push_subscriptions) = 1, 'cizí zařízení odhlásit nejde');
set role authenticated; select tt.as_user(3); select public.unregister_push_subscription('https://fcm.googleapis.com/fcm/send/ep1'); reset role;
select tt.ok((select count(*) from public.push_subscriptions) = 0, 'vlastní zařízení odhlásit jde');
set role authenticated;
do $$ begin
  begin perform public.register_push_subscription('http://nezabezpecene', repeat('P', 30), repeat('A', 12)); raise exception 'mělo selhat'; exception when others then if sqlerrm <> 'bad_endpoint' then raise; end if; end;
  perform tt.ok(not public.push_endpoint_ok('https://evil.example/fcm.googleapis.com/') and not public.push_endpoint_ok('https://fcm.googleapis.com.evil.example/x') and not public.push_endpoint_ok('https://fcm.googleapis.com@evil.example/x') and not public.push_endpoint_ok('https://127.0.0.1/x') and not public.push_endpoint_ok('http://fcm.googleapis.com/x') and not public.push_endpoint_ok(null) and not public.push_endpoint_ok('https://fcm.googleapis.com:8443/x'), 'cizí a podvržené adresy se odmítnou');
  perform tt.ok(public.push_endpoint_ok('https://fcm.googleapis.com/fcm/send/x') and public.push_endpoint_ok('https://updates.push.services.mozilla.com/wpush/v2/x') and public.push_endpoint_ok('https://web.push.apple.com/Q') and public.push_endpoint_ok('https://wns2-par02p.notify.windows.com/w/?token=x') and public.push_endpoint_ok('https://android.googleapis.com/gcm/send/x'), 'push služby prohlížečů se přijmou');
  begin perform public.register_push_subscription('https://evil.example/x', repeat('P', 30), repeat('A', 12)); raise exception 'mělo selhat'; exception when others then if sqlerrm <> 'bad_endpoint' then raise; end if; end;
  begin perform public.register_push_subscription('https://fcm.googleapis.com/fcm/send/e', 'krátký', repeat('A', 12)); raise exception 'mělo selhat'; exception when others then if sqlerrm <> 'bad_keys' then raise; end if; end;
  perform tt.ok(true, 'špatná adresa i špatné klíče se odmítnou');
end $$;
select tt.as_user(4);
set role authenticated;
select public.register_push_subscription('https://fcm.googleapis.com/fcm/send/m' || g, repeat('P', 30), repeat('A', 12)) from generate_series(1, 13) g;
reset role;
select tt.ok((select count(*) from public.push_subscriptions where user_id = tt.u(4)) = 10, 'nejvýš 10 zařízení na účet (nejstarší se smažou)');

-- ===== oprávnění =====
set role authenticated; select tt.as_user(2);
do $$ declare t text; begin
  foreach t in array array['push_settings', 'push_prefs', 'push_engage_log', 'push_test_log'] loop
    begin execute format('select * from public.%I', t); raise exception 'čtení % mělo selhat', t; exception when insufficient_privilege then null; end;
  end loop;
  begin insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values (auth.uid(), 'https://zapis.example', 'p', 'a'); raise exception 'zápis mělo selhat'; exception when insufficient_privilege then null; end;
  begin perform public.push_dispatch('user', auth.uid(), 't', 'b', '/', 'x'); raise exception 'odeslání mělo selhat'; exception when insufficient_privilege then null; end;
  begin perform public.push_engagement_tick(); raise exception 'plánovač mělo selhat'; exception when insufficient_privilege then null; end;
  begin perform public.push_engage_pick(auth.uid()); raise exception 'výběr mělo selhat'; exception when insufficient_privilege then null; end;
  perform tt.ok(true, 'soukromé tabulky a vnitřní funkce nejsou dostupné přihlášenému (jen přes bezpečné funkce)');
end $$;
reset role;
set role anon;
do $$ begin
  begin perform public.register_push_subscription('https://anon.example', repeat('P', 30), repeat('A', 12)); raise exception 'anon mělo selhat'; exception when insufficient_privilege then null; end;
  begin perform public.send_test_push(); raise exception 'anon mělo selhat'; exception when insufficient_privilege then null; end;
  perform tt.ok(true, 'nepřihlášený nemůže zařízení registrovat ani posílat zkoušku');
end $$;
reset role;

-- ===== nastavení =====
set role authenticated; select tt.as_user(2);
select tt.ok((public.get_push_prefs()->>'engage')::boolean = true, 'bez řádku platí „motivace zapnutá“');
select public.set_push_prefs(false);
select tt.ok((public.get_push_prefs()->>'engage')::boolean = false, 'vypnutí se uloží');
select tt.as_user(3);
select tt.ok((public.get_push_prefs()->>'engage')::boolean = true, 'nastavení je po účtech');
select tt.as_user(2); select public.set_push_prefs(true);
select tt.ok((public.get_push_prefs()->>'engage')::boolean = true, 'zapnutí zpět');
reset role;

-- ===== zkušební oznámení =====
truncate net.calls restart identity;
set role authenticated; select tt.as_user(2);
select public.send_test_push();
reset role;
select tt.ok((select body->>'title' = 'Zkušební oznámení' and (body->>'user_id')::uuid = tt.u(2) and body->>'kind' is null from net.calls), 'zkouška: hotový titulek sobě');
set role authenticated; select tt.as_user(2);
do $$ begin begin perform public.send_test_push(); raise exception 'mělo selhat'; exception when others then if sqlerrm <> 'too_many' then raise; end if; end; perform tt.ok(true, 'zkouška častěji než za 20 vteřin se odmítne'); end $$;
do $$ begin begin perform public.send_test_push('streak_risk'); raise exception 'mělo selhat'; exception when others then if sqlerrm <> 'forbidden' then raise; end if; end; perform tt.ok(true, 'ukázku druhů oznámení smí jen správce'); end $$;
reset role;
-- správce (uživatel 1)
update public.push_test_log set at = now() - interval '1 minute';
set role authenticated; select tt.as_user(1);
select public.send_test_push('streak_risk');
reset role;
select tt.ok((select body->>'kind' = 'streak_risk' and (body->'data'->>'streak')::int = 5 and (body->>'user_id')::uuid = tt.u(1) from net.calls order by id desc limit 1), 'správce: ukázka streak_risk s ukázkovými daty sobě');
do $$ declare k text; begin
  set local role authenticated; perform set_config('request.jwt.claim.sub', tt.u(1)::text, true);
  foreach k in array array['streak_milestone', 'comeback', 'continue_book', 'goal_progress', 'coins_to_spend', 'gentle_nudge', 'new_book', 'praise'] loop
    reset role; update public.push_test_log set at = now() - interval '1 minute'; set local role authenticated;
    perform public.send_test_push(k);
  end loop;
  begin reset role; update public.push_test_log set at = now() - interval '1 minute'; set local role authenticated; perform public.send_test_push('nesmysl'); raise exception 'mělo selhat'; exception when others then if sqlerrm <> 'bad_kind' then raise; end if; end;
  reset role;
  perform tt.ok((select count(distinct body->>'kind') from net.calls where body->>'kind' is not null) = 9, 'správce může vyzkoušet všech 9 druhů, neznámý druh se odmítne');
end $$;

