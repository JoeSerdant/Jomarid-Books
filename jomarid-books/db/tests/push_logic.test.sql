-- SQL testy oznámení, část 1: výběr oznámení (push_engage_pick), plánovač (push_engagement_tick), spouštěče a fronta novinek.
-- Spouští se přes db/tests/run.sh na dočasném PostgreSQL po mock_schema.sql a db/push-notifications.sql.
\set ON_ERROR_STOP on
create or replace function pg_temp.ok(c boolean, msg text) returns void language plpgsql as $$ begin if c is not true then raise exception 'SELÁHALO: %', msg; end if; raise notice 'OK   %', msg; end $$;
create or replace function pg_temp.u(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;

truncate public.profiles, public.books, public.user_books, public.user_daily_activity, public.user_notifications, public.admin_notifications, public.push_subscriptions, public.push_engage_log, public.push_prefs, public.push_test_log, public.push_new_books, auth.users, net.calls restart identity cascade;
insert into public.push_settings (id, function_url, secret) values (1, 'https://f.test/send-push', 'sekret') on conflict (id) do update set function_url = excluded.function_url, secret = excluded.secret, engage_from = 8, engage_to = 21, engage_gap_minutes = 180, engage_max_per_day = null;
insert into auth.users select pg_temp.u(g) from generate_series(1, 30) g;
insert into public.profiles (id, role) select pg_temp.u(g), case when g = 1 then 'správce' else 'uživatel' end from generate_series(1, 30) g;

-- ===== výběr oznámení (push_engage_pick); "dnes" = 2026-10-09 17:30 pražského času =====
create or replace function pg_temp.act(n int, d date) returns void language sql as $$ insert into public.user_daily_activity (user_id, activity_date) values (pg_temp.u(n), d) on conflict do nothing $$;
select set_config('app.now', '2026-10-09 17:30:00+02', false);
create or replace function pg_temp.pick(n int) returns jsonb language sql as $$ select public.push_engage_pick(pg_temp.u(n), current_setting('app.now')::timestamptz) $$;


-- čas posledního oznámení v deníku: před p_now o n hodin
create or replace function pg_temp.logged(n int, kind text, hours_ago numeric, meta text default null) returns void language sql as $$
  insert into public.push_engage_log (user_id, day, kind, meta, created_at)
  values (pg_temp.u(n), ((current_setting('app.now')::timestamptz - make_interval(hours => hours_ago::int)) at time zone 'Europe/Prague')::date, kind, meta, current_setting('app.now')::timestamptz - make_interval(hours => hours_ago::int)) $$;

-- série
select pg_temp.act(2, '2026-10-08'), pg_temp.act(2, '2026-10-07'), pg_temp.act(2, '2026-10-06');
select pg_temp.ok(pg_temp.pick(2) = '{"kind":"streak_risk","data":{"streak":3}}'::jsonb, 'série 3 dny, dnes se nečetlo: streak_risk (3)');
select pg_temp.act(3, '2026-10-08'), pg_temp.act(3, '2026-10-06');
select pg_temp.ok((pg_temp.pick(3)->'data'->>'streak')::int = 1, 'mezera ve dnech přeruší sérii (zbývá 1)');
select pg_temp.act(4, '2026-10-08'), pg_temp.act(4, '2026-10-06');
update public.profiles set frozen_dates = array['2026-10-07'::date] where id = pg_temp.u(4);
select pg_temp.ok((pg_temp.pick(4)->'data'->>'streak')::int = 3, 'zmrazený den série se počítá jako splněný');

-- po dnešním čtení: milník, pak pochvala, pak nic
select pg_temp.act(5, '2026-10-09'), pg_temp.act(5, '2026-10-08'), pg_temp.act(5, '2026-10-07');
select pg_temp.ok(pg_temp.pick(5)->>'kind' = 'streak_milestone' and (pg_temp.pick(5)->'data'->>'streak')::int = 3, 'po dnešním čtení a sérii 3 dny: milník');
select pg_temp.logged(5, 'streak_milestone', 1, '3');
select pg_temp.ok(pg_temp.pick(5) = '{"kind":"praise","data":{"streak":3}}'::jsonb, 'stejný milník podruhé ne; místo něj pochvala za dnešní čtení (se sérií)');
select pg_temp.logged(5, 'praise', 0);
select pg_temp.ok(pg_temp.pick(5) is null, 'pochvala jen jednou denně; po dnešním čtení už nic dalšího nenapadá');
select pg_temp.act(6, '2026-10-09'), pg_temp.act(6, '2026-10-08'), pg_temp.act(6, '2026-10-07'), pg_temp.act(6, '2026-10-06');
select pg_temp.ok(pg_temp.pick(6) = '{"kind":"praise","data":{"streak":4}}'::jsonb, 'po dnešním čtení bez milníku: pochvala (série 4)');
select pg_temp.act(30, '2026-10-09');
select pg_temp.ok(pg_temp.pick(30) = '{"kind":"praise","data":{"streak":1}}'::jsonb, 'kdo dnes četl poprvé: pochvala (série 1)');

-- návrat po pauze
select pg_temp.act(7, '2026-10-06');
select pg_temp.ok(pg_temp.pick(7) = '{"kind":"comeback","data":{"days":3}}'::jsonb, 'po 3 dnech bez čtení: comeback (3)');
select pg_temp.logged(7, 'comeback', 2);
select pg_temp.ok(pg_temp.pick(7)->>'kind' = 'gentle_nudge', 'návrat se v ten den neopakuje (zbývá jemné popostrčení)');
select pg_temp.act(8, '2026-10-02');
select pg_temp.ok((pg_temp.pick(8)->'data'->>'days')::int = 7, 'po 7 dnech: comeback (7)');
select pg_temp.act(9, '2026-10-05');
select pg_temp.ok(pg_temp.pick(9)->>'kind' = 'gentle_nudge', 'po 4 dnech (není milník návratu): jen jemné popostrčení');

-- rozečtená kniha
insert into public.books (id, title, price_coins) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Dlouhá cesta', 0), ('aaaaaaaa-0000-0000-0000-000000000002', 'Dokončená', 0), ('aaaaaaaa-0000-0000-0000-000000000003', 'Nové', 0);
truncate public.push_new_books; -- knihy z příprav testů jsou taky "nové"; pro testy výběru je fronta prázdná
select pg_temp.act(10, '2026-09-20');
insert into public.user_books (user_id, book_id, status, is_read, scroll_position, updated_at) values
  (pg_temp.u(10), 'aaaaaaaa-0000-0000-0000-000000000001', 'active', false, 45.4, '2026-10-07'),
  (pg_temp.u(10), 'aaaaaaaa-0000-0000-0000-000000000002', 'active', true, 100, '2026-10-08'),
  (pg_temp.u(10), 'aaaaaaaa-0000-0000-0000-000000000003', 'active', false, 1, '2026-10-08');
select pg_temp.ok(pg_temp.pick(10) = '{"kind":"continue_book","data":{"title":"Dlouhá cesta","percent":45}}'::jsonb, 'rozečtená kniha: název a procento (dokončená a sotva načatá se ignorují)');
select pg_temp.logged(10, 'continue_book', 5);
select pg_temp.ok(pg_temp.pick(10)->>'kind' = 'gentle_nudge', 'rozečtená kniha se připomíná nejdřív za 20 hodin (zatím jemné popostrčení)');
delete from public.push_engage_log where user_id = pg_temp.u(10);
select pg_temp.logged(10, 'continue_book', 21);
select pg_temp.logged(10, 'gentle_nudge', 3); -- naposledy přišlo popostrčení, takže střídání nebrání
select pg_temp.ok(pg_temp.pick(10)->>'kind' = 'continue_book', 'po 21 hodinách se rozečtená kniha připomene znovu (už dávno ne jednou za 3 dny)');

-- měsíční cíl (až od 10. dne v měsíci)
select set_config('app.now', '2026-10-15 17:30:00+02', false);
select pg_temp.act(11, '2026-09-30');
update public.profiles set monthly_goal = 3 where id = pg_temp.u(11);
insert into public.user_books (user_id, book_id, status, is_read, first_completed_at) values (pg_temp.u(11), 'aaaaaaaa-0000-0000-0000-000000000002', 'active', true, '2026-10-03 10:00+02');
select pg_temp.ok(pg_temp.pick(11) = '{"kind":"goal_progress","data":{"goal":3,"done":1,"remaining":2}}'::jsonb, 'měsíční cíl: zbývají 2 z 3');
select pg_temp.logged(11, 'goal_progress', 30);
select pg_temp.ok(pg_temp.pick(11)->>'kind' = 'gentle_nudge', 'cíl se po 30 hodinách ještě nepřipomíná (2 dny)');
delete from public.push_engage_log where user_id = pg_temp.u(11);
select pg_temp.logged(11, 'goal_progress', 50);
select pg_temp.logged(11, 'gentle_nudge', 3); -- naposledy přišlo popostrčení, takže střídání nebrání
select pg_temp.ok(pg_temp.pick(11)->>'kind' = 'goal_progress', 'cíl se po 50 hodinách připomene znovu');
delete from public.push_engage_log where user_id = pg_temp.u(11);
update public.profiles set monthly_goal = 1 where id = pg_temp.u(11);
select pg_temp.ok(pg_temp.pick(11)->>'kind' = 'gentle_nudge', 'splněný cíl se nepřipomíná');
select set_config('app.now', '2026-10-09 17:30:00+02', false);
update public.profiles set monthly_goal = 3 where id = pg_temp.u(11);
select pg_temp.ok(pg_temp.pick(11)->>'kind' = 'gentle_nudge', 'před 10. dnem v měsíci se cíl nepřipomíná');

-- mince
insert into public.books (id, title, price_coins) values ('bbbbbbbb-0000-0000-0000-000000000001', 'Placená', 150);
truncate public.push_new_books;
select pg_temp.act(12, '2026-09-20');
update public.profiles set coins = 300 where id = pg_temp.u(12);
select pg_temp.ok(pg_temp.pick(12) = '{"kind":"coins_to_spend","data":{"coins":300}}'::jsonb, 'dost mincí na nevlastněnou placenou knihu');
select pg_temp.logged(12, 'coins_to_spend', 50);
select pg_temp.ok(pg_temp.pick(12)->>'kind' = 'gentle_nudge', 'mince se nabízejí nejdřív za 3 dny');
delete from public.push_engage_log where user_id = pg_temp.u(12);
select pg_temp.logged(12, 'coins_to_spend', 80);
select pg_temp.logged(12, 'gentle_nudge', 3);
select pg_temp.ok(pg_temp.pick(12)->>'kind' = 'coins_to_spend', 'po 80 hodinách se mince nabídnou znovu');
delete from public.push_engage_log where user_id = pg_temp.u(12);
insert into public.user_books (user_id, book_id, status) values (pg_temp.u(12), 'bbbbbbbb-0000-0000-0000-000000000001', 'active');
select pg_temp.ok(pg_temp.pick(12)->>'kind' = 'gentle_nudge', 'vlastněnou knihu nenabízí');
update public.profiles set coins = 100 where id = pg_temp.u(13);
select pg_temp.act(13, '2026-09-20');
select pg_temp.ok(pg_temp.pick(13)->>'kind' = 'gentle_nudge', 'málo mincí: žádná nabídka');

-- jemné popostrčení: bez stropu, opakuje se
select pg_temp.act(14, '2026-09-20');
select pg_temp.ok(pg_temp.pick(14)->>'kind' = 'gentle_nudge', 'bez důvodu jen jemné popostrčení');
select pg_temp.logged(14, 'gentle_nudge', 3);
select pg_temp.ok(pg_temp.pick(14)->>'kind' = 'gentle_nudge', 'popostrčení smí přijít i znovu (nic jiného se nehodí; odstup hlídá plánovač)');

-- střídání druhů: nic nechodí pořád dokola
select pg_temp.ok(pg_temp.pick(2)->>'kind' = 'streak_risk', 'bez historie vede nejdůležitější druh (série v ohrožení)');
select pg_temp.logged(2, 'streak_risk', 3);
select pg_temp.ok(pg_temp.pick(2)->>'kind' = 'gentle_nudge', 'po ohrožené sérii přijde jiný druh (popostrčení), ne to samé znovu');
select pg_temp.logged(2, 'gentle_nudge', 1);
select pg_temp.ok(pg_temp.pick(2)->>'kind' = 'streak_risk', 'a pak zase ohrožená série');
delete from public.push_engage_log where user_id = pg_temp.u(2);
select pg_temp.logged(2, 'streak_risk', 30);
select pg_temp.ok(pg_temp.pick(2)->>'kind' = 'gentle_nudge', 'střídání platí podle posledního oznámení i po víc než 24 hodinách (jinak by se s denním stropem 1 opakovalo pořád totéž)');

-- ===== plánovač: okno hodin, odstup, strop, preference =====
truncate public.push_engage_log, net.calls restart identity;
-- 2, 3 (série), 7, 8 (návrat), 14, 15 (popostrčení), 17 vypnul připomínky, 5 (dnes četl), 16 nemá zařízení
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) select pg_temp.u(n), 'https://fcm.googleapis.com/fcm/send/' || n, repeat('P', 30), repeat('A', 12) from unnest(array[2, 3, 7, 8, 14, 15, 17, 5]) n;
insert into public.push_prefs (user_id, engage, updated_at) values (pg_temp.u(17), false, now()) on conflict (user_id) do update set engage = false;
select pg_temp.ok(public.push_engagement_tick('2026-10-09 03:00:00+02') = 0 and public.push_engagement_tick('2026-10-09 07:30:00+02') = 0 and public.push_engagement_tick('2026-10-09 22:30:00+02') = 0, 'v noci a před osmou ani po desáté večer se neposílá nic');
select pg_temp.ok((select engage_from = 8 and engage_to = 21 and engage_gap_minutes = 180 and engage_max_per_day is null from public.push_settings), 'výchozí nastavení: 8-21 h, odstup 3 hodiny, bez denního stropu');
select pg_temp.ok(public.push_engagement_tick('2026-10-09 08:05:00+02') = 7, 'v 8 h dostane oznámení každý oprávněný (7 čtenářů; vypnuté a bez zařízení ne)');
select pg_temp.ok((select count(*) from public.push_engage_log where created_at = '2026-10-09 08:05:00+02') = 7, 'deník nese čas odeslání');
select pg_temp.ok(public.push_engagement_tick('2026-10-09 09:05:00+02') = 0 and public.push_engagement_tick('2026-10-09 10:05:00+02') = 0, 'do 3 hodin od posledního oznámení nic dalšího');
select pg_temp.ok(public.push_engagement_tick('2026-10-09 11:05:00+02') = 7, 'po 3 hodinách přijde další oznámení (víc než jedno denně)');
select pg_temp.ok(public.push_engagement_tick('2026-10-09 14:05:00+02') = 6 and public.push_engagement_tick('2026-10-09 17:05:00+02') = 6 and public.push_engagement_tick('2026-10-09 20:05:00+02') = 6, 'celý den: 8, 11, 14, 17 a 20 h (čtenář, který dnes četl, po milníku a pochvale už nic nedostává)');
select pg_temp.ok((select count(*) from public.push_engage_log where day = '2026-10-09') = 32, 'celkem 5 oznámení × 6 čtenářů + 2 pro toho, kdo dnes četl');
select pg_temp.ok((select count(distinct body->>'tag') from net.calls) = 5, 'každé oznámení má svou značku (nepřepisují se)');
select pg_temp.ok((select bool_and(headers->>'x-push-secret' = 'sekret' and url = 'https://f.test/send-push' and body->>'audience' = 'user' and body->>'kind' is not null and body->>'title' = '') from net.calls), 'volání mají heslo, adresu, příjemce a druh a nenesou hotový text');
select pg_temp.ok((select count(*) from net.calls where (body->>'user_id')::uuid = pg_temp.u(17)) = 0 and (select count(*) from net.calls where (body->>'user_id')::uuid = pg_temp.u(16)) = 0, 'kdo vypnul připomínky nebo nemá zařízení, nedostal nic');
select pg_temp.ok((select count(distinct kind) from public.push_engage_log where user_id = pg_temp.u(2)) >= 2, 'série v ohrožení se v průběhu dne střídá s jiným druhem (' || (select string_agg(kind, ',' order by created_at) from public.push_engage_log where user_id = pg_temp.u(2)) || ')');
select pg_temp.ok((select kind from public.push_engage_log where user_id = pg_temp.u(5) order by created_at limit 1) = 'streak_milestone' and (select count(*) from public.push_engage_log where user_id = pg_temp.u(5) and kind = 'praise') = 1, 'čtenář po čtení: nejdřív milník, pochvala jen jednou za den');
select pg_temp.ok(not exists (select 1 from public.push_engage_log where user_id = pg_temp.u(5) and kind in ('gentle_nudge', 'streak_risk')), 'kdo dnes četl, nedostává připomínky, že má číst');

-- strop na den (volitelný) a odstup 0
truncate public.push_engage_log, net.calls restart identity;
update public.push_settings set engage_max_per_day = 2;
do $$
declare h int; total int := 0;
begin
  for h in 8..21 loop total := total + public.push_engagement_tick('2026-10-09 00:00:00+02'::timestamptz + make_interval(hours => h, mins => 5)); end loop;
  perform pg_temp.ok(total = 14 and (select max(c) from (select count(*) c from public.push_engage_log group by user_id) q) = 2, 'nastavený strop 2 za den platí (' || total || ' oznámení pro 7 čtenářů)');
end $$;
truncate public.push_engage_log, net.calls restart identity;
update public.push_settings set engage_max_per_day = null, engage_gap_minutes = 0;
select pg_temp.ok(public.push_engagement_tick('2026-10-09 09:05:00+02') = 7 and public.push_engagement_tick('2026-10-09 10:05:00+02') = 7 and public.push_engagement_tick('2026-10-09 11:05:00+02') = 6, 'odstup 0 a bez stropu: oznámení každou hodinu (bez limitu; čtenář po milníku a pochvale už nic nedostane)');
update public.push_settings set engage_gap_minutes = 180, engage_from = 12, engage_to = 13;
truncate public.push_engage_log, net.calls restart identity;
select pg_temp.ok(public.push_engagement_tick('2026-10-09 11:05:00+02') = 0 and public.push_engagement_tick('2026-10-09 12:05:00+02') = 7 and public.push_engagement_tick('2026-10-09 14:05:00+02') = 0, 'okno hodin se dá změnit (12-13 h)');
update public.push_settings set engage_from = 8, engage_to = 21;
truncate public.push_engage_log, net.calls restart identity;
update public.push_settings set function_url = null;
select pg_temp.ok(public.push_engagement_tick('2026-10-09 12:05:00+02') = 0 and (select count(*) from public.push_engage_log) = 0, 'nenastavené odesílání: nic se neposílá ani nezapisuje do deníku');
update public.push_settings set function_url = 'https://f.test/send-push';
truncate public.push_engage_log, net.calls restart identity;

-- ===== spouštěče =====
truncate net.calls restart identity;
insert into public.user_notifications (user_id, kind, title, body) values (pg_temp.u(20), 'license_received', 'Dostal jsi knihu', 'Autor ti daroval knihu.');
select pg_temp.ok((select body->>'audience' = 'user' and (body->>'user_id')::uuid = pg_temp.u(20) and body->>'title' = 'Dostal jsi knihu' and body->>'url' = '/settings/notifications' and body->>'kind' is null from net.calls order by id desc limit 1), 'oznámení čtenáře: spouštěč pošle titulek, text a cíl');
truncate net.calls restart identity;
insert into public.admin_notifications (kind, status, title, body) values ('password_help', 'open', 'Žádost o heslo', 'Uživatel pomoc');
insert into public.admin_notifications (kind, status, title, body) values ('x', 'handled', 'Vyřízené', null);
select pg_temp.ok((select count(*) from net.calls) = 1 and (select body->>'audience' from net.calls) = 'admins' and (select body->>'url' from net.calls) = '/admin', 'otevřené upozornění správci: jedno volání pro správce; vyřízené nic');

truncate net.calls restart identity;
truncate public.push_new_books;
insert into public.books (id, title, author, author_id, is_hidden) values ('cccccccc-0000-0000-0000-000000000002', 'Skrytá', 'A', pg_temp.u(21), true);
select pg_temp.ok((select count(*) from public.push_new_books) = 0 and (select count(*) from net.calls) = 0, 'skrytý koncept se neoznamuje');
insert into public.books (id, title, author, author_display, author_id) values ('cccccccc-0000-0000-0000-000000000001', 'Nová novinka', 'login', 'Autorka', pg_temp.u(21));
select pg_temp.ok((select count(*) from public.push_new_books) = 1 and (select count(*) from net.calls) = 0, 'nová viditelná kniha: jen do fronty, žádné okamžité odeslání (žádný hromadný push)');
select pg_temp.ok((select title = 'Nová novinka' and author = 'Autorka' and author_id = pg_temp.u(21) from public.push_new_books), 'fronta nese název, autora a jeho účet');
update public.books set is_hidden = false where title = 'Skrytá';
select pg_temp.ok((select count(*) from public.push_new_books) = 2 and (select count(*) from net.calls) = 0, 'zveřejnění skrytého konceptu se zařadí do fronty');
update public.books set title = title where title = 'Skrytá';
update public.books set is_hidden = true where title = 'Skrytá';
select pg_temp.ok((select count(*) from public.push_new_books) = 2, 'úprava ani skrytí knihy nezařazuje nic nového');
update public.books set is_hidden = false where title = 'Skrytá';
delete from public.push_new_books where book_id = 'cccccccc-0000-0000-0000-000000000002';
update public.push_new_books set announced_at = '2026-09-01' where false;
insert into public.push_new_books (book_id, title, author, announced_at) values ('cccccccc-0000-0000-0000-0000000000ff', 'Stará', 'X', now() - interval '31 days');
update public.books set title = title;
insert into public.books (title) values ('Spouštěč uklidí staré');
select pg_temp.ok((select count(*) from public.push_new_books where book_id = 'cccccccc-0000-0000-0000-0000000000ff') = 0, 'záznamy starší než 30 dní se při dalším zařazení uklidí');
delete from public.books where title = 'Spouštěč uklidí staré';
delete from public.push_new_books where book_id not in ('cccccccc-0000-0000-0000-000000000001');
update public.push_new_books set announced_at = '2026-10-08 12:00:00+02';

-- ===== nová kniha jako připomínka (pick + plánovač) =====
select set_config('app.now', '2026-10-09 17:30:00+02', false);
select pg_temp.ok(pg_temp.pick(23) = ('{"kind":"new_book","data":{"title":"Nová novinka","author":"Autorka"},"meta":"cccccccc-0000-0000-0000-000000000001"}')::jsonb, 'čtenář bez jiného důvodu dostane novou knihu (místo popostrčení), s id knihy v meta');
select pg_temp.ok(pg_temp.pick(21)->>'kind' = 'gentle_nudge', 'autor knihy novinku nedostane');
update public.books set title = 'Přejmenovaná novinka', author_display = 'Nové jméno' where id = 'cccccccc-0000-0000-0000-000000000001';
select pg_temp.ok(pg_temp.pick(23)->'data' = '{"title":"Přejmenovaná novinka","author":"Nové jméno"}'::jsonb, 'oznámení nese aktuální název a autora knihy (úprava před odesláním se projeví)');
update public.books set author_id = pg_temp.u(23) where id = 'cccccccc-0000-0000-0000-000000000001';
select pg_temp.ok(pg_temp.pick(23)->>'kind' = 'gentle_nudge' and pg_temp.pick(21)->>'kind' = 'new_book', 'změna autora knihy před odesláním: novinku dostane původní autor, ne nový');
update public.books set title = 'Nová novinka', author_display = 'Autorka', author_id = pg_temp.u(21) where id = 'cccccccc-0000-0000-0000-000000000001';
insert into public.user_books (user_id, book_id, status) values (pg_temp.u(24), 'cccccccc-0000-0000-0000-000000000001', 'active');
select pg_temp.ok(pg_temp.pick(24)->>'kind' = 'gentle_nudge', 'kdo knihu už má, novinku nedostane');
select pg_temp.act(25, '2026-09-20');
select pg_temp.logged(25, 'new_book', 5, 'cccccccc-0000-0000-0000-0000000000aa');
select pg_temp.ok(pg_temp.pick(25)->>'kind' = 'gentle_nudge', 'další novinka nejdřív po 12 hodinách od předchozí');
delete from public.push_engage_log where user_id = pg_temp.u(25);
select pg_temp.logged(25, 'new_book', 24, 'cccccccc-0000-0000-0000-0000000000aa');
select pg_temp.logged(25, 'gentle_nudge', 3); -- naposledy přišlo popostrčení, takže střídání nebrání
select pg_temp.ok(pg_temp.pick(25)->>'kind' = 'new_book', 'po 24 hodinách se další novinka oznámí (dřív to bylo po 2 dnech)');
insert into public.push_engage_log (user_id, day, kind, meta, created_at) values (pg_temp.u(27), '2026-09-01', 'new_book', 'cccccccc-0000-0000-0000-000000000001', '2026-09-01 17:30:00+02');
select pg_temp.ok(pg_temp.pick(27)->>'kind' = 'gentle_nudge', 'stejnou knihu čtenář podruhé nedostane');
select pg_temp.act(26, '2026-10-09');
select pg_temp.ok(pg_temp.pick(26)->>'kind' = 'new_book', 'kdo dnes četl, dostane novinku místo mlčení');
select pg_temp.act(28, '2026-10-08'), pg_temp.act(28, '2026-10-07');
select pg_temp.ok(pg_temp.pick(28)->>'kind' = 'streak_risk', 'série v ohrožení má přednost před novinkou');
select pg_temp.act(29, '2026-10-09'), pg_temp.act(29, '2026-10-08'), pg_temp.act(29, '2026-10-07');
select pg_temp.ok(pg_temp.pick(29)->>'kind' = 'streak_milestone', 'milník má přednost před novinkou');
select set_config('app.now', '2026-10-13 17:30:00+02', false);
select pg_temp.ok(pg_temp.pick(23)->>'kind' = 'gentle_nudge', 'novinka starší než 4 dny se už nepřipomíná');
select set_config('app.now', '2026-10-09 17:30:00+02', false);
update public.books set is_hidden = true where id = 'cccccccc-0000-0000-0000-000000000001';
select pg_temp.ok(pg_temp.pick(23)->>'kind' = 'gentle_nudge', 'kniha skrytá mezitím se neoznamuje');
update public.books set is_hidden = false where id = 'cccccccc-0000-0000-0000-000000000001';

truncate public.push_engage_log, public.push_subscriptions, net.calls restart identity;
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values (pg_temp.u(23), 'https://fcm.googleapis.com/fcm/send/n23', repeat('P', 30), repeat('A', 12)), (pg_temp.u(21), 'https://fcm.googleapis.com/fcm/send/n21', repeat('P', 30), repeat('A', 12));
select pg_temp.ok(public.push_engagement_tick('2026-10-09 03:00:00+02') = 0 and public.push_engagement_tick('2026-10-09 22:30:00+02') = 0, 'novinka v noci ani pozdě večer nechodí (okno hodin platí i pro ni)');
select pg_temp.ok(public.push_engagement_tick('2026-10-09 08:05:00+02') = 2, 'plánovač pošle novinku čtenáři (a autorovi jemné popostrčení)');
select pg_temp.ok((select count(*) from net.calls where body->>'kind' = 'new_book' and (body->>'user_id')::uuid = pg_temp.u(23) and body->>'audience' = 'user') = 1 and (select count(*) from net.calls where body->>'audience' = 'all') = 0, 'novinka jde jednotlivě čtenáři, nikdy hromadně');
select pg_temp.ok((select meta from public.push_engage_log where user_id = pg_temp.u(23)) = 'cccccccc-0000-0000-0000-000000000001', 'deník si pamatuje, kterou knihu už čtenář dostal');
truncate net.calls restart identity;

-- odeslání nikdy nerozbije zápis oznámení
alter function net.http_post(text, jsonb, jsonb, jsonb, int) rename to http_post_ok;
create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000) returns bigint language plpgsql as $$ begin raise exception 'síť spadla'; end $$;
insert into public.user_notifications (user_id, kind, title, body) values (pg_temp.u(22), 'x', 'I při výpadku', null);
select pg_temp.ok((select count(*) from public.user_notifications where title = 'I při výpadku') = 1, 'výpadek odesílání nerozbije zápis oznámení');
drop function net.http_post(text, jsonb, jsonb, jsonb, int);
alter function net.http_post_ok(text, jsonb, jsonb, jsonb, int) rename to http_post;
update public.push_settings set function_url = null;
insert into public.user_notifications (user_id, kind, title, body) values (pg_temp.u(22), 'x', 'Bez nastavení', null);
select pg_temp.ok((select count(*) from public.user_notifications where title = 'Bez nastavení') = 1 and (select count(*) from net.calls where body->>'title' = 'Bez nastavení') = 0, 'nenastavené odesílání nic neposílá a nic nerozbije');
update public.push_settings set function_url = 'https://f.test/send-push';
