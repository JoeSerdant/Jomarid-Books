-- SQL testy db/security-hardening.sql: na zkušební databázi, která má stejné díry jako skutečná (nález z db/security-diagnostics.sql), ověří, že zpevnění
-- díry zavře, nic z toho, co appka používá, nerozbije a jde spustit víckrát. Spouští se přes db/tests/run.sh jako poslední (smaže a znovu založí schéma public).
\set ON_ERROR_STOP on
create schema if not exists tt;
grant usage on schema tt to public;
create or replace function tt.ok(c boolean, msg text) returns void language plpgsql as $$ begin if c is not true then raise exception 'SELHALO: %', msg; end if; raise notice 'OK   %', msg; end $$;
create or replace function tt.su(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-' || lpad((950 + n)::text, 12, '0'))::uuid $$;

-- Spustí příkaz pod danou rolí a uživatelem (jako PostgREST) a vždy ho vrátí zpět. Výsledek: 'ok' (u p_check 'ok:' + hodnota dotazu) nebo '<sqlstate>:<hláška>'.
create or replace function tt.as_(p_role text, p_uid uuid, p_sql text, p_check text default null) returns text language plpgsql as $$
declare v text; v_val text;
begin
  begin
    perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
    execute 'set local role ' || quote_ident(p_role);
    execute p_sql;
    v := 'ok';
    if p_check is not null then execute p_check into v_val; v := 'ok:' || coalesce(v_val, '<null>'); end if;
    raise exception 'tt_rollback';
  exception when others then
    if sqlerrm <> 'tt_rollback' then v := sqlstate || ':' || sqlerrm; end if;
  end;
  return v;
end $$;

-- ---------------------------------------------------------------------------
-- Zkušební databáze "jako skutečná": děravá práva (Supabase otevírá všechno pro anon i authenticated), politiky podle skutečné databáze, staré funkce.
-- ---------------------------------------------------------------------------
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to service_role;

alter table public.profiles
  add column if not exists highest_goal_ever int, add column if not exists highest_goal_completed int default 5, add column if not exists bonus_xp int default 0,
  add column if not exists fake_xp int default 0, add column if not exists unlocked_badges text[] default '{}', add column if not exists must_change_password boolean default false,
  add column if not exists last_goal_change_date timestamptz, add column if not exists goal_updated_at timestamptz, add column if not exists featured_badge text;
alter table public.user_books add column if not exists last_read_at timestamptz;
create unique index if not exists tt_user_books_uq on public.user_books (user_id, book_id);
create table public.book_ratings (id uuid primary key default gen_random_uuid(), user_id uuid not null, book_id uuid not null, rating int, updated_at timestamptz default now());
create table public.site_settings (key text primary key, value jsonb);
create table public.admin_temp_passwords (id uuid primary key default gen_random_uuid(), user_id uuid, password_hash text);
create table public.comment_reports (id uuid primary key default gen_random_uuid(), comment_id uuid, reason text);
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;

do $$ declare t text; begin
  foreach t in array array['profiles', 'books', 'user_books', 'coin_transactions', 'user_daily_activity', 'user_notifications', 'admin_notifications', 'system_logs', 'book_ratings', 'site_settings', 'admin_temp_passwords', 'comment_reports'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;
create policy profiles_select on public.profiles for select to authenticated using (auth.uid() = id or public.app_current_role() = 'správce');
create policy profiles_insert_self on public.profiles for insert to authenticated with check (auth.uid() = id and (role is null or role = 'uživatel'));
create policy profiles_update on public.profiles for update to authenticated using (auth.uid() = id or public.app_current_role() = 'správce') with check (auth.uid() = id or public.app_current_role() = 'správce');
create policy user_books_select on public.user_books for select to authenticated using (auth.uid() = user_id or is_read = true or public.app_current_role() = 'správce');
create policy user_books_insert on public.user_books for insert to authenticated with check (auth.uid() = user_id or public.app_current_role() = 'správce');
create policy user_books_update on public.user_books for update to authenticated using (auth.uid() = user_id or public.app_current_role() = 'správce') with check (auth.uid() = user_id or public.app_current_role() = 'správce');
create policy user_books_delete on public.user_books for delete to authenticated using (public.app_current_role() = 'správce');
create policy user_daily_activity_select on public.user_daily_activity for select to authenticated using (true);
create policy book_ratings_select on public.book_ratings for select to authenticated using (true);
create policy book_ratings_insert on public.book_ratings for insert to authenticated with check (auth.uid() = user_id);
create policy book_ratings_update on public.book_ratings for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy books_select_anon on public.books for select to anon using (is_hidden = false);
create policy books_select_auth on public.books for select to authenticated using (is_hidden = false or public.app_current_role() = 'správce');
create policy books_update on public.books for update to authenticated using (public.app_current_role() = 'správce') with check (public.app_current_role() = 'správce');
create policy site_settings_select on public.site_settings for select to anon, authenticated using (true);
create policy site_settings_write on public.site_settings for all to authenticated using (public.app_current_role() = 'správce') with check (public.app_current_role() = 'správce');
create policy admin_notifications_select on public.admin_notifications for select to authenticated using (public.app_current_role() = 'správce');
create policy coin_transactions_select on public.coin_transactions for select to authenticated using (auth.uid() = user_id or public.app_current_role() = 'správce');
create policy coin_transactions_insert on public.coin_transactions for insert to authenticated with check (auth.uid() = user_id);
create policy user_notifications_select on public.user_notifications for select to authenticated using (user_id = auth.uid());
create policy books_select_licensed on public.books for select to authenticated using (exists (select 1 from public.user_books ub where ub.book_id = books.id and ub.user_id = auth.uid()));
create policy system_logs_select on public.system_logs for select to authenticated using (public.app_current_role() = 'správce');
create policy system_logs_insert on public.system_logs for insert to authenticated with check (public.app_current_role() = 'správce');

-- Staré funkce jako ve skutečné databázi: volatelné bez přihlášení, některé bez search_path.
create function public.verify_book_passcode(requested_book_id uuid, provided_passcode text) returns boolean language plpgsql security definer as $$ begin return provided_passcode = 'x'; end $$;
create function public.admin_grant_coins(target_user_id uuid, amount integer, reason text) returns void language plpgsql security definer set search_path to 'public' as $$
begin if public.app_current_role() is distinct from 'správce' then raise exception 'forbidden'; end if; end $$;
create function public.auto_assign_welcome_books() returns trigger language plpgsql security definer as $$ begin return new; end $$;
create function public.make_username_from_email(p_email text, p_exclude uuid) returns text language sql security definer set search_path to 'public' as $$ select split_part(p_email, '@', 1) $$;
create function public.username_available_public(p_username text) returns boolean language sql stable security definer set search_path to 'public' as
$$ select not exists (select 1 from public.profiles where lower(username) = lower(p_username)) $$;
create function public.request_password_help(p_email text, p_username text, p_note text) returns void language plpgsql security definer set search_path to 'public' as
$$ begin insert into public.admin_notifications (kind, title, body) values ('password_request', 'Žádost o heslo', p_email); end $$;
create function public.set_first_completed_at() returns trigger language plpgsql security definer set search_path to 'public' as
$$ begin if new.is_read is true and new.first_completed_at is null then new.first_completed_at := now(); end if; return new; end $$;
create trigger trg_set_first_completed_at before insert or update on public.user_books for each row execute function public.set_first_completed_at();
create function public.tt_public_only() returns int language sql stable as $$ select 1 $$;
revoke execute on function public.tt_public_only() from anon, authenticated;   -- zůstane jen právo PUBLIC (jako u starých funkcí)

create schema if not exists storage;
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
insert into storage.buckets values ('book-texts', 'book-texts', false, 20971520, null), ('books', 'books', false, null, null), ('knihy', 'knihy', false, null, null), ('knizky', 'knizky', true, null, null), ('tt-vlastni', 'tt-vlastni', false, 1000, array['image/png']);
grant usage on schema net to anon, authenticated;
grant select on net.calls to anon, authenticated;
create schema cron;
create table cron.job (jobid int, jobname text, schedule text, active boolean, username text, command text);
grant usage on schema cron to anon, authenticated;
grant select on cron.job to anon, authenticated;

-- Data: správce (1), čtenáři 2, 3 (skrytý ze žebříčku), 4, a účty 5 a 6, kterým se zakládá profil.
insert into auth.users (id, email) select tt.su(n), 'tt' || n || '@x.cz' from generate_series(1, 6) n;
insert into public.profiles (id, role, email, username, show_in_leaderboard) values
  (tt.su(1), 'správce', 'tt1@x.cz', 'tt1', true), (tt.su(2), 'uživatel', 'tt2@x.cz', 'tt2', true), (tt.su(3), 'uživatel', 'tt3@x.cz', 'tt3', false), (tt.su(4), 'uživatel', 'tt4@x.cz', 'tt4', true);
insert into public.books (id, title, price_coins) values ('00000000-0000-0000-0000-00000000b001', 'tt-kniha-1', 0), ('00000000-0000-0000-0000-00000000b002', 'tt-kniha-2', 50);
update public.books set is_hidden = true where id = '00000000-0000-0000-0000-00000000b002';
insert into public.user_books (user_id, book_id, status, is_read, scroll_position, first_completed_at) values
  (tt.su(2), '00000000-0000-0000-0000-00000000b001', 'active', true, 100, date_trunc('month', now()) + interval '1 day'),
  (tt.su(2), '00000000-0000-0000-0000-00000000b002', 'requested', true, 100, date_trunc('month', now()) - interval '40 days'),
  (tt.su(3), '00000000-0000-0000-0000-00000000b001', 'active', true, 100, date_trunc('month', now()) + interval '1 day'),
  (tt.su(4), '00000000-0000-0000-0000-00000000b001', 'active', true, 100, date_trunc('month', now()) + interval '2 days');
insert into public.user_books (user_id, book_id, status, is_read, scroll_position) values (tt.su(2), '00000000-0000-0000-0000-00000000b003', 'active', false, 10);
insert into public.user_daily_activity (user_id, activity_date) values
  (tt.su(2), current_date), (tt.su(2), current_date - 1), (tt.su(3), current_date), (tt.su(4), current_date - 100);
insert into public.book_ratings (user_id, book_id, rating) values (tt.su(2), '00000000-0000-0000-0000-00000000b001', 5), (tt.su(4), '00000000-0000-0000-0000-00000000b001', 3);
insert into public.site_settings values ('tour', '{}'::jsonb);

-- ---------------------------------------------------------------------------
-- PŘED zpevněním: zkušební databáze opravdu je děravá (jinak by testy nic nedokazovaly)
-- ---------------------------------------------------------------------------
select tt.ok(has_function_privilege('anon', 'public.verify_book_passcode(uuid,text)', 'execute'), 'PŘED: anon smí volat verify_book_passcode');
select tt.ok(has_function_privilege('anon', 'public.admin_grant_coins(uuid,integer,text)', 'execute'), 'PŘED: anon smí volat admin_grant_coins');
select tt.ok(has_function_privilege('anon', 'public.set_first_completed_at()', 'execute'), 'PŘED: anon smí volat i spouštěcí funkci');
select tt.ok(has_table_privilege('anon', 'public.profiles', 'insert') and has_table_privilege('authenticated', 'public.books', 'truncate'), 'PŘED: anon smí zapisovat a přihlášený má TRUNCATE');
select tt.ok(tt.as_('authenticated', tt.su(2), $q$update public.profiles set highest_goal_ever = 99 where id = tt.su(2)$q$) = 'ok', 'PŘED: čtenář si smí přepsat highest_goal_ever');
select tt.ok(tt.as_('authenticated', tt.su(2), $q$update public.user_books set status = 'active' where user_id = tt.su(2) and status = 'requested'$q$) = 'ok', 'PŘED: čtenář si smí přepsat status své knihy');
select tt.ok(tt.as_('authenticated', tt.su(5), $q$insert into public.profiles (id, email, role, coins) values (tt.su(5), 'x@x.cz', 'uživatel', 999999)$q$) = 'ok', 'PŘED: nový účet si smí vložit profil s libovolnými mincemi');
select tt.ok(tt.as_('authenticated', tt.su(2), $q$select 1$q$, $q$select count(*) from public.user_books where user_id <> tt.su(2)$q$) <> 'ok:0', 'PŘED: čtenář vidí cizí řádky user_books');


-- Otisk všech práv, která zpevnění mění (tabulky, sekvence, funkce, schémata, výchozí práva, politiky, buckety, ochranné spouště): před zpevněním a po návratu zpět se musí rovnat.
create or replace function tt.fp() returns text language sql as $$
  select md5(coalesce(string_agg(x, '|' order by x), '')) from (
    select 'R:' || n.nspname || '.' || c.relname || ':' || case when a.grantee = 0 then 'public' else pg_get_userbyid(a.grantee) end || ':' || a.privilege_type as x
      from pg_class c join pg_namespace n on n.oid = c.relnamespace cross join lateral aclexplode(c.relacl) a
      where n.nspname in ('public', 'net', 'cron') and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S') and c.relname <> 'security_hardening_backup' and (a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon', 'authenticated'))
    union all
    select 'F:' || n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || '):' || g.g || ':' || g.pr
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      cross join lateral (
        select case when a.grantee = 0 then 'public' else pg_get_userbyid(a.grantee) end as g, a.privilege_type as pr from aclexplode(p.proacl) a where a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon', 'authenticated')
        union all select 'public', 'EXECUTE' where p.proacl is null) g
      where n.nspname in ('public', 'net', 'cron') and p.proname not in ('leaderboard_reads', 'leaderboard_activity') and p.proname !~ '^guard_(profiles|user_books|admin_notifications)'
    union all
    select 'S:' || n.nspname || ':' || case when a.grantee = 0 then 'public' else pg_get_userbyid(a.grantee) end || ':' || a.privilege_type
      from pg_namespace n cross join lateral aclexplode(n.nspacl) a where n.nspname in ('public', 'net', 'cron') and (a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon', 'authenticated'))
    union all
    select 'D:' || pg_get_userbyid(d.defaclrole) || ':' || coalesce(d.defaclnamespace::regnamespace::text, '*') || ':' || d.defaclobjtype::text || ':' || case when a.grantee = 0 then 'public' else pg_get_userbyid(a.grantee) end || ':' || a.privilege_type
      from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a where a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon', 'authenticated')
    union all
    select 'P:' || tablename || ':' || policyname || ':' || coalesce(qual, '') from pg_policies where schemaname = 'public'
    union all
    select 'B:' || id || ':' || public::text || ':' || coalesce(file_size_limit::text, '-') || ':' || coalesce(allowed_mime_types::text, '-') from storage.buckets
    union all
    select 'T:' || tgname from pg_trigger where tgname like 'trg\_00\_guard%'
  ) q $$;
select tt.fp() as fp_before \gset

-- ---------------------------------------------------------------------------
-- Zpevnění (dvakrát za sebou ve stejném spojení)
-- ---------------------------------------------------------------------------
\ir ../security-hardening.sql
select count(*) as log1 from pg_temp._hard_log where sekce = 'Kontrola' \gset
select tt.ok(not exists (select 1 from pg_temp._hard_log where stav in ('CHYBA', 'SELHALO', 'UPOZORNĚNÍ')), 'zpevnění doběhlo bez chyby a bez upozornění (a všechny kontroly na konci prošly)');
select tt.ok(exists (select 1 from pg_temp._hard_log where sekce = 'Soukromí' and stav = 'INFO' and detail like '%books_select_licensed%'), 'skript vypíše politiky jiných tabulek, které sahají na zúžené tabulky (books_select_licensed)');
select tt.ok((select count(*) from pg_temp._hard_log where sekce = 'Kontrola' and stav = 'OK') >= 8, 'závěrečná kontrola skriptu hlásí OK u všech bodů');
\ir ../security-hardening.sql
select count(*) as log2 from pg_temp._hard_log where sekce = 'Kontrola' \gset
select count(*) as zmeny2 from pg_temp._hard_log where stav = 'ZMĚNA' and sekce in ('Funkce', 'Tabulky') and detail !~ '^(Zavřeno pro nepřihlášené|Nepřihlášeným|Odebrán TRUNCATE|Spouštěcí funkce zavřené)' \gset
select tt.ok(not exists (select 1 from pg_temp._hard_log where stav in ('CHYBA', 'SELHALO', 'UPOZORNĚNÍ')), 'druhé spuštění taky bez chyby (jde pouštět víckrát)');
select tt.ok(:log1 = :log2 and :log1 >= 8, 'druhé spuštění dá stejnou závěrečnou kontrolu (starý výsledek se smaže)');
select tt.ok(:zmeny2 = 0, 'druhé spuštění už nemá co měnit (žádný nový search_path ani odebrané právo na příkaz)');

-- ---------------------------------------------------------------------------
-- Funkce
-- ---------------------------------------------------------------------------
select tt.ok(not has_function_privilege('anon', 'public.verify_book_passcode(uuid,text)', 'execute') and not has_function_privilege('authenticated', 'public.verify_book_passcode(uuid,text)', 'execute'), 'verify_book_passcode je zavřená pro anon i přihlášené');
select tt.ok(not has_function_privilege('anon', 'public.admin_grant_coins(uuid,integer,text)', 'execute') and has_function_privilege('authenticated', 'public.admin_grant_coins(uuid,integer,text)', 'execute'), 'admin_grant_coins: anon ne, přihlášený (správce) ano');
select tt.ok(not has_function_privilege('anon', 'public.app_current_role()', 'execute') and has_function_privilege('authenticated', 'public.app_current_role()', 'execute'), 'app_current_role: anon ne, přihlášený ano (politiky ji potřebují)');
select tt.ok(has_function_privilege('anon', 'public.username_available_public(text)', 'execute') and has_function_privilege('anon', 'public.request_password_help(text,text,text)', 'execute'), 'dvě veřejné funkce (registrace, pomoc s heslem) zůstaly volatelné bez přihlášení');
select tt.ok(not has_function_privilege('anon', 'public.set_first_completed_at()', 'execute') and not has_function_privilege('authenticated', 'public.set_first_completed_at()', 'execute'), 'spouštěcí funkce nejde volat ani anon, ani přihlášenému');
select tt.ok(not has_function_privilege('authenticated', 'public.make_username_from_email(text,uuid)', 'execute'), 'pomocná make_username_from_email je zavřená pro přihlášené');
select tt.ok(has_function_privilege('authenticated', 'public.tt_public_only()', 'execute') and not has_function_privilege('anon', 'public.tt_public_only()', 'execute'), 'funkce s právem jen přes PUBLIC: přihlášený o ni nepřišel, anon ano');
select tt.ok((select bool_and(proconfig::text like '%search_path%') from pg_proc where proname in ('verify_book_passcode', 'auto_assign_welcome_books')), 'funkce SECURITY DEFINER bez search_path ho dostaly');
select tt.ok(tt.as_('anon', null, $q$select public.verify_book_passcode(null, 'x')$q$) like '42501:%', 'anon při volání verify_book_passcode dostane "permission denied"');
select tt.ok(tt.as_('anon', null, $q$select public.username_available_public('nejaky')$q$, $q$select 1$q$) = 'ok:1', 'anon si pořád ověří volné uživatelské jméno');
select tt.ok(tt.as_('authenticated', tt.su(1), $q$select public.admin_grant_coins(tt.su(2), 5, 'x')$q$) = 'ok', 'správce pořád zavolá admin_grant_coins');
select tt.ok(tt.as_('authenticated', tt.su(2), $q$select public.admin_grant_coins(tt.su(2), 5, 'x')$q$) = 'P0001:forbidden', 'čtenář admin_grant_coins zavolá, ale funkce ho odmítne (kontrola role)');

-- ---------------------------------------------------------------------------
-- Tabulky: anon
-- ---------------------------------------------------------------------------
select tt.ok(tt.as_('anon', null, $q$select 1$q$, $q$select count(*) from public.books$q$) = 'ok:1', 'anon pořád čte katalog (viditelné knihy)');
select tt.ok(tt.as_('anon', null, $q$select 1$q$, $q$select count(*) from public.site_settings$q$) = 'ok:1', 'anon pořád čte nastavení appky');
select tt.ok(tt.as_('anon', null, $q$select count(*) from public.profiles$q$) like '42501:permission denied%', 'anon nemá přístup k profilům');
select tt.ok(tt.as_('anon', null, $q$insert into public.site_settings values ('x', '{}')$q$) like '42501:permission denied%', 'anon nesmí zapisovat do nastavení (zavřeno na úrovni práv, ne až politikou)');
select tt.ok(tt.as_('anon', null, $q$insert into public.books (title) values ('x')$q$) like '42501:permission denied%', 'anon nesmí zapisovat ani do knih');
select tt.ok(not exists (select 1 from information_schema.table_privileges where grantee = 'anon' and table_schema = 'public' and privilege_type <> 'SELECT'), 'anon nemá v public žádné jiné právo než SELECT');
select tt.ok(not exists (select 1 from information_schema.table_privileges where grantee = 'anon' and table_schema = 'public' and table_name not in ('books', 'site_settings')), 'anon smí číst jen books a site_settings');
select tt.ok(not exists (select 1 from information_schema.table_privileges where grantee = 'authenticated' and table_schema = 'public' and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')), 'přihlášený nemá TRUNCATE, REFERENCES ani TRIGGER');
select tt.ok(tt.as_('authenticated', tt.su(2), $q$truncate public.books$q$) like '42501:permission denied%', 'přihlášený nesmí TRUNCATE');
select tt.ok(tt.as_('authenticated', tt.su(2), $q$select count(*) from public.admin_temp_passwords$q$) like '42501:permission denied%', 'admin_temp_passwords: přihlášený nemá přístup vůbec');
select tt.ok(tt.as_('authenticated', tt.su(2), $q$insert into public.coin_transactions (user_id, amount, source_type) values (tt.su(2), 100, 'x')$q$) like '42501:permission denied%', 'přihlášený nesmí zapisovat do deníku mincí (jen funkce serveru)');
select tt.ok(tt.as_('authenticated', tt.su(2), $q$insert into public.admin_notifications (kind, title) values ('x', 'y')$q$) like '42501:permission denied%', 'přihlášený nesmí zapisovat do admin_notifications (jen funkce serveru)');
select tt.ok(tt.as_('authenticated', tt.su(1), $q$select 1$q$, $q$select count(*) from public.admin_notifications$q$) like 'ok:%', 'správce pořád čte admin_notifications');
select tt.ok(tt.as_('authenticated', tt.su(1), $q$insert into public.system_logs (log_type, message) values ('INFO', 'x')$q$) = 'ok', 'správce pořád zapisuje do systémových logů');
select tt.ok(tt.as_('authenticated', tt.su(1), $q$insert into public.site_settings values ('x', '{}') on conflict (key) do update set value = excluded.value$q$) = 'ok', 'správce pořád ukládá nastavení (upsert)');

-- ---------------------------------------------------------------------------
-- Profil
-- ---------------------------------------------------------------------------
select tt.ok(tt.as_('authenticated', tt.su(5), $q$insert into public.profiles (id, email, role) values (tt.su(5), 'tt5@x.cz', 'uživatel')$q$) = 'ok', 'nový účet si založí profil s id, e-mailem a rolí (jako AuthContext)');
select tt.ok(tt.as_('authenticated', tt.su(6), $q$insert into public.profiles (id, email, role, coins) values (tt.su(6), 'tt6@x.cz', 'uživatel', 999999)$q$) like '42501:permission denied%', 'nový účet si už nevloží profil s libovolnými mincemi');
select tt.ok(tt.as_('authenticated', tt.su(6), $q$insert into public.profiles (id, email, role) values (tt.su(6), 'tt6@x.cz', 'správce')$q$) like '42501:%', 'ani s rolí správce');
select tt.ok(tt.as_('authenticated', tt.su(2), $q$update public.profiles set highest_goal_ever = 99 where id = tt.su(2)$q$) like '42501:protected_column%', 'čtenář si highest_goal_ever už nepřepíše');
select tt.ok(tt.as_('authenticated', tt.su(2), $q$update public.profiles set coins = coins + 100 where id = tt.su(2)$q$) <> 'ok', 'čtenář si nepřipíše mince');
select tt.ok(tt.as_('authenticated', tt.su(2), $q$update public.profiles set role = 'správce' where id = tt.su(2)$q$) like '42501:protected_column%', 'čtenář si nezmění roli');
select tt.ok(tt.as_('authenticated', tt.su(2), $q$update public.profiles set fake_xp = 500, streak_freezes = 9, unlocked_badges = '{a}' where id = tt.su(2)$q$) like '42501:protected_column%', 'čtenář si nepřipíše XP, pojistky ani odznaky');
select tt.ok(tt.as_('authenticated', tt.su(2), $q$update public.profiles set monthly_goal = 12, show_in_leaderboard = true, featured_badge = 'b1', last_goal_change_date = now(), pen_name = 'Jméno' where id = tt.su(2)$q$) = 'ok', 'čtenář si pořád změní cíl, viditelnost v žebříčku, odznak a krycí jméno');
select tt.ok(tt.as_('authenticated', tt.su(1), $q$update public.profiles set fake_xp = 5, streak_freezes = 2 where id = tt.su(2)$q$) = 'ok', 'správce pořád upraví XP a pojistky ostatním (administrace)');
select tt.ok(tt.as_('authenticated', tt.su(1), $q$update public.profiles set highest_goal_ever = 7, role = 'nakladatel' where id = tt.su(4)$q$) = 'ok', 'správce smí změnit i chráněné sloupce');
select tt.ok(tt.as_('authenticated', tt.su(2), $q$select 1$q$, $q$select count(*) from public.profiles$q$) = 'ok:1', 'čtenář vidí jen svůj profil (politika beze změny)');

-- ---------------------------------------------------------------------------
-- user_books
-- ---------------------------------------------------------------------------
select tt.ok(tt.as_('authenticated', tt.su(2), $q$update public.user_books set scroll_position = 55, last_read_at = now(), updated_at = now() where user_id = tt.su(2) and book_id = '00000000-0000-0000-0000-00000000b001'$q$) = 'ok', 'čtenář pořád ukládá pozici čtení');
select tt.ok(tt.as_('authenticated', tt.su(2), $q$update public.user_books set status = 'active' where user_id = tt.su(2) and status = 'requested'$q$) like '42501:protected_column%', 'čtenář si žádanou knihu sám neodemkne (status)');
select tt.ok(tt.as_('authenticated', tt.su(2), $q$update public.user_books set first_completed_at = now() where user_id = tt.su(2) and first_completed_at < now() - interval '30 days'$q$) like '42501:protected_column%', 'čtenář si nepřepíše datum dočtení (first_completed_at)');
select tt.ok(tt.as_('authenticated', tt.su(2), $q$update public.user_books set book_id = '00000000-0000-0000-0000-00000000b009' where user_id = tt.su(2) and status = 'requested'$q$) like '42501:protected_column%', 'čtenář řádek nepřepíše na jinou knihu (book_id)');
select tt.ok(tt.as_('authenticated', tt.su(2), $q$insert into public.user_books (user_id, book_id, status, is_read, scroll_position, updated_at) values (tt.su(2), '00000000-0000-0000-0000-00000000b001', 'active', true, 60, now())
    on conflict (user_id, book_id) do update set scroll_position = excluded.scroll_position, is_read = excluded.is_read, updated_at = excluded.updated_at, status = excluded.status$q$) = 'ok', 'upsert pozice jako v appce (status zůstává stejný) projde');
select tt.ok(tt.as_('authenticated', tt.su(2), $q$insert into public.user_books (user_id, book_id, status, is_read) values (tt.su(2), '00000000-0000-0000-0000-00000000b002', 'active', true)
    on conflict (user_id, book_id) do update set status = excluded.status$q$) like '42501:protected_column%', 'upsert, který by změnil status z requested na active, neprojde');
select tt.ok(tt.as_('authenticated', tt.su(2), $q$insert into public.user_books (user_id, book_id, status, is_read, scroll_position) values (tt.su(2), '00000000-0000-0000-0000-00000000b008', 'active', false, 0)$q$) = 'ok', 'první uložení čtení nové knihy (insert se statusem active) projde');
select tt.ok(tt.as_('authenticated', tt.su(2), $q$insert into public.user_books (user_id, book_id, status, is_read, first_completed_at) values (tt.su(2), '00000000-0000-0000-0000-00000000b007', 'active', true, now() - interval '1 day')$q$) like '42501:protected_column%', 'čtenář si při založení řádku nenastaví first_completed_at');
select tt.ok(tt.as_('authenticated', tt.su(2), $q$update public.user_books set is_read = true where user_id = tt.su(2) and scroll_position = 10$q$, $q$select (first_completed_at is not null)::text from public.user_books where user_id = tt.su(2) and scroll_position = 10$q$) = 'ok:true',
  'dočtení knihy: spoušť sama doplní first_completed_at, i když ji přihlášený nesmí volat přímo');
select tt.ok(tt.as_('authenticated', tt.su(1), $q$update public.user_books set status = 'active' where user_id = tt.su(2) and status = 'requested'$q$) = 'ok', 'správce pořád aktivuje žádanou knihu');
select tt.ok(tt.as_('authenticated', tt.su(1), $q$insert into public.user_books (user_id, book_id, status) values (tt.su(4), '00000000-0000-0000-0000-00000000b002', 'active')$q$) = 'ok', 'správce pořád přiřadí knihu čtenáři');

-- ---------------------------------------------------------------------------
-- Soukromí a žebříček
-- ---------------------------------------------------------------------------
select tt.ok(tt.as_('authenticated', tt.su(2), $q$select 1$q$, $q$select count(*) from public.user_books where user_id <> tt.su(2)$q$) = 'ok:0', 'čtenář už nevidí cizí řádky user_books');
select tt.ok(tt.as_('authenticated', tt.su(2), $q$select 1$q$, $q$select count(*) from public.user_books where user_id = tt.su(2)$q$) = 'ok:3', 'své řádky user_books vidí všechny');
select tt.ok(tt.as_('authenticated', tt.su(2), $q$select 1$q$, $q$select count(*) from public.user_daily_activity where user_id <> tt.su(2)$q$) = 'ok:0', 'čtenář už nevidí cizí dny čtení');
select tt.ok(tt.as_('authenticated', tt.su(2), $q$select 1$q$, $q$select count(*) from public.book_ratings where user_id <> tt.su(2)$q$) = 'ok:0', 'čtenář už nevidí cizí hodnocení knih');
select tt.ok(tt.as_('authenticated', tt.su(1), $q$select 1$q$, $q$select count(*) from public.user_books$q$) = 'ok:5', 'správce vidí všechny řádky user_books');
select tt.ok(tt.as_('authenticated', tt.su(1), $q$select 1$q$, $q$select count(*) from public.user_daily_activity$q$) = 'ok:4', 'správce vidí všechna data čtení');
select tt.ok(tt.as_('authenticated', tt.su(2), $q$select 1$q$, $q$select string_agg(user_id::text || ':' || total_read || ':' || monthly_read, ' ' order by user_id) from public.leaderboard_reads(date_trunc('month', now()), date_trunc('month', now()) + interval '1 month')$q$)
  = 'ok:' || tt.su(2) || ':2:1 ' || tt.su(4) || ':1:1', 'leaderboard_reads: čtenář 2 vidí sebe (2 přečtené, 1 tento měsíc) a čtenáře 4, skrytého čtenáře 3 ne');
select tt.ok(tt.as_('authenticated', tt.su(3), $q$select 1$q$, $q$select string_agg(user_id::text, ' ' order by user_id) from public.leaderboard_reads(date_trunc('month', now()), date_trunc('month', now()) + interval '1 month')$q$)
  = 'ok:' || tt.su(2) || ' ' || tt.su(3) || ' ' || tt.su(4), 'skrytý čtenář 3 vidí v souhrnu sebe a ostatní (své číslo smí znát)');
select tt.ok(tt.as_('authenticated', tt.su(2), $q$select 1$q$, $q$select string_agg(user_id::text || ':' || activity_date, ' ' order by user_id, activity_date) from public.leaderboard_activity(60)$q$)
  = 'ok:' || tt.su(2) || ':' || (current_date - 1) || ' ' || tt.su(2) || ':' || current_date, 'leaderboard_activity: jen dny čtení čtenáře 2 (čtenář 3 je skrytý, dny čtenáře 4 jsou starší než 60 dní)');
select tt.ok(tt.as_('authenticated', tt.su(2), $q$select 1$q$, $q$select count(*) from public.leaderboard_activity(null)$q$) = 'ok:2', 'leaderboard_activity bez počtu dní bere výchozích 60');
select tt.ok(tt.as_('anon', null, $q$select * from public.leaderboard_reads(now(), now())$q$) like '42501:permission denied%', 'souhrny žebříčku nejdou volat bez přihlášení');
select tt.ok(tt.as_('authenticated', null, $q$select * from public.leaderboard_activity(10)$q$) = 'P0001:not_authenticated', 'bez uživatele v tokenu funkce odmítne');

-- ---------------------------------------------------------------------------
-- Strop na žádosti o pomoc s heslem
-- ---------------------------------------------------------------------------
do $$
declare i int; v_err text;
begin
  for i in 1..30 loop perform public.request_password_help('a' || i || '@x.cz', 'u', null); end loop;
  begin perform public.request_password_help('a31@x.cz', 'u', null); exception when others then v_err := sqlerrm; end;
  perform tt.ok(v_err like 'rate_limited%', 'třicátá první žádost o pomoc s heslem za hodinu je odmítnutá');
  perform tt.ok((select count(*) from public.admin_notifications where kind = 'password_request') = 30, 'odmítnutá žádost se nezapsala (správci nepřibude zvonek)');
  insert into public.admin_notifications (kind, title) values ('email_change_request', 'jiný druh se neomezuje');
  perform tt.ok(true, 'ostatní druhy oznámení strop nezasáhne');
  delete from public.admin_notifications where true;
end $$;

-- ---------------------------------------------------------------------------
-- Úložiště, interní schémata, výchozí práva
-- ---------------------------------------------------------------------------
select tt.ok((select file_size_limit = 20971520 and 'text/plain' = any(allowed_mime_types) and not 'text/html' = any(allowed_mime_types) from storage.buckets where id = 'book-texts'), 'book-texts: limit 20 MB a jen text/plain (limit, který už měl, zůstal)');
select tt.ok((select bool_and(file_size_limit = 5242880 and allowed_mime_types @> array['text/plain']) from storage.buckets where id in ('books', 'knihy', 'knizky')), 'ostatní buckety: limit 5 MB a jen text');
select tt.ok((select not public from storage.buckets where id = 'knizky'), 'bucket knizky už není veřejný');
select tt.ok((select file_size_limit = 1000 and allowed_mime_types = array['image/png'] from storage.buckets where id = 'tt-vlastni'), 'bucket s vlastním nastavením (nebo jiný, než appka používá) se nezměnil');
select tt.ok(not has_schema_privilege('anon', 'net', 'usage') and not has_schema_privilege('authenticated', 'net', 'usage') and not has_table_privilege('authenticated', 'net.calls', 'select'), 'schéma net: klientské role nemají přístup');
select tt.ok(not has_schema_privilege('authenticated', 'cron', 'usage') and not has_table_privilege('anon', 'cron.job', 'select'), 'schéma cron: klientské role nemají přístup');
create table public.tt_new_tbl (id int);
create function public.tt_new_fn() returns int language sql as $$ select 1 $$;
select tt.ok(not has_table_privilege('anon', 'public.tt_new_tbl', 'select') and has_table_privilege('authenticated', 'public.tt_new_tbl', 'select'), 'nová tabulka: anon nic nedostane, přihlášený ano (výchozí práva)');
select tt.ok(not has_function_privilege('anon', 'public.tt_new_fn()', 'execute') and has_function_privilege('authenticated', 'public.tt_new_fn()', 'execute'), 'nová funkce: anon ji nevolá ani přes PUBLIC, přihlášený ano');
drop table public.tt_new_tbl; drop function public.tt_new_fn();
select tt.ok(not has_schema_privilege('anon', 'public', 'create') and not has_schema_privilege('authenticated', 'public', 'create'), 'nikdo z klientských rolí nezakládá objekty v public');

-- ---------------------------------------------------------------------------
-- Diagnostika po zpevnění: nesmí zbýt nic kritického
-- ---------------------------------------------------------------------------
\ir ../security-diagnostics.sql
select tt.ok(not exists (select 1 from pg_temp._diag where sekce like 'Z.%'), 'diagnostika po zpevnění doběhla bez chyby: ' || coalesce((select string_agg(objekt || ' ' || nalez || ' ' || coalesce(detail, ''), '; ') from pg_temp._diag where sekce like 'Z.%'), ''));
select tt.ok(not exists (select 1 from pg_temp._diag where sev = 1), 'diagnostika po zpevnění: žádný KRITICKÝ nález: ' || coalesce((select string_agg(objekt || ' ' || nalez, '; ') from pg_temp._diag where sev = 1), ''));
select tt.ok(not exists (select 1 from pg_temp._diag where sev = 2), 'diagnostika po zpevnění: žádný VYSOKÝ nález: ' || coalesce((select string_agg(objekt || ' ' || nalez, '; ') from pg_temp._diag where sev = 2), ''));
select tt.ok(not exists (select 1 from pg_temp._diag where sev = 3 and sekce in ('B. Tabulky', 'D. Funkce', 'K. Role')), 'diagnostika po zpevnění: žádný STŘEDNÍ nález v tabulkách, funkcích a rolích: ' || coalesce((select string_agg(objekt || ' ' || nalez, '; ') from pg_temp._diag where sev = 3 and sekce in ('B. Tabulky', 'D. Funkce', 'K. Role')), ''));

-- ---------------------------------------------------------------------------
-- Návrat zpět (db/security-hardening-undo.sql): vrátí přesně původní stav a jde zpevnit znovu
-- ---------------------------------------------------------------------------
select tt.fp() as fp_hard \gset
select tt.ok(:'fp_hard' <> :'fp_before', 'otisk práv po zpevnění se od původního liší (jinak by srovnání nic neříkalo)');
select tt.ok((select count(*) from public.security_hardening_backup) = 1, 'záloha původního nastavení je uložená (jedna řádka)');
select tt.ok(tt.as_('authenticated', tt.su(2), 'select 1', 'select count(*) from public.security_hardening_backup') like '42501:%', 'zálohu appka nevidí');
\ir ../security-hardening-undo.sql
select tt.ok(tt.fp() = :'fp_before', 'po návratu zpět jsou práva, politiky, buckety i spouště přesně jako před zpevněním');
select tt.ok((select count(*) from public.security_hardening_backup) = 0, 'po návratu se záloha smaže');
select tt.ok(tt.as_('authenticated', tt.su(2), $q$update public.profiles set highest_goal_ever = 99 where id = tt.su(2)$q$) = 'ok', 'po návratu je díra zase otevřená (čtenář si přepíše highest_goal_ever), tedy spoušť je pryč');
select tt.ok(has_function_privilege('anon', 'public.verify_book_passcode(uuid,text)', 'execute') and has_table_privilege('anon', 'public.profiles', 'insert'), 'po návratu má anon zase původní práva');
select tt.ok(tt.as_('authenticated', tt.su(2), 'select 1', 'select count(*) from public.user_books where user_id <> tt.su(2)') <> 'ok:0', 'po návratu čtenář zase vidí cizí přečtené knihy (původní politika)');
\ir ../security-hardening.sql
select tt.ok(not exists (select 1 from pg_temp._hard_log where stav in ('CHYBA', 'SELHALO', 'UPOZORNĚNÍ')), 'zpevnění po návratu zpět doběhne bez chyby');
select tt.ok(tt.fp() = :'fp_hard', 'a dá přesně stejný stav jako poprvé');
select tt.ok(exists (select 1 from pg_temp._hard_log where sekce = 'Záloha' and stav = 'ZMĚNA'), 'po návratu se uložila nová záloha');
-- Skutečná databáze: všichni zkušební čtenáři mají knihy ve stavu active. Zkouška změny statusu musí hodnotu opravdu změnit, jinak by prošla naprázdno
-- a hlásila by díru, která je zavřená (spoušť hlídá změnu, ne zápis stejné hodnoty).
update public.user_books set status = 'active';
\ir ../security-diagnostics.sql
select tt.ok(not exists (select 1 from pg_temp._diag where sev = 1 and sekce = 'N. Zkoušky: mass assignment' and objekt = 'public.user_books'), 'zpevněná user_books: zkouška změny statusu nehlásí díru ani když jsou všechny řádky už active');
drop trigger trg_00_guard_user_books_client on public.user_books;
\ir ../security-diagnostics.sql
select tt.ok(exists (select 1 from pg_temp._diag where sev = 1 and sekce = 'N. Zkoušky: mass assignment' and objekt = 'public.user_books' and nalez like '%status%'), 'bez ochranné spouště zkouška změnu statusu pozná (i když jsou všechny řádky active)');
select tt.ok(current_user = session_user, 'po zkouškách je role spojení zase původní');
