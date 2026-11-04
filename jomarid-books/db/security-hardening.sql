-- ============================================================================
-- Jomarid Books: velké bezpečnostní zpevnění databáze
-- ============================================================================
-- Spusť celý soubor najednou v Supabase SQL Editoru. Jde spustit i víckrát (nic se nerozbije ani nezdvojí) a nemění žádná data uživatelů:
-- jen práva, pravidla (RLS politiky), ochranné spouště a nastavení úložiště. Na konci vypíše tabulku, co se změnilo, co případně nešlo
-- a kontrolu výsledku. Když by se po spuštění něco v appce rozbilo, vrátí práva zpět soubor db/security-hardening-undo.sql.
--
-- Postavené na výsledku db/security-diagnostics.sql z tvé databáze. Co se zavírá a proč:
--  1. Funkce: bez přihlášení (role anon) jde dosud volat skoro 40 funkcí (admin_grant_coins, nákup knihy, mazání účtu, ...). Zůstanou jen dvě,
--     které appka volá před přihlášením (username_available_public, request_password_help). Ostatním funkcím se bere právo pro anon i PUBLIC,
--     přihlášení čtenáři si ponechají všechno, co appka používá. Spouštěcí funkce (trigger) a staré nepoužívané funkce (verify_book_passcode,
--     make_username_from_email) se zavřou úplně: spouště běží i bez práva volání. Funkcím SECURITY DEFINER bez pevného search_path se
--     search_path doplní.
--  2. Tabulky: role anon měla právo zapisovat do 19 tabulek (chránily je jen politiky RLS). Anon smí nově už jen číst knihy a nastavení
--     appky (katalog a texty na úvodní stránce). Všem se bere TRUNCATE/REFERENCES/TRIGGER (TRUNCATE obchází RLS). Přihlášeným se
--     bere právo na příkaz, pro který tabulka nemá žádnou politiku (nic by stejně neprošlo; jen se zavře i zadní vrátka, kdyby
--     někdo politiku omylem přidal).
--  3. Profil: nový účet si při založení profilu mohl vložit libovolné mince a XP. INSERT do profiles teď smí jen sloupce id, email, role.
--     Přímá změna sloupců, které smí měnit jen server (highest_goal_ever, mince, XP, série, role, e-mail, ...), je u čtenáře zakázaná
--     spouští (správce a funkce serveru ji dělat smí dál).
--  4. Knihovna: čtenář si mohl u svého řádku user_books přepsat status (sám si odemknout žádanou placenou knihu), book_id a first_completed_at
--     (nafouknout měsíční žebříček). Ochranná spoušť to zakazuje, správce ani nákupní funkce nejsou omezeny.
--  5. Soukromí: každý přihlášený viděl všechny přečtené knihy a všechna data čtení všech uživatelů (i těch, kdo si žebříček vypnuli) a všechna
--     hodnocení knih. Politiky se zužují na vlastní řádky (+ správce). Žebříček čte nově ze dvou funkcí, které vrací jen souhrny
--     těch, kdo jsou v žebříčku (leaderboard_reads, leaderboard_activity); appka je v téhle verzi už používá.
--  6. Zneužití: veřejná žádost o pomoc s heslem (kind password_request) má strop 30 za hodinu, ať se správci nedá zahltit zvonek ani push.
--  7. Úložiště: buckety mají limit velikosti a povolené typy souborů (jen prostý text), bucket knizky už není veřejný.
--  8. Interní schémata (net, cron): klientské role (anon, authenticated) o ně přicházejí. Přes net.http_request_queue šlo načíst tajné heslo
--     push oznámení (hlavička x-push-secret). Co Supabase nedovolí zavřít, ukáže výsledek jako UPOZORNĚNÍ.
--  9. Nové objekty: výchozí práva v public už nové tabulky, funkce a sekvence automaticky neotevřou roli anon.
-- 10. Záloha: při prvním spuštění se původní práva, politiky a nastavení úložiště uloží do tabulky security_hardening_backup (zavřená pro appku).
--     Při dalším spuštění se nepřepisuje. Z ní db/security-hardening-undo.sql vrátí všechno přesně do původního stavu.
-- ============================================================================

create temp table if not exists _hard_log (n serial, sekce text, stav text, detail text);
delete from _hard_log where true;

create or replace function pg_temp._log(p_sekce text, p_stav text, p_detail text) returns void language sql as
$$ insert into pg_temp._hard_log (sekce, stav, detail) values (p_sekce, p_stav, p_detail) $$;

-- spustí příkaz; když selže (třeba nemáme oprávnění na objekt ve vlastnictví Supabase), zapíše UPOZORNĚNÍ a jede se dál
create or replace function pg_temp._x(p_sekce text, p_sql text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return true;
exception when others then
  perform pg_temp._log(p_sekce, 'UPOZORNĚNÍ', left(p_sql, 110) || '  ->  ' || sqlerrm);
  return false;
end $$;

-- ---------------------------------------------------------------------------
-- 0. ZÁLOHA původního nastavení (jen při prvním spuštění; z ní vrací db/security-hardening-undo.sql)
-- ---------------------------------------------------------------------------
do $$
declare v_data jsonb; v_rel int; v_fn int;
begin
  create table if not exists public.security_hardening_backup (id int primary key default 1 check (id = 1), taken_at timestamptz not null default now(), data jsonb not null);
  alter table public.security_hardening_backup enable row level security;
  revoke all on public.security_hardening_backup from public, anon, authenticated;
  if exists (select 1 from public.security_hardening_backup) then
    perform pg_temp._log('Záloha', 'INFO', 'Záloha původního nastavení už existuje (z prvního spuštění), nepřepisuje se');
    return;
  end if;
  select jsonb_build_object(
    'relations', (select coalesce(jsonb_agg(jsonb_build_object('name', format('%I.%I', n.nspname, c.relname), 'kind', case c.relkind when 'S' then 'sequence' else 'table' end,
        'acl', (select coalesce(jsonb_agg(jsonb_build_object('grantee', case when a.grantee = 0 then 'public' else pg_get_userbyid(a.grantee) end, 'priv', a.privilege_type)), '[]'::jsonb)
                from aclexplode(c.relacl) a where a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon', 'authenticated'))
      )), '[]'::jsonb)
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('public', 'net', 'cron') and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')),
    'functions', (select coalesce(jsonb_agg(jsonb_build_object('sig', format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)),
        'acl', case when p.proacl is null then jsonb_build_array(jsonb_build_object('grantee', 'public', 'priv', 'EXECUTE'))
               else (select coalesce(jsonb_agg(jsonb_build_object('grantee', case when a.grantee = 0 then 'public' else pg_get_userbyid(a.grantee) end, 'priv', a.privilege_type)), '[]'::jsonb)
                     from aclexplode(p.proacl) a where a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon', 'authenticated')) end
      )), '[]'::jsonb)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'net', 'cron') and p.prokind in ('f', 'p')),
    'schemas', (select coalesce(jsonb_agg(jsonb_build_object('name', n.nspname,
        'acl', (select coalesce(jsonb_agg(jsonb_build_object('grantee', case when a.grantee = 0 then 'public' else pg_get_userbyid(a.grantee) end, 'priv', a.privilege_type)), '[]'::jsonb)
                from aclexplode(n.nspacl) a where a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon', 'authenticated'))
      )), '[]'::jsonb)
      from pg_namespace n where n.nspname in ('public', 'net', 'cron')),
    'defaults', (select coalesce(jsonb_agg(jsonb_build_object('role', pg_get_userbyid(d.defaclrole), 'schema', (select nspname from pg_namespace where oid = d.defaclnamespace), 'type', d.defaclobjtype::text,
        'acl', (select coalesce(jsonb_agg(jsonb_build_object('grantee', case when a.grantee = 0 then 'public' else pg_get_userbyid(a.grantee) end, 'priv', a.privilege_type)), '[]'::jsonb)
                from aclexplode(d.defaclacl) a where a.grantee = 0 or pg_get_userbyid(a.grantee) in ('anon', 'authenticated'))
      )), '[]'::jsonb) from pg_default_acl d),
    'policies', (select coalesce(jsonb_agg(jsonb_build_object('table', tablename, 'policy', policyname, 'qual', qual)), '[]'::jsonb)
      from pg_policies where schemaname = 'public' and policyname in ('user_books_select', 'user_daily_activity_select', 'book_ratings_select'))
  ) into v_data;
  if to_regclass('storage.buckets') is not null then
    v_data := v_data || jsonb_build_object('buckets', (select coalesce(jsonb_agg(to_jsonb(b)), '[]'::jsonb) from (select id, public, file_size_limit, allowed_mime_types from storage.buckets) b));
  end if;
  insert into public.security_hardening_backup (data) values (v_data);
  v_rel := jsonb_array_length(v_data -> 'relations'); v_fn := jsonb_array_length(v_data -> 'functions');
  perform pg_temp._log('Záloha', 'ZMĚNA', format('Uložena záloha původních práv (%s tabulek a sekvencí, %s funkcí, politiky a buckety) pro návrat zpět', v_rel, v_fn));
exception when others then
  perform pg_temp._log('Záloha', 'UPOZORNĚNÍ', 'Zálohu původního nastavení se nepodařilo uložit, zpevnění pokračuje, ale návrat zpět by nešel: ' || sqlerrm);
end $$;

-- ---------------------------------------------------------------------------
-- 1. FUNKCE v public
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_pub  constant text[] := array['username_available_public', 'request_password_help'];  -- záměrně veřejné (registrace, "zapomněl jsem heslo")
  v_none constant text[] := array['verify_book_passcode', 'make_username_from_email'];   -- appka je nevolá; jen interně nebo vůbec
  v_svc  boolean := exists (select 1 from pg_roles where rolname = 'service_role');
  v_auth_had boolean;
  n_anon int := 0; n_trg int := 0; n_none int := 0; n_sp int := 0; n_err int := 0;
  v_names text := '';
begin
  for r in
    select p.oid, format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) as sig, p.proname,
           p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as label, p.prosecdef, p.proconfig, (p.prorettype = 'trigger'::regtype) as is_trg
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind in ('f', 'p')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
    order by p.proname
  loop
    begin
      v_auth_had := has_function_privilege('authenticated', r.oid, 'execute');
      if r.proname = any(v_pub) then
        execute format('grant execute on routine %s to anon, authenticated', r.sig);
        if v_svc then execute format('grant execute on routine %s to service_role', r.sig); end if;
      else
        if has_function_privilege('anon', r.oid, 'execute') then
          n_anon := n_anon + 1;
          if length(v_names) < 600 then v_names := v_names || r.proname || ', '; end if;
        end if;
        -- nejdřív přihlášeným a service_role výslovně potvrdit to, co mají, ať jim nezmizí spolu s právem PUBLIC
        if v_auth_had and not r.is_trg and not (r.proname = any(v_none)) then
          execute format('grant execute on routine %s to authenticated', r.sig);
        end if;
        if v_svc then execute format('grant execute on routine %s to service_role', r.sig); end if;
        execute format('revoke all on routine %s from public, anon', r.sig);
        if r.is_trg or r.proname = any(v_none) then
          if v_auth_had then
            if r.is_trg then n_trg := n_trg + 1; else n_none := n_none + 1; end if;
          end if;
          execute format('revoke all on routine %s from authenticated', r.sig);
        end if;
      end if;
      if r.prosecdef and not exists (select 1 from unnest(coalesce(r.proconfig, '{}'::text[])) c where c like 'search_path=%') then
        execute format('alter routine %s set search_path to public, extensions, pg_temp', r.sig);
        n_sp := n_sp + 1;
        perform pg_temp._log('Funkce', 'ZMĚNA', 'Doplněn pevný search_path: ' || r.label);
      end if;
    exception when others then
      n_err := n_err + 1;
      perform pg_temp._log('Funkce', 'UPOZORNĚNÍ', r.label || ': ' || sqlerrm);
    end;
  end loop;
  perform pg_temp._log('Funkce', 'ZMĚNA', format('Zavřeno pro nepřihlášené (anon): %s funkcí%s', n_anon, case when n_anon > 0 then ' (' || left(v_names, length(v_names) - 2) || ')' else '' end));
  perform pg_temp._log('Funkce', 'ZMĚNA', format('Spouštěcí funkce zavřené i pro přihlášené: %s; nepoužívané funkce zavřené pro přihlášené: %s; doplněný search_path: %s', n_trg, n_none, n_sp));
  if n_err > 0 then perform pg_temp._log('Funkce', 'UPOZORNĚNÍ', format('%s funkcí se nepodařilo upravit (viz výše)', n_err)); end if;
end $$;

-- nikdo kromě vlastníka nemá co zakládat objekty v public
select pg_temp._x('Schéma', 'revoke create on schema public from public, anon, authenticated');

-- ---------------------------------------------------------------------------
-- 2. TABULKY v public: práva pro anon a zbytečná práva pro přihlášené
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  cmd text;
  v_anon_read constant text[] := array['books', 'site_settings'];   -- katalog a texty úvodní stránky (politiky books_select_anon, site_settings_select)
  v_no_insert constant text[] := array['coin_transactions'];        -- mince připisují jen funkce serveru, klient do deníku nezapisuje
  v_auth oid := (select oid from pg_roles where rolname = 'authenticated');
  n_anon int := 0; n_lock int := 0; n_cmd int := 0; n_err int := 0; v_names text := ''; v_rev text;
begin
  for r in
    select c.oid, format('%I.%I', n.nspname, c.relname) as tbl, c.relname, c.relkind, c.relrowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
    order by c.relname
  loop
    begin
      if has_table_privilege('anon', r.oid, 'insert') or has_table_privilege('anon', r.oid, 'update') or has_table_privilege('anon', r.oid, 'delete')
         or has_table_privilege('anon', r.oid, 'truncate') or (has_table_privilege('anon', r.oid, 'select') and not (r.relname = any(v_anon_read))) then
        n_anon := n_anon + 1;
        if length(v_names) < 500 then v_names := v_names || r.relname || ', '; end if;
      end if;
      execute format('revoke all on table %s from anon', r.tbl);
      if r.relname = any(v_anon_read) then execute format('grant select on table %s to anon', r.tbl); end if;
      if has_table_privilege('authenticated', r.oid, 'truncate') or has_table_privilege('authenticated', r.oid, 'references') or has_table_privilege('authenticated', r.oid, 'trigger') then
        n_lock := n_lock + 1;
      end if;
      execute format('revoke truncate, references, trigger on table %s from authenticated', r.tbl);
      v_rev := '';
      if r.relkind in ('r', 'p') and r.relrowsecurity then
        foreach cmd in array array['select', 'insert', 'update', 'delete'] loop
          if has_table_privilege('authenticated', r.oid, cmd)
             and (not exists (
                    select 1 from pg_policy p
                    where p.polrelid = r.oid
                      and p.polcmd::text in ('*', case cmd when 'select' then 'r' when 'insert' then 'a' when 'update' then 'w' else 'd' end)
                      and (0::oid = any(p.polroles) or v_auth = any(p.polroles)))
                  or (cmd = 'insert' and r.relname = any(v_no_insert))) then
            execute format('revoke %s on table %s from authenticated', cmd, r.tbl);
            n_cmd := n_cmd + 1;
            v_rev := v_rev || case when v_rev = '' then '' else ', ' end || upper(cmd);
          end if;
        end loop;
        if v_rev <> '' then
          perform pg_temp._log('Tabulky', 'ZMĚNA', format('%s: přihlášeným odebráno %s (tabulka pro tento příkaz nemá žádnou politiku, nic by neprošlo)', r.tbl, v_rev));
        end if;
      elsif r.relkind in ('r', 'p') and not r.relrowsecurity then
        perform pg_temp._log('Tabulky', 'UPOZORNĚNÍ', r.tbl || ': RLS je vypnuté (zapnutí by bez politik tabulku zamklo, nech to projít a rozhodni se ručně)');
      end if;
    exception when others then
      n_err := n_err + 1;
      perform pg_temp._log('Tabulky', 'UPOZORNĚNÍ', r.tbl || ': ' || sqlerrm);
    end;
  end loop;
  perform pg_temp._log('Tabulky', 'ZMĚNA', format('Nepřihlášeným (anon) odebrána práva u %s tabulek%s; číst smí už jen: %s', n_anon, case when n_anon > 0 then ' (' || left(v_names, length(v_names) - 2) || ')' else '' end, array_to_string(v_anon_read, ', ')));
  perform pg_temp._log('Tabulky', 'ZMĚNA', format('Odebrán TRUNCATE/REFERENCES/TRIGGER přihlášeným u %s tabulek; zbytečných práv na příkaz bez politiky odebráno: %s', n_lock, n_cmd));
  if n_err > 0 then perform pg_temp._log('Tabulky', 'UPOZORNĚNÍ', format('%s tabulek se nepodařilo upravit (viz výše)', n_err)); end if;
end $$;

select pg_temp._x('Tabulky', 'revoke all on all sequences in schema public from anon');

-- ---------------------------------------------------------------------------
-- 3. PROFIL: nový profil smí mít jen id, e-mail a roli (zbytek dostane výchozí hodnoty)
--    appka (AuthContext) zakládá profil jako { id, email, role: 'uživatel' }
-- ---------------------------------------------------------------------------
do $$
declare v_cols text;
begin
  if to_regclass('public.profiles') is null then
    perform pg_temp._log('Profil', 'UPOZORNĚNÍ', 'Tabulka profiles neexistuje, krok přeskočen');
    return;
  end if;
  select string_agg(quote_ident(attname), ', ' order by attnum) into v_cols
  from pg_attribute where attrelid = 'public.profiles'::regclass and attnum > 0 and not attisdropped and attname in ('id', 'email', 'role');
  if pg_temp._x('Profil', 'revoke insert on public.profiles from authenticated')
     and pg_temp._x('Profil', format('grant insert (%s) on public.profiles to authenticated', v_cols)) then
    perform pg_temp._log('Profil', 'ZMĚNA', 'INSERT do profiles smí přihlášený jen se sloupci: ' || v_cols);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. OCHRANNÉ SPOUŠTĚ: čtenář nesmí přímo měnit sloupce, které smí měnit jen server
--    Běží jen u přímých zápisů z API (role authenticated/anon). Funkce SECURITY DEFINER, SQL Editor a service_role běží pod jinou rolí a
--    projdou; přihlášený správce projde taky (správa uživatelů v administraci).
-- ---------------------------------------------------------------------------
create or replace function public.guard_profiles_client_write()
returns trigger language plpgsql set search_path to public, pg_temp as $$
declare
  k text;
  v_prot constant text[] := array['highest_goal_ever', 'highest_goal_completed', 'coins', 'lifetime_coins_earned', 'bonus_xp', 'fake_xp', 'unlocked_badges',
                                  'current_streak', 'frozen_dates', 'streak_freezes', 'role', 'email', 'must_change_password'];
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if coalesce(public.app_current_role(), '') = 'správce' then return new; end if;
  foreach k in array v_prot loop
    if (to_jsonb(new) -> k) is distinct from (to_jsonb(old) -> k) then
      raise exception 'protected_column: sloupec % smí měnit jen server', k using errcode = '42501';
    end if;
  end loop;
  return new;
end $$;

create or replace function public.guard_user_books_client_write()
returns trigger language plpgsql set search_path to public, pg_temp as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if coalesce(public.app_current_role(), '') = 'správce' then return new; end if;
  if tg_op = 'INSERT' then
    if new.first_completed_at is not null then
      raise exception 'protected_column: first_completed_at nastavuje server' using errcode = '42501';
    end if;
  elsif new.status is distinct from old.status or new.first_completed_at is distinct from old.first_completed_at
     or new.user_id is distinct from old.user_id or new.book_id is distinct from old.book_id then
    raise exception 'protected_column: status, user_id, book_id a first_completed_at smí měnit jen server nebo správce' using errcode = '42501';
  end if;
  return new;
end $$;

-- strop na veřejné žádosti o pomoc s heslem: globálně 30 za hodinu a 300 otevřených najednou
create or replace function public.guard_admin_notifications_flood()
returns trigger language plpgsql security definer set search_path to public, pg_temp as $$
begin
  if new.kind = 'password_request' then
    if (select count(*) from public.admin_notifications where kind = 'password_request' and created_at > now() - interval '1 hour') >= 30
       or (select count(*) from public.admin_notifications where kind = 'password_request' and status = 'open') >= 300 then
      raise exception 'rate_limited: příliš mnoho žádostí o pomoc s heslem, zkus to později' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

revoke all on function public.guard_profiles_client_write() from public, anon, authenticated;
revoke all on function public.guard_user_books_client_write() from public, anon, authenticated;
revoke all on function public.guard_admin_notifications_flood() from public, anon, authenticated;

-- názvy spouští řadí PostgreSQL podle abecedy: prefix trg_00 zařídí, že ochrana běží dřív než spouště, které sloupce legitimně dopočítávají
do $$
begin
  if to_regclass('public.profiles') is not null
     and pg_temp._x('Spouště', 'create or replace trigger trg_00_guard_profiles_client before update on public.profiles for each row execute function public.guard_profiles_client_write()') then
    perform pg_temp._log('Spouště', 'ZMĚNA', 'profiles: přímá změna chráněných sloupců (highest_goal_ever, mince, XP, série, role, e-mail, ...) je zakázaná');
  end if;
  if to_regclass('public.user_books') is not null
     and pg_temp._x('Spouště', 'create or replace trigger trg_00_guard_user_books_client before insert or update on public.user_books for each row execute function public.guard_user_books_client_write()') then
    perform pg_temp._log('Spouště', 'ZMĚNA', 'user_books: čtenář nesmí měnit status, user_id, book_id ani first_completed_at');
  end if;
  if to_regclass('public.admin_notifications') is not null
     and pg_temp._x('Spouště', 'create or replace trigger trg_00_guard_admin_notifications_flood before insert on public.admin_notifications for each row execute function public.guard_admin_notifications_flood()') then
    perform pg_temp._log('Spouště', 'ZMĚNA', 'admin_notifications: strop 30 žádostí o pomoc s heslem za hodinu');
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. SOUKROMÍ: politiky jen na vlastní řádky (+ správce) a funkce se souhrny pro žebříček
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('user_books', 'user_books_select', 'auth.uid() = user_id or public.app_current_role() = ''správce'''),
      ('user_daily_activity', 'user_daily_activity_select', 'auth.uid() = user_id or public.app_current_role() = ''správce'''),
      ('book_ratings', 'book_ratings_select', 'auth.uid() = user_id or public.app_current_role() = ''správce''')
    ) as t(tbl, pol, expr)
  loop
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = r.tbl and policyname = r.pol) then
      if pg_temp._x('Soukromí', format('alter policy %I on public.%I using (%s)', r.pol, r.tbl, r.expr)) then
        perform pg_temp._log('Soukromí', 'ZMĚNA', format('%s (%s): vidí jen vlastní řádky a správce', r.tbl, r.pol));
      end if;
    else
      perform pg_temp._log('Soukromí', 'UPOZORNĚNÍ', format('politika %s na %s nenalezena, přeskočeno', r.pol, r.tbl));
    end if;
  end loop;
end $$;

-- Jiné politiky, které sahají na tabulky se zúženou politikou, začnou vidět jen vlastní řádky. Skript je jen vypíše, ať se dá ověřit, že to tak má být.
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname, left(coalesce(qual, '') || ' ' || coalesce(with_check, ''), 300) as expr
    from pg_policies
    where schemaname in ('public', 'storage') and (coalesce(qual, '') || coalesce(with_check, '')) ~* '\m(user_books|user_daily_activity|book_ratings)\M'
      and tablename not in ('user_books', 'user_daily_activity', 'book_ratings')
  loop
    perform pg_temp._log('Soukromí', 'INFO', format('Politika %s na %s.%s čte zúžené tabulky (uvidí v nich jen vlastní řádky uživatele, což je správně, když hlídá jeho vlastní přístup): %s', r.policyname, r.schemaname, r.tablename, r.expr));
  end loop;
end $$;

-- Souhrny pro žebříček: kolik knih kdo přečetl (celkem a v daném měsíci) a ve které dny četl. Vrací jen ty, kdo smějí být v žebříčku
-- (profiles.show_in_leaderboard, výchozí ano), plus volajícího. Jména, e-maily ani seznamy knih neprozradí.
create or replace function public.leaderboard_reads(p_from timestamptz, p_to timestamptz)
returns table (user_id uuid, total_read int, monthly_read int)
language plpgsql stable security definer set search_path to public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  return query
    select ub.user_id,
           count(*)::int,
           (count(*) filter (where ub.first_completed_at >= p_from and ub.first_completed_at < p_to))::int
    from public.user_books ub
    join public.profiles p on p.id = ub.user_id
    where ub.is_read = true and (coalesce(p.show_in_leaderboard, true) or ub.user_id = auth.uid())
    group by ub.user_id;
end $$;

create or replace function public.leaderboard_activity(p_days int default 60)
returns table (user_id uuid, activity_date date)
language plpgsql stable security definer set search_path to public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  return query
    select a.user_id, a.activity_date
    from public.user_daily_activity a
    join public.profiles p on p.id = a.user_id
    where a.activity_date >= current_date - least(greatest(coalesce(p_days, 60), 1), 400)
      and (coalesce(p.show_in_leaderboard, true) or a.user_id = auth.uid());
end $$;

revoke all on function public.leaderboard_reads(timestamptz, timestamptz) from public, anon;
revoke all on function public.leaderboard_activity(int) from public, anon;
grant execute on function public.leaderboard_reads(timestamptz, timestamptz) to authenticated;
grant execute on function public.leaderboard_activity(int) to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.leaderboard_reads(timestamptz, timestamptz) to service_role;
    grant execute on function public.leaderboard_activity(int) to service_role;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. ÚLOŽIŠTĚ: limity a povolené typy souborů
--    Appka ukládá texty knih jako prostý text (bucket book-texts, contentType text/plain). Ostatní buckety appka nepoužívá.
--    Mění se jen to, co dosud nemá žádný limit/typy; už uložené soubory se nedotknou.
-- ---------------------------------------------------------------------------
do $$
declare v_txt constant text := $q$array['text/plain', 'text/plain;charset=utf-8', 'text/plain; charset=utf-8', 'text/plain;charset=UTF-8', 'text/plain; charset=UTF-8']$q$;
begin
  if to_regclass('storage.buckets') is null then
    perform pg_temp._log('Úložiště', 'UPOZORNĚNÍ', 'storage.buckets nenalezeno, krok přeskočen');
    return;
  end if;
  perform pg_temp._x('Úložiště', format('update storage.buckets set allowed_mime_types = %s where id = ''book-texts'' and allowed_mime_types is null', v_txt));
  perform pg_temp._x('Úložiště', format('update storage.buckets set allowed_mime_types = %s where id in (''books'', ''knihy'', ''knizky'') and allowed_mime_types is null', v_txt));
  perform pg_temp._x('Úložiště', 'update storage.buckets set file_size_limit = 20971520 where id = ''book-texts'' and file_size_limit is null');
  perform pg_temp._x('Úložiště', 'update storage.buckets set file_size_limit = 5242880 where id in (''books'', ''knihy'', ''knizky'') and file_size_limit is null');
  perform pg_temp._x('Úložiště', 'update storage.buckets set public = false where id = ''knizky'' and public');
  perform pg_temp._log('Úložiště', 'ZMĚNA', 'Buckety book-texts (20 MB), books/knihy/knizky (5 MB): jen text/plain; bucket knizky je soukromý');
end $$;

-- ---------------------------------------------------------------------------
-- 7. INTERNÍ SCHÉMATA net (pg_net) a cron (pg_cron): klientské role tam nemají co dělat
--    Funkce SECURITY DEFINER (push oznámení) běží pod vlastníkem a nepotřebují právo od anon/authenticated.
-- ---------------------------------------------------------------------------
do $$
declare s text;
begin
  foreach s in array array['net', 'cron'] loop
    if exists (select 1 from pg_namespace where nspname = s) then
      perform pg_temp._x('Interní schémata', format('revoke all on all tables in schema %I from anon, authenticated', s));
      perform pg_temp._x('Interní schémata', format('revoke all on all sequences in schema %I from anon, authenticated', s));
      perform pg_temp._x('Interní schémata', format('revoke all on all functions in schema %I from anon, authenticated', s));
      perform pg_temp._x('Interní schémata', format('revoke usage on schema %I from anon, authenticated', s));
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 8. VÝCHOZÍ PRÁVA: co dostane nově založený objekt v public
--    Tabulky a sekvence: nová tabulka už neotevře roli anon. Funkce: nová funkce už nedostane právo PUBLIC (to je důvod, proč anon volá i funkce, kterým
--    ses anon výslovně vzal) ani výchozí právo pro anon; přihlášení a service_role je mají dál. Skutečné Supabase má výchozí práva i pro vlastníka
--    supabase_admin; ta postgres měnit nemusí smět, pak se to ukáže jako INFO.
-- ---------------------------------------------------------------------------
do $$
declare o text; n_ok int := 0;
begin
  foreach o in array array['postgres', 'supabase_admin'] loop
    if not exists (select 1 from pg_roles where rolname = o) then
      null;
    elsif not pg_has_role(current_user, o, 'member') then
      perform pg_temp._log('Výchozí práva', 'INFO', format('Výchozí práva vlastníka %s tu změnit nejde (nejsi jeho členem); nové objekty od něj dostanou práva podle Supabase. Nová tabulka bez zapnutého RLS by byla otevřená, proto RLS vždycky zapínej', o));
    else
      if pg_temp._x('Výchozí práva', format('alter default privileges for role %I in schema public revoke all on tables from anon', o)) then n_ok := n_ok + 1; end if;
      if pg_temp._x('Výchozí práva', format('alter default privileges for role %I in schema public revoke all on sequences from anon', o)) then n_ok := n_ok + 1; end if;
      if pg_temp._x('Výchozí práva', format('alter default privileges for role %I in schema public revoke all on functions from anon', o)) then n_ok := n_ok + 1; end if;
      if pg_temp._x('Výchozí práva', format('alter default privileges for role %I revoke execute on functions from public', o)) then n_ok := n_ok + 1; end if;
    end if;
  end loop;
  if n_ok > 0 then perform pg_temp._log('Výchozí práva', 'ZMĚNA', format('Nové tabulky, sekvence a funkce v public už nedostanou právo pro anon ani PUBLIC (%s nastavení)', n_ok)); end if;
end $$;

-- ---------------------------------------------------------------------------
-- 9. KONTROLA VÝSLEDKU (čte skutečná práva v databázi)
-- ---------------------------------------------------------------------------
do $$
declare
  v int; v_txt text;
begin
  select count(*) into v from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind in ('f', 'p') and has_function_privilege('anon', p.oid, 'execute')
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');
  perform pg_temp._log('Kontrola', case when v <= 2 then 'OK' else 'SELHALO' end, format('Funkce v public volatelné bez přihlášení: %s (čekáme 2: username_available_public, request_password_help)', v));

  select count(*) into v from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind in ('f', 'p') and p.prorettype = 'trigger'::regtype and has_function_privilege('authenticated', p.oid, 'execute')
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');
  perform pg_temp._log('Kontrola', case when v = 0 then 'OK' else 'SELHALO' end, format('Spouštěcí funkce volatelné přihlášeným: %s (čekáme 0)', v));

  select count(*), string_agg(c.relname, ', ') into v, v_txt from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and (has_table_privilege('anon', c.oid, 'insert') or has_table_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete') or has_table_privilege('anon', c.oid, 'truncate'))
     and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e');
  perform pg_temp._log('Kontrola', case when v = 0 then 'OK' else 'SELHALO' end, format('Tabulky, do kterých smí zapisovat anon: %s%s (čekáme 0)', v, coalesce(' (' || v_txt || ')', '')));

  select count(*), string_agg(c.relname, ', ') into v, v_txt from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f') and has_table_privilege('anon', c.oid, 'select')
     and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e');
  perform pg_temp._log('Kontrola', case when v <= 2 then 'OK' else 'SELHALO' end, format('Tabulky, které smí číst anon: %s%s (čekáme books a site_settings)', v, coalesce(' (' || v_txt || ')', '')));

  select count(*) into v from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and (has_table_privilege('authenticated', c.oid, 'truncate') or has_table_privilege('authenticated', c.oid, 'references') or has_table_privilege('authenticated', c.oid, 'trigger'))
     and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e');
  perform pg_temp._log('Kontrola', case when v = 0 then 'OK' else 'SELHALO' end, format('Tabulky s právem TRUNCATE/REFERENCES/TRIGGER pro přihlášené: %s (čekáme 0)', v));

  if to_regclass('public.profiles') is not null then
    perform pg_temp._log('Kontrola',
      case when has_column_privilege('authenticated', 'public.profiles', 'id', 'insert') and not has_column_privilege('authenticated', 'public.profiles', 'coins', 'insert') then 'OK' else 'SELHALO' end,
      'Přihlášený smí do profilu vložit id, ale ne coins (INSERT jen na vybrané sloupce)');
  end if;

  perform pg_temp._log('Kontrola', case when has_schema_privilege('anon', 'public', 'create') or has_schema_privilege('authenticated', 'public', 'create') then 'SELHALO' else 'OK' end, 'Klientské role nesmí zakládat objekty ve schématu public');

  foreach v_txt in array array['net._http_response', 'net.http_request_queue', 'cron.job', 'cron.job_run_details'] loop
    if to_regclass(v_txt) is not null then
      perform pg_temp._log('Kontrola',
        case when has_table_privilege('anon', v_txt, 'select') or has_table_privilege('authenticated', v_txt, 'select') then 'SELHALO' else 'OK' end,
        v_txt || ': klientské role ' || case when has_table_privilege('anon', v_txt, 'select') or has_table_privilege('authenticated', v_txt, 'select') then 'STÁLE SMĚJÍ ČÍST (Supabase to nedovolil zavřít; otoč heslo push oznámení, viz db/README.md)' else 'už nesmí číst' end);
    end if;
  end loop;
end $$;

select sekce, stav, detail
from pg_temp._hard_log
order by case stav when 'SELHALO' then 0 when 'CHYBA' then 1 when 'UPOZORNĚNÍ' then 2 when 'ZMĚNA' then 3 else 4 end, n;
