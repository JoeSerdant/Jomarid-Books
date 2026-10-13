-- SQL testy změny e-mailu přes správce (db/email-change.sql): žádost čtenáře, zrušení, provedení a zamítnutí správcem, oprávnění.
-- Spouští se přes db/tests/run.sh po push_rpc.test.sql (potřebuje mock_schema.sql, db/email-change.sql a db/push-notifications.sql).
\set ON_ERROR_STOP on
create schema if not exists tt;
grant usage on schema tt to public;
create or replace function tt.ok(c boolean, msg text) returns void language plpgsql as $$ begin if c is not true then raise exception 'SELÁHALO: %', msg; end if; raise notice 'OK   %', msg; end $$;
-- Účty tohoto testu mají čísla od 100 (id ...0101 a výš), ať se nepletou s uživateli z push testů, které potřebuje i souběh plánovače v run.sh.
create or replace function tt.eu(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad((100 + n)::text, 12, '0'))::uuid $$;
create or replace function tt.as_eu(n int) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', tt.eu(n)::text, false); end $$;
create or replace function tt.no_user() returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', '', false); end $$;
-- Stav všech dotčených tabulek jako jeden otisk (bez ohledu na roli, která test spouští).
create or replace function tt.snap() returns text language sql security definer as $$
  select md5(concat_ws('|',
    (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]') from auth.users t)::text,
    (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]') from auth.identities t)::text,
    (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]') from public.profiles t)::text,
    (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]') from public.admin_notifications t)::text,
    (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]') from public.user_notifications t)::text,
    (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]') from public.system_logs t)::text)) $$;
-- Otisk účtů všech ostatních uživatelů (ověření, že změna jednoho účtu nesáhla na cizí řádky).
create or replace function tt.snap_others(n int) returns text language sql security definer as $$
  select md5(concat_ws('|',
    (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]') from auth.users t where t.id <> tt.eu(n))::text,
    (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]') from auth.identities t where t.user_id <> tt.eu(n))::text,
    (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]') from public.profiles t where t.id <> tt.eu(n))::text)) $$;
-- Id poslední žádosti o změnu e-mailu daného uživatele.
create or replace function tt.req_id(n int) returns uuid language sql security definer as $$
  select id from public.admin_notifications where user_id = tt.eu(n) and kind = 'email_change_request' order by created_at desc, id limit 1 $$;
-- Dotaz musí selhat chybou p_code (text hlášení nebo SQLSTATE) a nesmí nic změnit.
create or replace function tt.fails(q text, p_code text, msg text) returns void language plpgsql as $$
declare before_state text := tt.snap();
begin
  begin
    execute q;
  exception when others then
    if sqlerrm <> p_code and sqlstate <> p_code then raise exception 'SELÁHALO: % (čekalo se %, přišlo %)', msg, p_code, sqlerrm; end if;
    if tt.snap() is distinct from before_state then raise exception 'SELÁHALO: % (selhání něco změnilo)', msg; end if;
    raise notice 'OK   %', msg;
    return;
  end;
  raise exception 'SELÁHALO: % (nic nevyhodilo)', msg;
end $$;
-- Vyrobí účet: auth.users + e-mailová identita + profil.
create or replace function tt.mk(n int, p_email text, p_username text, p_role text default 'uživatel', p_confirmed timestamptz default '2026-01-02 03:04:05+00',
                                 p_meta jsonb default '{}', p_provider_id text default null) returns void language plpgsql security definer as $$
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values (tt.eu(n), p_email, p_confirmed, p_meta);
  insert into auth.identities (provider_id, user_id, identity_data, provider) values (coalesce(p_provider_id, tt.eu(n)::text), tt.eu(n), jsonb_build_object('email', p_email, 'sub', tt.eu(n)), 'email');
  insert into public.profiles (id, role, email, username) values (tt.eu(n), p_role, p_email, p_username);
end $$;
grant execute on all functions in schema tt to public;

-- ===== příprava =====
delete from public.profiles where id between tt.eu(0) and tt.eu(899);
delete from auth.identities where user_id between tt.eu(0) and tt.eu(899);
delete from auth.users where id between tt.eu(0) and tt.eu(899);
truncate public.admin_notifications, public.user_notifications, public.system_logs, net.calls restart identity;
select tt.mk(1, 'admin@x.cz', 'admin', 'správce');
select tt.mk(2, 'Jana@Example.cz', 'jana', p_meta => '{"email":"Jana@Example.cz","sub":"x"}');
select tt.mk(3, 'petr@x.cz', 'petr', p_confirmed => null, p_provider_id => 'petr@x.cz');
select tt.mk(4, 'eva@x.cz', 'eva', p_meta => '{"email":"eva@x.cz"}');
select tt.mk(5, 'karel@x.cz', 'karel');
select tt.mk(6, 'drzitel@x.cz', 'drzitel');
select tt.mk(7, 'ident-old@x.cz', 'identita');
select tt.mk(8, 'p8@x.cz', 'profil');
select tt.mk(9, 'tomas@x.cz', 'tomas');
select tt.mk(10, 'lenka@x.cz', 'lenka');
select tt.mk(11, 'marek@x.cz', 'marek');
-- účty bez profilu (AuthContext ho doplní až při přihlášení): 12 drží e-mail jen v auth.users, 13 se mění
select tt.mk(12, 'jenusers@x.cz', 'bezprofilu12');
select tt.mk(13, 'bezprofilu@x.cz', 'bezprofilu13');
delete from public.profiles where id in (tt.eu(12), tt.eu(13));
delete from auth.identities where user_id = tt.eu(12);
-- adresa jen v identitě a adresa jen v profilu cizího účtu
update auth.identities set identity_data = jsonb_build_object('email', 'ident@x.cz') where user_id = tt.eu(7);
update public.profiles set email = 'profil@x.cz' where id = tt.eu(8);
-- nedokončená změna přes odkaz (sloupce email_change*) u Jany: po změně správcem se musí vyčistit
update auth.users set email_change = 'zbytek@x.cz', email_change_token_new = 'tok1', email_change_token_current = 'tok2', email_change_sent_at = now(), email_change_confirm_status = 1 where id = tt.eu(2);
-- další (ne e-mailová) identita Evy: změna e-mailu se jí nedotkne
insert into auth.identities (provider_id, user_id, identity_data, provider) values ('g-123', tt.eu(4), '{"email":"eva@x.cz","sub":"g-123"}', 'google');

select tt.ok((select count(*) from pg_constraint where conname = 'admin_notifications_status_check') = 1, 'tabulka upozornění přijme jen stavy open / done / dismissed (jako ve skutečné databázi)');
do $$ begin
  begin insert into public.admin_notifications (kind, status, title) values ('x', 'handled', 't'); raise exception 'mělo selhat'; exception when check_violation then null; end;
  perform tt.ok(true, 'stav „handled“ se odmítne');
end $$;

-- ===== žádost čtenáře =====
set role authenticated;
select tt.no_user();
select tt.fails($$select public.request_email_change('a@b.cz')$$, 'not_authenticated', 'žádost bez přihlášení: not_authenticated');
select tt.fails($$select public.my_email_change_request()$$, 'not_authenticated', 'stav žádosti bez přihlášení: not_authenticated');
select tt.fails($$select public.cancel_my_email_change_request()$$, 'not_authenticated', 'zrušení žádosti bez přihlášení: not_authenticated');
select tt.as_eu(2);
select tt.fails(format('select public.request_email_change(%L)', v), 'invalid_email', 'neplatný e-mail ' || coalesce('„' || left(v, 20) || '“', 'null'))
  from unnest(array['', '   ', 'bez-zavinace', 'a b@x.cz', 'a@b', 'a@@b.cz', '@x.cz', 'a@.', 'a@b..c', 'a@.b.c', 'a@b.c.', repeat('a', 250) || '@x.cz', null]) as v;
select tt.fails($$select public.request_email_change('jana@example.cz')$$, 'same_email', 'stejný e-mail jako dosavadní (jiná velikost písmen): same_email');
select tt.fails($$select public.request_email_change('  JANA@EXAMPLE.CZ ')$$, 'same_email', 'stejný e-mail s mezerami a velkými písmeny: same_email');
select public.request_email_change('  Nova@Example.CZ ', '  prosím, překlep v původním  ') as r \gset
reset role;
select tt.ok((:'r'::jsonb ->> 'ok')::boolean and (:'r'::jsonb ->> 'id')::uuid = tt.req_id(2), 'žádost vrátí ok a id upozornění');
select tt.ok((select kind = 'email_change_request' and status = 'open' and user_id = tt.eu(2) and handled_at is null and handled_by is null
                and payload ->> 'new_email' = 'nova@example.cz' and payload ->> 'old_email' = 'jana@example.cz'
                and (payload ->> 'logged_in')::boolean and not (payload ->> 'conflict')::boolean
                and not payload ? 'cancelled' from public.admin_notifications where id = tt.req_id(2)),
  'žádost: nový e-mail v datech je oříznutý a malými písmeny, dosavadní také, conflict = false');
select tt.ok((select title !~ '@' and title !~* 'nova' and coalesce(body, '') !~ '@' and coalesce(body, '') !~* 'nova@' and body = 'prosím, překlep v původním'
                from public.admin_notifications where id = tt.req_id(2)), 'v titulku ani textu upozornění není žádný e-mail (posílají se na zamčenou obrazovku), vzkaz čtenáře je oříznutý');
select tt.ok((select count(*) from net.calls where body::text ~* 'nova@example') = 0, 'oznámení do zařízení správců nový e-mail neobsahuje');
set role authenticated; select tt.as_eu(2);
select tt.fails($$select public.request_email_change('jiny@example.cz')$$, 'request_already_open', 'druhá otevřená žádost: request_already_open');
reset role;
select tt.ok((select count(*) from public.admin_notifications where user_id = tt.eu(2) and kind = 'email_change_request') = 1, 'druhá žádost nic nezapsala');
do $$ begin
  begin
    insert into public.admin_notifications (kind, user_id, title) values ('email_change_request', tt.eu(2), 'Duplicita');
    raise exception 'mělo selhat';
  exception when unique_violation then
    perform tt.ok(sqlerrm like '%admin_notifications_one_open_email_request%', 'dvě otevřené žádosti jednoho uživatele zakáže i jedinečný index (souběh)');
  end;
  insert into public.admin_notifications (kind, user_id, title, status) values ('email_change_request', tt.eu(2), 'Vyřízená', 'done');
  insert into public.admin_notifications (kind, user_id, title, status) values ('jina_zadost', tt.eu(2), 'Jiný druh', 'open');
  perform tt.ok(true, 'index omezuje jen otevřené žádosti o e-mail (vyřízené a jiné druhy upozornění ne)');
  delete from public.admin_notifications where title in ('Vyřízená', 'Jiný druh');
end $$;

-- stav žádosti, zrušení, nová žádost
set role authenticated; select tt.as_eu(2);
select tt.ok((select (public.my_email_change_request() ->> 'status') = 'open' and public.my_email_change_request() ->> 'new_email' = 'nova@example.cz'
                and not (public.my_email_change_request() ->> 'cancelled')::boolean and public.my_email_change_request() ->> 'handled_at' is null
                and public.my_email_change_request() ->> 'created_at' is not null), 'my_email_change_request: otevřená žádost čeká na správce');
select tt.as_eu(4);
select tt.ok(public.my_email_change_request() is null, 'my_email_change_request: bez žádosti vrátí null');
select tt.ok(public.cancel_my_email_change_request() = '{"ok": true, "cancelled": false}'::jsonb, 'zrušení bez otevřené žádosti: cancelled = false');
select tt.as_eu(2);
select tt.ok(public.cancel_my_email_change_request() = '{"ok": true, "cancelled": true}'::jsonb, 'zrušení otevřené žádosti: cancelled = true');
select tt.ok(public.cancel_my_email_change_request() = '{"ok": true, "cancelled": false}'::jsonb, 'druhé zrušení už nic nezruší');
select tt.ok((select (public.my_email_change_request() ->> 'status') = 'dismissed' and (public.my_email_change_request() ->> 'cancelled')::boolean and public.my_email_change_request() ->> 'handled_at' is not null),
  'my_email_change_request: zrušená žádost = dismissed + cancelled + čas vyřízení');
select public.request_email_change('other@example.cz') as r \gset
reset role;
select tt.ok((:'r'::jsonb ->> 'id')::uuid = tt.req_id(2) and (select count(*) from public.admin_notifications where user_id = tt.eu(2) and status = 'open') = 1, 'po zrušení jde poslat novou žádost');
set role authenticated; select tt.as_eu(2);
select tt.ok((select (public.my_email_change_request() ->> 'status') = 'open' and public.my_email_change_request() ->> 'new_email' = 'other@example.cz' and not (public.my_email_change_request() ->> 'cancelled')::boolean),
  'my_email_change_request vrací poslední žádost');
select tt.as_eu(3);
select tt.ok(public.my_email_change_request() is null, 'žádost jiného uživatele se nepromítne cizímu účtu');
reset role;

-- denní limit: nejvýš 3 žádosti za 24 hodin (zrušená se počítá dál)
set role authenticated; select tt.as_eu(5);
select public.request_email_change('k1@x.cz'); select public.cancel_my_email_change_request();
select public.request_email_change('k2@x.cz'); select public.cancel_my_email_change_request();
select public.request_email_change('k3@x.cz'); select public.cancel_my_email_change_request();
select tt.fails($$select public.request_email_change('k4@x.cz')$$, 'too_many_requests', 'čtvrtá žádost za 24 hodin: too_many_requests (zrušené se počítají)');
reset role;
update public.admin_notifications set created_at = now() - interval '25 hours' where id = (select id from public.admin_notifications where user_id = tt.eu(5) order by created_at limit 1);
set role authenticated; select tt.as_eu(5);
select public.request_email_change('k4@x.cz');
select public.cancel_my_email_change_request();
select tt.fails($$select public.request_email_change('k5@x.cz')$$, 'too_many_requests', 'žádost starší než 24 hodin se do limitu nepočítá (znovu limit, až jsou tři nové)');
reset role;
select tt.ok((select count(*) from public.admin_notifications where user_id = tt.eu(5)) = 4, 'limit nezapsal nic navíc');

-- společný strop: nejvýš 200 otevřených žádostí všech uživatelů dohromady
insert into public.admin_notifications (kind, user_id, title)
  select 'email_change_request', gen_random_uuid(), 'Zahlcení'
    from generate_series(1, 199 - (select count(*) from public.admin_notifications where kind = 'email_change_request' and status = 'open')::int);
select tt.ok((select count(*) from public.admin_notifications where kind = 'email_change_request' and status = 'open') = 199, 'příprava stropu: 199 otevřených žádostí');
set role authenticated; select tt.as_eu(11);
select public.request_email_change('marek-strop@x.cz') as r \gset
select tt.ok((:'r'::jsonb ->> 'ok')::boolean, 'pod stropem (199 otevřených) jde žádost poslat');
select tt.as_eu(9);
select tt.fails($$select public.request_email_change('tomas-strop@x.cz')$$, 'too_many_requests', 'při 200 otevřených žádostech všech uživatelů dohromady: too_many_requests');
reset role;
delete from public.admin_notifications where kind = 'email_change_request' and (title = 'Zahlcení' or user_id = tt.eu(11));
select tt.ok((select count(*) from public.admin_notifications where kind = 'email_change_request' and user_id = tt.eu(9)) = 0, 'strop nic nezapsal a úklid vrátil stav před zkouškou');

-- obsazený e-mail: čtenář chybu nedostane, správce uvidí conflict
set role authenticated; select tt.as_eu(4);
select public.request_email_change('Drzitel@X.cz') as r \gset
reset role;
select tt.ok((:'r'::jsonb ->> 'ok')::boolean and (select (payload ->> 'conflict')::boolean and payload ->> 'new_email' = 'drzitel@x.cz' from public.admin_notifications where id = tt.req_id(4)),
  'e-mail užívaný jiným účtem: čtenář chybu nedostane (nelze zjišťovat registrace), v upozornění je conflict = true');
set role authenticated; select tt.as_eu(3);
select public.request_email_change('Zadost@X.cz', '   ');
reset role;
select tt.ok((select body is null and status = 'open' from public.admin_notifications where id = tt.req_id(3)), 'vzkaz jen z mezer se neuloží');

-- ===== správce: chyby (každá musí skončit beze změny) =====
set role authenticated;
select tt.as_eu(2);
select tt.fails(format('select public.admin_change_email(%L, %L)', tt.eu(3), 'nove@x.cz'), 'forbidden', 'admin_change_email: čtenář není správce -> forbidden');
select tt.fails(format('select public.admin_reject_email_change(%L)', tt.req_id(3)), 'forbidden', 'admin_reject_email_change: čtenář není správce -> forbidden');
select tt.no_user();
select tt.fails(format('select public.admin_change_email(%L, %L)', tt.eu(3), 'nove@x.cz'), 'forbidden', 'admin_change_email: nepřihlášený -> forbidden');
select tt.as_eu(1);
select tt.fails(format('select public.admin_change_email(%L, %L)', tt.eu(1), 'nove@x.cz'), 'cannot_change_own_email', 'správce nemění vlastní e-mail: cannot_change_own_email');
select tt.fails(format('select public.admin_change_email(%L, %L)', tt.eu(999), 'nove@x.cz'), 'user_not_found', 'neznámý účet: user_not_found');
select tt.fails(format('select public.admin_change_email(%L, %L)', tt.eu(3), v), 'invalid_email', 'admin_change_email: neplatný e-mail ' || coalesce('„' || left(v, 20) || '“', 'null'))
  from unnest(array['', 'nesmysl', 'a@b', 'a b@x.cz', 'a@b..c', 'a@.b.c', 'a@b.c.', repeat('a', 250) || '@x.cz', null]) as v;
select tt.fails(format('select public.admin_change_email(%L, %L)', tt.eu(999), 'nesmysl'), 'invalid_email', 'neplatný e-mail se kontroluje dřív než účet');
select tt.fails(format('select public.admin_change_email(%L, %L)', tt.eu(2), 'JANA@example.cz'), 'same_email', 'stejný e-mail (jiná velikost písmen): same_email');
select tt.fails(format('select public.admin_change_email(%L, %L)', tt.eu(3), v), 'email_taken', 'e-mail cizího účtu ' || v || ': email_taken')
  from unnest(array['drzitel@x.cz', 'DRZITEL@x.cz', '  Drzitel@X.cz ']) as v;
select tt.fails(format('select public.admin_change_email(%L, %L)', tt.eu(3), 'ident@x.cz'), 'email_taken', 'e-mail jen v auth.identities cizího účtu: email_taken');
select tt.fails(format('select public.admin_change_email(%L, %L)', tt.eu(3), 'Profil@x.cz'), 'email_taken', 'e-mail jen v profiles cizího účtu: email_taken');
select tt.fails(format('select public.admin_change_email(%L, %L)', tt.eu(3), 'JenUsers@x.cz'), 'email_taken', 'e-mail jen v auth.users cizího účtu (bez identity a profilu): email_taken');
select tt.fails(format('select public.admin_change_email(%L, %L, %L)', tt.eu(4), 'drzitel@x.cz', tt.req_id(4)), 'email_taken', 'žádost s obsazeným e-mailem (conflict) nejde provést: email_taken');
select tt.fails(format('select public.admin_change_email(%L, %L, %L)', tt.eu(3), 'petr-new@x.cz', gen_random_uuid()), 'notification_not_found', 'neexistující upozornění: notification_not_found');
select tt.fails(format('select public.admin_change_email(%L, %L, %L)', tt.eu(3), 'other@example.cz', tt.req_id(2)), 'notification_not_found', 'upozornění jiného uživatele: notification_not_found');
reset role;
insert into public.admin_notifications (kind, user_id, title) values ('password_help', tt.eu(3), 'Žádost o heslo');
set role authenticated; select tt.as_eu(1);
select tt.fails(format('select public.admin_change_email(%L, %L, %L)', tt.eu(3), 'petr-new@x.cz', tt.req_id(3)), 'email_mismatch', 'e-mail v žádosti se musí shodovat s tím, co správce zadá: email_mismatch');
select tt.fails(format('select public.admin_change_email(%L, %L, %L)', tt.eu(2), 'jiny@example.cz', tt.req_id(2)), 'email_mismatch', 'správce zadá jiný e-mail, než o jaký žádost je (čeká other@example.cz): email_mismatch');
select tt.fails(format('select public.admin_change_email(%L, %L, %L)', tt.eu(5), 'karel-nove@x.cz', tt.req_id(5)), 'already_handled', 'už vyřízená (zrušená) žádost: already_handled');
reset role;
select tt.fails(format('select public.admin_change_email(%L, %L, %L)', tt.eu(3), 'petr-new@x.cz', (select id from public.admin_notifications where kind = 'password_help')), 'notification_not_found', 'upozornění jiného druhu: notification_not_found');
delete from public.admin_notifications where kind = 'password_help';

-- ===== správce: provedení změny z žádosti =====
select tt.snap_others(2) as others \gset
set role authenticated; select tt.as_eu(1);
select public.admin_change_email(tt.eu(2), '  Other@Example.CZ ', tt.req_id(2)) as r \gset
reset role;
select tt.ok(:'r'::jsonb = '{"old_email": "Jana@Example.cz", "new_email": "other@example.cz", "username": "jana"}'::jsonb, 'výsledek: dosavadní e-mail, nový e-mail (malými písmeny) a uživatelské jméno');
select tt.ok((select email = 'other@example.cz' and email_confirmed_at = '2026-01-02 03:04:05+00' and updated_at > now() - interval '1 minute' from auth.users where id = tt.eu(2)),
  'auth.users.email se změní (malými písmeny), dřívější potvrzení e-mailu zůstane');
select tt.ok((select email_change = '' and email_change_token_new = '' and email_change_token_current = '' and email_change_sent_at is null and email_change_confirm_status = 0 from auth.users where id = tt.eu(2)),
  'nedokončená změna přes odkaz se vyčistí (email_change*)');
select tt.ok((select raw_user_meta_data = '{"email": "other@example.cz", "sub": "x"}'::jsonb from auth.users where id = tt.eu(2)), 'raw_user_meta_data.email se přepíše, ostatní klíče zůstanou');
select tt.ok((select identity_data = jsonb_build_object('email', 'other@example.cz', 'sub', tt.eu(2)) and provider_id = tt.eu(2)::text and email = 'other@example.cz' from auth.identities where user_id = tt.eu(2)),
  'auth.identities: identity_data.email se změní, provider_id (id uživatele) zůstane');
select tt.ok((select email = 'other@example.cz' from public.profiles where id = tt.eu(2)), 'profiles.email se srovná spouštěčem');
select tt.ok((select status = 'done' and handled_by = tt.eu(1) and handled_at is not null and payload ->> 'new_email' = 'other@example.cz' from public.admin_notifications where id = tt.req_id(2)) and (select count(*) from public.admin_notifications where status = 'done') = 1,
  'žádost se zavře (done), zapíše se správce a čas, jiné žádosti zůstanou');
select tt.ok((select count(*) = 1 and bool_and(title !~ '@' and coalesce(body, '') !~ '@' and title !~* 'other' and coalesce(body, '') !~* 'other' and read_at is null) from public.user_notifications where user_id = tt.eu(2) and kind = 'email_changed'),
  'čtenář dostane právě jedno upozornění email_changed bez e-mailové adresy');
select tt.ok((select count(*) from public.user_notifications where kind = 'email_changed') = 1, 'jiným uživatelům žádné upozornění nepřijde');
select tt.ok((select count(*) = 1 and bool_and(log_type = 'WARN' and message like '%jana%' and message !~ '@') from public.system_logs), 'do systémového deníku přibude jeden záznam bez e-mailové adresy');
select tt.ok(tt.snap_others(2) = :'others', 'cizí účty (auth.users, identities, profiles) se nezměnily');
set role authenticated; select tt.as_eu(2);
select tt.ok((select (public.my_email_change_request() ->> 'status') = 'done' and not (public.my_email_change_request() ->> 'cancelled')::boolean and public.my_email_change_request() ->> 'handled_at' is not null),
  'čtenář vidí žádost jako vyřízenou (done)');
-- po vyřízení jde poslat další žádost
select public.request_email_change('jana-druha@example.cz');
select tt.fails($$select public.request_email_change('other@example.cz')$$, 'same_email', 'nový e-mail je teď dosavadním: same_email');
select public.cancel_my_email_change_request();
reset role;

-- přímá změna z detailu účtu bez žádosti; nepotvrzený účet, identita s e-mailem v provider_id, bez klíče email v metadatech
select tt.snap_others(3) as others \gset
set role authenticated; select tt.as_eu(1);
select public.admin_change_email(tt.eu(3), 'PETR-new@x.cz') as r \gset
reset role;
select tt.ok(:'r'::jsonb = '{"old_email": "petr@x.cz", "new_email": "petr-new@x.cz", "username": "petr"}'::jsonb, 'přímá změna: výsledek');
select tt.ok((select email = 'petr-new@x.cz' and email_confirmed_at > now() - interval '1 minute' from auth.users where id = tt.eu(3)), 'nepotvrzený účet: nový e-mail se bere jako potvrzený (čas potvrzení se nastaví)');
select tt.ok((select raw_user_meta_data = '{}'::jsonb from auth.users where id = tt.eu(3)), 'raw_user_meta_data bez klíče email se nezmění (klíč se nepřidá)');
select tt.ok((select provider_id = 'petr-new@x.cz' and identity_data ->> 'email' = 'petr-new@x.cz' and email = 'petr-new@x.cz' from auth.identities where user_id = tt.eu(3)), 'provider_id s dosavadním e-mailem se přepíše spolu s identity_data.email');
select tt.ok((select email = 'petr-new@x.cz' from public.profiles where id = tt.eu(3)), 'přímá změna: profiles.email sedí');
select tt.ok((select status = 'done' and handled_by = tt.eu(1) from public.admin_notifications where id = tt.req_id(3)), 'přímá změna zavře i otevřenou žádost téhož uživatele');
select tt.ok((select count(*) from public.user_notifications where user_id = tt.eu(3) and kind = 'email_changed') = 1 and (select count(*) from public.system_logs) = 2, 'přímá změna: upozornění čtenáři a druhý záznam v deníku');
select tt.ok(tt.snap_others(3) = :'others', 'přímá změna: cizí účty se nezměnily');

-- jiná (ne e-mailová) identita zůstane, metadata s klíčem email se přepíšou
select tt.snap_others(4) as others \gset
select identity_data::text as g_data, provider_id as g_pid from auth.identities where user_id = tt.eu(4) and provider = 'google' \gset
set role authenticated; select tt.as_eu(1);
select public.admin_change_email(tt.eu(4), 'EVA-Nova@x.cz') as r \gset
reset role;
select tt.ok((select raw_user_meta_data = '{"email": "eva-nova@x.cz"}'::jsonb from auth.users where id = tt.eu(4)), 'metadata s klíčem email: přepíše se na nový e-mail');
select tt.ok((select identity_data::text = :'g_data' and provider_id = :'g_pid' from auth.identities where user_id = tt.eu(4) and provider = 'google'), 'identita jiného poskytovatele (google) zůstane beze změny');
select tt.ok((select identity_data ->> 'email' = 'eva-nova@x.cz' and provider_id = tt.eu(4)::text from auth.identities where user_id = tt.eu(4) and provider = 'email'), 'e-mailová identita se změní');
select tt.ok((select status = 'done' from public.admin_notifications where id = tt.req_id(4)), 'přímá změna zavře i otevřenou žádost s obsazeným e-mailem (conflict)');
select tt.ok(tt.snap_others(4) = :'others', 'cizí účty se nezměnily ani při změně účtu s více identitami');
set role authenticated; select tt.as_eu(1);
select tt.fails(format('select public.admin_change_email(%L, %L)', tt.eu(2), 'eva-nova@x.cz'), 'email_taken', 'změněný e-mail je hned obsazený pro ostatní: email_taken');
reset role;

-- ===== profile_email_not_synced: když se profil nedá srovnat, vrátí se celá změna =====
create or replace function tt.block_profile_email() returns trigger language plpgsql as $$ begin return null; end $$;
grant execute on all functions in schema tt to public;
select tt.as_eu(1);
do $$ declare v_before text := tt.snap(); begin
  begin
    drop trigger trg_sync_profile_email on auth.users;
    create trigger tt_block_profile_email before update of email on public.profiles for each row execute function tt.block_profile_email();
    set local role authenticated;
    perform public.admin_change_email(tt.eu(9), 'tomas-new@x.cz');
    raise exception 'mělo selhat';
  exception when others then
    if sqlerrm <> 'profile_email_not_synced' then raise; end if;
  end;
  reset role;
  perform tt.ok(tt.snap() = v_before and (select count(*) from pg_trigger where tgname = 'trg_sync_profile_email' and tgrelid = 'auth.users'::regclass) = 1
                and (select count(*) from pg_trigger where tgname = 'tt_block_profile_email') = 0,
    'profil nejde srovnat: profile_email_not_synced a nic se nezměnilo (auth.users, identities ani upozornění)');
end $$;
-- bez spouštěče, ale s možností zápisu do profilu: e-mail v profilu dorovná sama funkce
do $$ begin
  begin
    drop trigger trg_sync_profile_email on auth.users;
    set local role authenticated;
    perform public.admin_change_email(tt.eu(9), 'tomas-new@x.cz');
    reset role;
    perform tt.ok((select email from public.profiles where id = tt.eu(9)) = 'tomas-new@x.cz' and (select email from auth.users where id = tt.eu(9)) = 'tomas-new@x.cz', 'bez spouštěče dorovná profiles.email sama funkce');
    raise exception 'zpět';
  exception when others then
    if sqlerrm <> 'zpět' then raise; end if;
  end;
  reset role;
  perform tt.ok((select email from public.profiles where id = tt.eu(9)) = 'tomas@x.cz' and (select count(*) from pg_trigger where tgname = 'trg_sync_profile_email') = 1, 'zkouška bez spouštěče se vrátila (spouštěč je zpět)');
end $$;

-- ===== správce: zamítnutí =====
set role authenticated; select tt.as_eu(10);
select tt.fails(format('select public.admin_reject_email_change(%L)', gen_random_uuid()), 'forbidden', 'zamítnutí čtenářem: forbidden');
select public.request_email_change('lenka-nova@x.cz', 'prosím');
select tt.as_eu(1);
select tt.fails(format('select public.admin_reject_email_change(%L)', gen_random_uuid()), 'notification_not_found', 'zamítnutí neexistující žádosti: notification_not_found');
reset role;
insert into public.admin_notifications (kind, user_id, title) values ('password_help', tt.eu(10), 'Žádost o heslo');
select id as ph_id from public.admin_notifications where kind = 'password_help' \gset
set role authenticated; select tt.as_eu(1);
select tt.fails(format('select public.admin_reject_email_change(%L)', null::uuid), 'notification_not_found', 'zamítnutí bez id: notification_not_found');
select public.admin_reject_email_change(tt.req_id(10)) as r \gset
reset role;
select tt.ok(:'r'::jsonb = '{"success": true}'::jsonb, 'zamítnutí vrátí success');
select tt.ok((select status = 'dismissed' and handled_by = tt.eu(1) and handled_at is not null and not payload ? 'cancelled' from public.admin_notifications where id = tt.req_id(10)), 'zamítnutá žádost je dismissed se správcem a časem');
select tt.ok((select email = 'lenka@x.cz' from auth.users where id = tt.eu(10)) and (select email = 'lenka@x.cz' from public.profiles where id = tt.eu(10)), 'zamítnutí e-mail účtu nezmění');
select tt.ok((select count(*) = 1 and bool_and(title = 'Žádost o změnu e-mailu zamítnuta' and body = 'Kdyby to byl omyl, pošli žádost znovu a připiš vzkaz.' and title !~ '@' and body !~ '@') from public.user_notifications where user_id = tt.eu(10) and kind = 'email_change_rejected'),
  'čtenář dostane upozornění email_change_rejected s výchozím textem');
select tt.ok((select count(*) from public.system_logs) = 3, 'zamítnutí nic nezapisuje do systémového deníku');
select tt.fails(format('select public.admin_reject_email_change(%L)', tt.req_id(10)), 'already_handled', 'zamítnutí už vyřízené žádosti: already_handled');
set role authenticated; select tt.as_eu(1);
select tt.fails(format('select public.admin_change_email(%L, %L, %L)', tt.eu(10), 'lenka-nova@x.cz', tt.req_id(10)), 'already_handled', 'zamítnutou žádost už nejde provést: already_handled');
select tt.fails(format('select public.admin_reject_email_change(%L)', :'ph_id'::uuid), 'notification_not_found', 'upozornění jiného druhu se tady nezamítá: notification_not_found');
select tt.as_eu(10);
select tt.ok((select (public.my_email_change_request() ->> 'status') = 'dismissed' and not (public.my_email_change_request() ->> 'cancelled')::boolean), 'čtenář vidí zamítnutou žádost (dismissed, ne zrušenou jím samým)');
select public.request_email_change('lenka-druha@x.cz');
select tt.as_eu(1);
select public.admin_reject_email_change(tt.req_id(10), '   ');
reset role;
select tt.ok((select count(*) = 2 and count(*) filter (where body = 'Kdyby to byl omyl, pošli žádost znovu a připiš vzkaz.') = 2 from public.user_notifications where user_id = tt.eu(10) and kind = 'email_change_rejected'), 'prázdný důvod z mezer = výchozí text; po zamítnutí jde poslat novou žádost');
set role authenticated; select tt.as_eu(11);
select public.request_email_change('marek-novy@x.cz');
select tt.as_eu(1);
select public.admin_reject_email_change(tt.req_id(11), '  Tuhle schránku nemáš ověřenou.  ');
reset role;
select tt.ok((select count(*) = 1 and bool_and(body = 'Tuhle schránku nemáš ověřenou.') from public.user_notifications where user_id = tt.eu(11) and kind = 'email_change_rejected'), 'zadaný důvod se čtenáři předá (oříznutý o mezery)');
select tt.ok((select count(*) from public.user_notifications where user_id = tt.eu(11)) = 1 and (select count(*) from public.user_notifications where user_id = tt.eu(2) and kind = 'email_change_rejected') = 0, 'upozornění o zamítnutí dostane jen autor žádosti');

-- účet bez profilu: e-mail se změní, profil se nevytvoří, v deníku je zkrácené id místo uživatelského jména
set role authenticated; select tt.as_eu(1);
select public.admin_change_email(tt.eu(13), 'bezprofilu-new@x.cz');
reset role;
select tt.ok((select email = 'bezprofilu-new@x.cz' from auth.users where id = tt.eu(13)) and not exists (select 1 from public.profiles where id = tt.eu(13)), 'účet bez profilu: e-mail se změní a profil se nevytvoří');
select tt.ok((select message from public.system_logs order by id desc limit 1) = 'Správce změnil e-mail účtu „00000000“.', 'účet bez profilu: v deníku je zkrácené id místo uživatelského jména');

-- ===== oprávnění =====
select tt.ok((select bool_and(not has_function_privilege('anon', s, 'execute') and has_function_privilege('authenticated', s, 'execute'))
                from unnest(array['public.request_email_change(text, text)', 'public.my_email_change_request()', 'public.cancel_my_email_change_request()',
                                  'public.admin_change_email(uuid, text, uuid)', 'public.admin_reject_email_change(uuid, text)']) s),
  'všech 5 funkcí: nepřihlášený (anon) je nespustí, přihlášený ano');
set role anon;
select tt.fails($$select public.request_email_change('a@b.cz')$$, '42501', 'nepřihlášený nemůže poslat žádost');
select tt.fails($$select public.admin_change_email('00000000-0000-0000-0000-000000000002', 'a@b.cz')$$, '42501', 'nepřihlášený nemůže změnit e-mail');
reset role;

-- ===== úklid: po testu nezůstanou účty ani upozornění (další kroky run.sh počítají s účty z push testů) =====
delete from public.profiles where id between tt.eu(0) and tt.eu(899);
delete from auth.identities where user_id between tt.eu(0) and tt.eu(899);
delete from auth.users where id between tt.eu(0) and tt.eu(899);
truncate public.admin_notifications, public.user_notifications, public.system_logs, net.calls restart identity;
