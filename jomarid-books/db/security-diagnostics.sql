-- =====================================================================================================================
-- Jomarid Books: BEZPEČNOSTNÍ DIAGNOSTIKA DATABÁZE
-- =====================================================================================================================
-- Jak: v Supabase otevři SQL Editor, vlož celý soubor a dej Run. Výsledek je JEDNA tabulka (nejzávažnější nálezy nahoře).
--      Klikni na Copy (nebo Export -> Copy as Markdown/CSV) a vlož ji do chatu. Nejdéle to trvá do minuty.
--
-- Co dělá: NIC NEMĚNÍ. Čte katalog databáze (tabulky, politiky RLS, práva, funkce, pohledy, úložiště, plánovač, role, rozšíření)
--          a navíc zkouší, co by útočník OPRAVDU mohl: pod rolí anon (bez přihlášení) a pod rolí přihlášeného čtenáře zkusí číst,
--          upravit, smazat a vložit řádky. Každá taková zkouška běží ve vlastní vnořené transakci a vždy se vrátí zpět (ROLLBACK),
--          takže v datech po ní nezůstane nic (ani jeden řádek, ani zůstatek mincí). Dočasné pomocné objekty zmizí po skončení spojení.
-- Co NEOBSAHUJE: žádná hesla, klíče, tokeny ani e-maily. U tajných míst (plánovač, vault, funkce) vypisuje jen názvy a to, zda se
--          v nich tajemství nachází, nikdy jeho hodnotu. Výsledek je tedy bezpečné poslat.
-- Co nevidí: nastavení v Supabase dashboardu (potvrzení e-mailu, délka hesla, CAPTCHA, adresy pro přesměrování, Edge Functions...).
--          Posledních pár řádků výsledku je proto ruční kontrolní seznam, projdi ho.
--
-- Supabase se může zeptat, zda tabulku "_diag" spustit s RLS: jde o dočasnou tabulku jen pro tohle spojení, můžeš odpovědět jakkoli.
--
-- Je-li výsledek moc dlouhý: v řádku "v_inventory boolean := true" dole změň true na false (zmizí výpis všech tabulek, politik a funkcí,
--          zůstanou jen nálezy). Inventář pak můžu doptat zvlášť.
-- =====================================================================================================================

create temp table if not exists _diag (sev int not null, sekce text not null, objekt text, nalez text not null, detail text);
delete from pg_temp._diag where true;

create or replace function pg_temp._d(p_sev int, p_sekce text, p_objekt text, p_nalez text, p_detail text default null)
returns void language sql as $f$ insert into pg_temp._diag values (p_sev, p_sekce, p_objekt, p_nalez, left(p_detail, 700)) $f$;

-- Zkušební příkaz pod cizí rolí. Vždy skončí vrácením zpět (výjimka na konci bloku zruší vše, co příkaz udělal).
-- Vrací 'ok:N' (příkaz prošel, N řádků) nebo 'err:SQLSTATE:zpráva' (příkaz byl odmítnut).
create or replace function pg_temp._probe(p_role text, p_uid uuid, p_sql text, p_mode text default 'dml') returns text
language plpgsql as $f$
declare n numeric;
begin
  begin
    execute format('set local role %I', p_role);
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', p_role)::text, true);
    perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
    perform set_config('request.jwt.claim.role', p_role, true);
    if p_mode = 'n' then execute p_sql into n; else execute p_sql; get diagnostics n = row_count; end if;
    raise exception '__probe__%', coalesce(n::text, 'null') using errcode = 'P0001';
  exception when others then
    if sqlerrm like '\_\_probe\_\_%' then return 'ok:' || substr(sqlerrm, 10); end if;
    return 'err:' || sqlstate || ':' || left(replace(sqlerrm, E'\n', ' '), 140);
  end;
end $f$;

-- ok:N s N > 0: příkaz opravdu něco změnil / vrátil.
create or replace function pg_temp._hit(p text) returns boolean language sql immutable as $f$
  select p like 'ok:%' and coalesce(nullif(substr(p, 4), 'null'), '0')::numeric > 0 $f$;
-- Zápis prošel kontrolou práv a RLS (a selhal až na omezení sloupců, např. povinná hodnota): chrání-li něco, není to RLS.
create or replace function pg_temp._passed(p text) returns boolean language sql immutable as $f$
  select pg_temp._hit(p) or p ~ '^err:(23502|23503|23505|23514|22P02|22003|22007|22001|42804|23000|23502)' $f$;
create or replace function pg_temp._cnt(p text) returns bigint language sql immutable as $f$
  select case when p like 'ok:%' then coalesce(nullif(substr(p, 4), 'null'), '0')::numeric::bigint else null end $f$;

do $diag$
#variable_conflict use_column
declare
  v_inventory boolean := true;  -- false = jen nálezy, bez výpisu všech politik, tabulek a funkcí
  v_exposed text[];
  v_sens_read text := '(email|e_mail|phone|telefon|mobil|password|passwd|pwd|hash|token|secret|api_?key|private|birth|narozen|address|adresa|ip_?addr|iban|card|otp|refresh|p256dh|endpoint|(^|_)auth($|_))';
  v_sens_write text := '(role|admin|coin|balance|credit|xp|bonus|premium|verified|vip|price|plan|ban|permission|owner|licen|streak|freez|frozen|badge|score|must_change|status|approved|hidden|lifetime|highest|fake|email)';
  v_benign_write text := '^(featured_badge|show_in_leaderboard)$';  -- tyhle sloupce appka čtenáři záměrně nechává měnit
  v_standard_roles text[] := array['postgres','anon','authenticated','service_role','authenticator','supabase_admin','supabase_auth_admin','supabase_storage_admin','supabase_read_only_user','dashboard_user','pgbouncer','supabase_replication_admin','supabase_etl_admin','supabase_functions_admin','supabase_realtime_admin','supabase_privileged_role','supabase_realtime_admin','pgsodium_keyholder','pgsodium_keyiduser','pgsodium_keymaker','cli_login_postgres'];
  r record; t record; c record;
  v_n bigint; v_m bigint; v_txt text; v_txt2 text; v_flag text; v_list text; v_list2 text;
  v_u uuid; v_v uuid; v_adminrole text; v_other uuid; v_adm uuid; v_triv_u text; v_triv_a text;
  v_has_profiles boolean; v_has_role boolean;
  v_src text; v_has_uid boolean; v_has_admin boolean; v_has_sp boolean; v_dyn boolean; v_secret boolean; v_email boolean; v_userarg boolean;
  v_acc_anon_w text := ''; v_acc_trunc text := ''; v_priv_anon text; v_priv_auth text; v_pol_n int; v_res text; v_expr text; v_kind text; v_tab text; v_owner text;
begin
  v_exposed := array['public'];
  -- =================================================================================================================
  -- A. Instance a rozsah
  -- =================================================================================================================
  begin
  perform pg_temp._d(5, 'A. Instance', 'verze', 'PostgreSQL', version());
  select setting into v_txt from pg_settings where name = 'password_encryption';
  if v_txt is distinct from 'scram-sha-256' then perform pg_temp._d(2, 'A. Instance', 'password_encryption', 'Hesla rolí se ukládají slabším způsobem', coalesce(v_txt, '?') || ' (má být scram-sha-256)'); end if;
  select setting into v_txt from pg_settings where name = 'row_security';
  if v_txt is distinct from 'on' then perform pg_temp._d(1, 'A. Instance', 'row_security', 'Row-level security je v tomto spojení VYPNUTÉ', coalesce(v_txt, '?')); end if;

  select coalesce(array_agg(trim(s)), array['public']) into v_exposed
  from (select regexp_split_to_table(substring(cfg from 'pgrst\.db_schemas=(.*)$'), ',') s
        from (select unnest(setconfig) cfg from pg_db_role_setting where setrole = (select oid from pg_roles where rolname = 'authenticator')) q
        where cfg like 'pgrst.db_schemas=%') x
  where trim(s) <> '' and trim(s) not in ('graphql_public');
  if v_exposed is null or cardinality(v_exposed) = 0 then v_exposed := array['public']; end if;
  perform pg_temp._d(5, 'A. Instance', 'schémata dostupná přes API', array_to_string(v_exposed, ', '), 'Z dashboardu (Settings -> API -> Exposed schemas) ověř, že je tu jen to, co appka potřebuje (public).');
  exception when others then
    perform pg_temp._d(3, 'Z. Chyba skriptu', 'část A', 'Tuhle část diagnostiky se nepodařilo dokončit (ostatní jsou v pořádku)', sqlerrm);
  end;

  -- =================================================================================================================
  -- B. Tabulky: RLS a práva rolí anon a authenticated
  -- =================================================================================================================
  begin
  for r in
    select n.nspname, c.relname, c.oid, c.relrowsecurity rls, c.relforcerowsecurity frls, greatest(c.reltuples, 0)::bigint est
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = any(v_exposed) and c.relkind in ('r', 'p')
      and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
    order by 1, 2
  loop
    select concat_ws('', case when has_table_privilege('anon', r.oid, 'SELECT') then 'r' end, case when has_table_privilege('anon', r.oid, 'INSERT') then 'a' end,
      case when has_table_privilege('anon', r.oid, 'UPDATE') then 'w' end, case when has_table_privilege('anon', r.oid, 'DELETE') then 'd' end,
      case when has_table_privilege('anon', r.oid, 'TRUNCATE') then 'D' end, case when has_table_privilege('anon', r.oid, 'REFERENCES') then 'x' end,
      case when has_table_privilege('anon', r.oid, 'TRIGGER') then 't' end) into v_priv_anon;
    select concat_ws('', case when has_table_privilege('authenticated', r.oid, 'SELECT') then 'r' end, case when has_table_privilege('authenticated', r.oid, 'INSERT') then 'a' end,
      case when has_table_privilege('authenticated', r.oid, 'UPDATE') then 'w' end, case when has_table_privilege('authenticated', r.oid, 'DELETE') then 'd' end,
      case when has_table_privilege('authenticated', r.oid, 'TRUNCATE') then 'D' end, case when has_table_privilege('authenticated', r.oid, 'REFERENCES') then 'x' end,
      case when has_table_privilege('authenticated', r.oid, 'TRIGGER') then 't' end) into v_priv_auth;
    select count(*) into v_pol_n from pg_policy p where p.polrelid = r.oid;
    v_tab := r.nspname || '.' || r.relname;

    if not r.rls and (v_priv_anon <> '' or v_priv_auth <> '') then
      perform pg_temp._d(1, 'B. Tabulky', v_tab, 'RLS je VYPNUTÉ a role mají práva: tabulku může číst i měnit každý s veřejným klíčem', 'anon=' || coalesce(nullif(v_priv_anon, ''), '-') || ' přihlášený=' || coalesce(nullif(v_priv_auth, ''), '-') || ' (~' || r.est || ' řádků)');
    elsif v_priv_anon ~ '[awd]' then
      v_acc_anon_w := v_acc_anon_w || case when v_acc_anon_w = '' then '' else ', ' end || r.relname || ' (' || v_priv_anon || ')';
    end if;
    if r.rls and (v_priv_anon ~ '[Dxt]' or v_priv_auth ~ '[Dxt]') then
      v_acc_trunc := v_acc_trunc || case when v_acc_trunc = '' then '' else ', ' end || r.relname;
    end if;
    if v_inventory then
      perform pg_temp._d(5, 'B. Tabulky (inventář)', v_tab, 'RLS ' || case when r.rls then 'zapnuté' else 'VYPNUTÉ' end || case when r.frls then ' (vynucené)' else '' end,
        '~' || r.est || ' řádků, politik: ' || v_pol_n || ', anon=' || coalesce(nullif(v_priv_anon, ''), '-') || ', přihlášený=' || coalesce(nullif(v_priv_auth, ''), '-'));
    end if;
  end loop;

  if v_acc_anon_w <> '' then perform pg_temp._d(3, 'B. Tabulky', '(souhrn)', 'Role anon (bez přihlášení) má právo zapisovat do těchto tabulek (chrání je jen politiky RLS)', v_acc_anon_w); end if;
  if v_acc_trunc <> '' then perform pg_temp._d(4, 'B. Tabulky', '(souhrn)', 'Zbytečná práva TRUNCATE/REFERENCES/TRIGGER u těchto tabulek (TRUNCATE obchází RLS)', v_acc_trunc); end if;
  exception when others then
    perform pg_temp._d(3, 'Z. Chyba skriptu', 'část B', 'Tuhle část diagnostiky se nepodařilo dokončit (ostatní jsou v pořádku)', sqlerrm);
  end;

  -- =================================================================================================================
  -- C. Politiky RLS
  -- =================================================================================================================
  begin
  for r in
    select schemaname, tablename, policyname, permissive, roles, cmd, coalesce(qual, '') qual, coalesce(with_check, '') chk, qual is null as qual_null, with_check is null as chk_null
    from pg_policies
    where schemaname = any(v_exposed) or schemaname in ('storage', 'realtime')
    order by 1, 2, 3
  loop
    v_tab := r.schemaname || '.' || r.tablename;
    v_flag := lower(r.qual || ' ' || r.chk);
    v_list := array_to_string(r.roles, ',');
    -- komu politika platí: bez přihlášení (anon / public), nebo všem přihlášeným
    if r.cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL') and (r.qual = 'true' or r.chk = 'true' or (r.cmd = 'INSERT' and r.chk_null)) then
      perform pg_temp._d(case when r.roles && array['public', 'anon']::name[] then 1 else 2 end, 'C. Politiky', v_tab,
        'Politika "' || r.policyname || '" povoluje zápis komukoli (podmínka je vždy true)', r.cmd || ' pro ' || v_list);
    end if;
    if v_flag ~ 'user_metadata|raw_user_meta_data' then
      perform pg_temp._d(1, 'C. Politiky', v_tab, 'Politika "' || r.policyname || '" věří údajům, které si uživatel sám nastaví (user_metadata)', r.cmd || ' pro ' || v_list || ' | ' || left(v_flag, 250));
    end if;
    if r.cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL') and v_flag ~ '^\(*(auth\.role\(\)\s*=\s*''authenticated''|auth\.uid\(\)\s+is\s+not\s+null|\(select auth\.uid\(\)\)\s+is\s+not\s+null)\)*\s*$' then
      perform pg_temp._d(2, 'C. Politiky', v_tab, 'Politika "' || r.policyname || '" jen vyžaduje přihlášení: zapisovat může každý přihlášený', r.cmd || ' | ' || left(v_flag, 200));
    end if;
    if r.cmd in ('SELECT', 'ALL') and r.qual = 'true' then
      select string_agg(a.attname::text, ', ') into v_txt from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = r.schemaname and c.relname = r.tablename and a.attnum > 0 and not a.attisdropped and a.attname ~* v_sens_read;
      if r.roles && array['public', 'anon']::name[] then
        perform pg_temp._d(case when v_txt is not null then 1 else 3 end, 'C. Politiky', v_tab, 'Čtení pro anon (bez přihlášení) bez omezení' || case when v_txt is not null then ' a tabulka má citlivé sloupce' else '' end, 'Politika "' || r.policyname || '"' || coalesce(' | sloupce: ' || v_txt, ''));
      elsif v_txt is not null then
        perform pg_temp._d(2, 'C. Politiky', v_tab, 'Každý přihlášený smí číst všechny řádky tabulky s citlivými sloupci', 'Politika "' || r.policyname || '" | sloupce: ' || v_txt);
      end if;
    end if;
    if r.schemaname = 'storage' and r.tablename = 'objects' and v_flag !~ 'bucket_id' and r.cmd in ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'ALL') then
      perform pg_temp._d(2, 'C. Politiky', v_tab, 'Storage politika "' || r.policyname || '" nezužuje bucket (platí pro všechny buckety)', r.cmd || ' pro ' || v_list);
    end if;
    if v_flag ~ 'eyj[a-z0-9_-]{20,}' then
      perform pg_temp._d(1, 'C. Politiky', v_tab, 'Politika "' || r.policyname || '" obsahuje zapsaný klíč (JWT)', null);
    end if;
    if v_inventory then
      perform pg_temp._d(5, 'C. Politiky (inventář)', v_tab, r.policyname, r.cmd || ' pro ' || v_list || case when r.permissive = 'PERMISSIVE' then '' else ' [RESTRICTIVE]' end
        || ' | USING: ' || left(coalesce(nullif(r.qual, ''), '-'), 260) || ' | CHECK: ' || left(coalesce(nullif(r.chk, ''), '-'), 200));
    end if;
  end loop;
  exception when others then
    perform pg_temp._d(3, 'Z. Chyba skriptu', 'část C', 'Tuhle část diagnostiky se nepodařilo dokončit (ostatní jsou v pořádku)', sqlerrm);
  end;

  -- =================================================================================================================
  -- D. Funkce (RPC)
  -- =================================================================================================================
  begin
  for r in
    select n.nspname, p.oid, p.proname, pg_get_function_identity_arguments(p.oid) args, p.prosecdef, p.proconfig, p.provolatile, p.pronargs,
           pg_get_userbyid(p.proowner) owner, p.prorettype::regtype::text rtype, p.prosrc src,
           has_function_privilege('anon', p.oid, 'EXECUTE') anon_x, has_function_privilege('authenticated', p.oid, 'EXECUTE') auth_x
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = any(v_exposed) and p.prokind in ('f', 'p')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
    order by 1, 3, 4
  loop
    v_tab := r.nspname || '.' || r.proname || '(' || left(r.args, 60) || ')';
    v_src := coalesce(r.src, '');
    v_has_uid := v_src ~* 'auth\.uid\(\)|auth\.jwt\(\)|request\.jwt|short_uid\(\)|publisher_require|admin_require|notif_require_admin';
    v_has_admin := v_src ~* 'admin|správ|require_role|is_staff|publisher_require|short_require_writer|short_is_admin|app_current_role|app_is_book_author|app_owns_book';
    v_has_sp := r.proconfig is not null and exists (select 1 from unnest(r.proconfig) cfg where cfg like 'search_path=%');
    v_dyn := v_src ~* '\mexecute\M' and (v_src ~ '\|\|' or v_src ~* 'format\s*\([^)]*%s');
    v_secret := v_src ~ 'eyJ[A-Za-z0-9_-]{20,}' or v_src ~* 'sb_secret_|service_role_key|sbp_[a-z0-9]{20,}|BEGIN (RSA |EC )?PRIVATE KEY';
    v_email := v_src ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}';
    v_userarg := r.args ~* '(user|uid|profile|owner|author|reader)(_id)?\s+uuid';

    if r.prosecdef and not v_has_sp then
      perform pg_temp._d(2, 'D. Funkce', v_tab, 'SECURITY DEFINER bez pevného search_path (hrozí podvržení cizí funkce či tabulky)', 'vlastník ' || r.owner);
    end if;
    if r.prosecdef and r.anon_x and r.rtype <> 'trigger' then
      if r.proname in ('username_available_public', 'request_password_help') then
        perform pg_temp._d(4, 'D. Funkce', v_tab, 'Funkce SECURITY DEFINER je záměrně veřejná (bez přihlášení)', 'zkontroluj omezení počtu volání (zneužití k hádání jmen/e-mailů)');
      elsif not v_has_uid then
        perform pg_temp._d(1, 'D. Funkce', v_tab, 'Bez přihlášení (anon) jde zavolat funkci SECURITY DEFINER, která nekontroluje auth.uid()', 'volatilita ' || r.provolatile::text);
      else
        perform pg_temp._d(3, 'D. Funkce', v_tab, 'Bez přihlášení (anon) jde funkci zavolat (kontroluje auth.uid(), ale má být zavřená)', 'doporučení: revoke execute from anon');
      end if;
    end if;
    if r.prosecdef and r.auth_x and r.rtype <> 'trigger' and not v_has_uid and not v_has_admin and r.proname not in ('username_available_public', 'request_password_help') then
      perform pg_temp._d(case when r.provolatile = 'v' then 2 else 3 end, 'D. Funkce', v_tab, 'Přihlášený smí zavolat funkci SECURITY DEFINER, která nekontroluje ani uživatele, ani roli', case when r.provolatile = 'v' then 'ZAPISUJE (volatile)' else 'jen čte' end);
    end if;
    if r.prosecdef and r.auth_x and v_userarg and not v_has_uid then
      perform pg_temp._d(case when v_has_admin then 4 else 2 end, 'D. Funkce', v_tab, 'Funkce bere id uživatele jako parametr a nekontroluje auth.uid()' || case when v_has_admin then ' (kontroluje roli správce)' else ' ani roli správce (cizí data?)' end, null);
    end if;
    if r.proname ~ '^admin_' and (r.anon_x or (r.prosecdef and not v_has_admin)) then
      perform pg_temp._d(1, 'D. Funkce', v_tab, 'Funkce správce ' || case when r.anon_x then 'je volatelná bez přihlášení' else 'nekontroluje roli správce' end, null);
    end if;
    if r.proname ~ '(_tick$|^push_engagement|^send_push_|redeem_login_code|^cron_|^internal_)' and (r.anon_x or r.auth_x) then
      perform pg_temp._d(1, 'D. Funkce', v_tab, 'Interní funkce (má být jen pro service_role/plánovač) je volatelná z klienta', 'anon=' || r.anon_x || ' přihlášený=' || r.auth_x);
    end if;
    if v_dyn then perform pg_temp._d(3, 'D. Funkce', v_tab, 'Dynamické SQL se skládáním textu (kandidát na SQL injection)', 'ověř, že se hodnoty vkládají přes %I/%L nebo USING'); end if;
    if v_secret then perform pg_temp._d(1, 'D. Funkce', v_tab, 'V těle funkce je zapsané tajemství (klíč/token)', 'nepřepisuju hodnotu, jen upozorňuju'); end if;
    if v_email then perform pg_temp._d(4, 'D. Funkce', v_tab, 'V těle funkce je zapsaná e-mailová adresa (pevně zadaný správce?)', null); end if;
    if v_inventory and r.prosecdef then
      perform pg_temp._d(5, 'D. Funkce (inventář SECURITY DEFINER)', v_tab, case when r.anon_x then 'ANON smí volat' else 'anon nesmí' end,
        'přihlášený=' || case when r.auth_x then 'smí' else 'nesmí' end || ' search_path=' || case when v_has_sp then 'pevný' else 'CHYBÍ' end || ' auth.uid=' || case when v_has_uid then 'ano' else 'ne' end
        || ' správce=' || case when v_has_admin then 'ano' else 'ne' end || ' vlastník=' || r.owner);
    end if;
  end loop;
  select count(*) filter (where p.prosecdef), count(*) into v_n, v_m
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = any(v_exposed) and p.prokind in ('f', 'p') and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e');
  perform pg_temp._d(5, 'D. Funkce (souhrn)', 'celkem', v_m || ' funkcí', 'z toho SECURITY DEFINER: ' || v_n);
  exception when others then
    perform pg_temp._d(3, 'Z. Chyba skriptu', 'část D', 'Tuhle část diagnostiky se nepodařilo dokončit (ostatní jsou v pořádku)', sqlerrm);
  end;

  -- =================================================================================================================
  -- E. Pohledy
  -- =================================================================================================================
  begin
  for r in
    select n.nspname, c.relname, c.relkind, c.reloptions, pg_get_userbyid(c.relowner) owner,
           has_table_privilege('anon', c.oid, 'SELECT') anon_r, has_table_privilege('authenticated', c.oid, 'SELECT') auth_r
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = any(v_exposed) and c.relkind in ('v', 'm', 'f') and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
  loop
    v_tab := r.nspname || '.' || r.relname;
    if r.relkind = 'v' and (r.anon_r or r.auth_r) and not coalesce(r.reloptions::text ilike '%security_invoker=true%' or r.reloptions::text ilike '%security_invoker=on%', false) then
      perform pg_temp._d(2, 'E. Pohledy', v_tab, 'Pohled běží s právy vlastníka a obchází RLS (chybí security_invoker)', 'vlastník ' || r.owner || ' anon=' || r.anon_r || ' přihlášený=' || r.auth_r);
    elsif r.relkind = 'm' and (r.anon_r or r.auth_r) then
      perform pg_temp._d(3, 'E. Pohledy', v_tab, 'Materializovaný pohled je dostupný přes API a nemůže mít RLS', 'anon=' || r.anon_r || ' přihlášený=' || r.auth_r);
    elsif r.relkind = 'f' and (r.anon_r or r.auth_r) then
      perform pg_temp._d(3, 'E. Pohledy', v_tab, 'Cizí tabulka (foreign) je dostupná přes API', null);
    end if;
    if v_inventory then perform pg_temp._d(5, 'E. Pohledy (inventář)', v_tab, case r.relkind when 'v' then 'pohled' when 'm' then 'materializovaný pohled' else 'cizí tabulka' end, coalesce(r.reloptions::text, 'bez voleb')); end if;
  end loop;
  exception when others then
    perform pg_temp._d(3, 'Z. Chyba skriptu', 'část E', 'Tuhle část diagnostiky se nepodařilo dokončit (ostatní jsou v pořádku)', sqlerrm);
  end;

  -- =================================================================================================================
  -- F. Citlivé sloupce a co je smí přečíst
  -- =================================================================================================================
  begin
  for r in
    select n.nspname, c.relname, c.oid, c.relrowsecurity rls, string_agg(a.attname::text, ', ' order by a.attnum) cols,
           has_table_privilege('anon', c.oid, 'SELECT') anon_r, has_table_privilege('authenticated', c.oid, 'SELECT') auth_r
    from pg_class c join pg_namespace n on n.oid = c.relnamespace join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where n.nspname = any(v_exposed) and c.relkind in ('r', 'p') and a.attname ~* v_sens_read
    group by 1, 2, 3, 4
  loop
    v_tab := r.nspname || '.' || r.relname;
    if r.anon_r and not r.rls then
      perform pg_temp._d(1, 'F. Citlivé sloupce', v_tab, 'Citlivé sloupce jsou čitelné bez přihlášení (RLS vypnuté)', r.cols);
    elsif r.anon_r and exists (select 1 from pg_policies p where p.schemaname = r.nspname and p.tablename = r.relname and p.cmd in ('SELECT', 'ALL') and p.roles && array['public', 'anon']::name[] and p.qual = 'true') then
      perform pg_temp._d(1, 'F. Citlivé sloupce', v_tab, 'Citlivé sloupce jsou čitelné bez přihlášení (politika true)', r.cols);
    elsif r.auth_r and (not r.rls or exists (select 1 from pg_policies p where p.schemaname = r.nspname and p.tablename = r.relname and p.cmd in ('SELECT', 'ALL') and p.roles && array['public', 'authenticated']::name[] and p.qual = 'true')) then
      perform pg_temp._d(2, 'F. Citlivé sloupce', v_tab, 'Citlivé sloupce vidí každý přihlášený u všech řádků', r.cols);
    elsif v_inventory then
      perform pg_temp._d(5, 'F. Citlivé sloupce (inventář)', v_tab, 'má sloupce, které vypadají citlivě', r.cols);
    end if;
  end loop;
  exception when others then
    perform pg_temp._d(3, 'Z. Chyba skriptu', 'část F', 'Tuhle část diagnostiky se nepodařilo dokončit (ostatní jsou v pořádku)', sqlerrm);
  end;

  -- =================================================================================================================
  -- G. Schéma auth, uživatelé a registrační trigger (jen počty, žádná data)
  -- =================================================================================================================
  begin
  if to_regclass('auth.users') is not null then
    execute 'select count(*) from auth.users' into v_n;
    perform pg_temp._d(5, 'G. Uživatelé', 'auth.users', 'počet účtů', v_n::text);
    if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'email_confirmed_at') then
      execute 'select count(*) from auth.users where email_confirmed_at is null' into v_n;
      v_m := 0;
      if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'created_at') then
        execute 'select count(*) from auth.users where email_confirmed_at is null and created_at < now() - interval ''7 days''' into v_m;
      end if;
      if v_n > 0 then perform pg_temp._d(case when v_m > 0 then 3 else 4 end, 'G. Uživatelé', 'auth.users', 'Neověřené e-maily', v_n || ' účtů, z toho starších než týden: ' || v_m || ' (bez povinného potvrzení e-mailu se dá registrovat cizím e-mailem)'); end if;
    end if;
    if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'is_anonymous') then
      execute 'select count(*) from auth.users where is_anonymous' into v_n;
      if v_n > 0 then perform pg_temp._d(3, 'G. Uživatelé', 'auth.users', 'Existují anonymní účty', v_n || ' (zakázat anonymní přihlášení, pokud ho appka nepoužívá)'); end if;
    end if;
    if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'raw_user_meta_data') then
      execute 'select count(*) from auth.users where raw_user_meta_data ?| array[''role'', ''is_admin'', ''admin'', ''roles'']' into v_n;
      if v_n > 0 then perform pg_temp._d(2, 'G. Uživatelé', 'auth.users', 'V user_metadata některých účtů je role/admin (uživatel si ji nastavil sám při registraci)', v_n || ' účtů; nikde se na to nesmí spoléhat'); end if;
    end if;
    if has_table_privilege('anon', 'auth.users', 'SELECT') or has_table_privilege('authenticated', 'auth.users', 'SELECT') then
      perform pg_temp._d(1, 'G. Uživatelé', 'auth.users', 'Role anon/authenticated smí číst tabulku uživatelů', null);
    end if;
  end if;
  v_has_profiles := to_regclass('public.profiles') is not null;
  v_has_role := v_has_profiles and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'role');
  if v_has_role then
    for r in execute 'select coalesce(role, ''(prázdná)'') role, count(*) n from public.profiles group by 1 order by 2 desc' loop
      perform pg_temp._d(case when r.role ~* 'admin|správ' and r.n > 3 then 4 else 5 end, 'G. Uživatelé', 'profiles.role', 'Role "' || r.role || '"', r.n || ' účtů');
    end loop;
  end if;
  for r in
    select c.relname, t.tgname, p.proname, p.prosrc, p.prosecdef, p.proconfig
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace join pg_proc p on p.oid = t.tgfoid
    where n.nspname = 'auth' and c.relname = 'users' and not t.tgisinternal
  loop
    if r.prosrc ~* 'raw_user_meta_data' and r.prosrc ~* 'role|admin' then
      perform pg_temp._d(1, 'G. Uživatelé', 'trigger ' || r.tgname, 'Registrační trigger kopíruje roli/admin z user_metadata (uživatel si ji nastaví sám)', 'funkce ' || r.proname);
    else
      perform pg_temp._d(5, 'G. Uživatelé', 'trigger ' || r.tgname, 'trigger na auth.users', 'funkce ' || r.proname || case when r.prosecdef then ', SECURITY DEFINER' else '' end);
    end if;
  end loop;
  exception when others then
    perform pg_temp._d(3, 'Z. Chyba skriptu', 'část G', 'Tuhle část diagnostiky se nepodařilo dokončit (ostatní jsou v pořádku)', sqlerrm);
  end;

  -- =================================================================================================================
  -- H. Úložiště (Storage)
  -- =================================================================================================================
  begin
  if to_regclass('storage.buckets') is not null then
    for r in execute 'select id::text id, name, public, file_size_limit, allowed_mime_types::text mimes from storage.buckets order by name' loop
      v_txt := '';
      if to_regclass('storage.objects') is not null then
        execute format('select count(*), coalesce(sum(nullif(metadata->>''size'', '''')::bigint), 0) from storage.objects where bucket_id = %L', r.id) into v_n, v_m;
        v_txt := ' | souborů: ' || v_n || ', ' || (v_m / 1048576) || ' MB';
      end if;
      if r.public then perform pg_temp._d(3, 'H. Storage', 'bucket ' || r.name, 'Veřejný bucket: soubory čte kdokoli, kdo zná odkaz', 'ověř, že v něm nejsou placené knihy ani osobní data' || v_txt);
      else perform pg_temp._d(5, 'H. Storage', 'bucket ' || r.name, 'soukromý bucket', coalesce('limit ' || r.file_size_limit, 'bez limitu velikosti') || ', typy: ' || coalesce(r.mimes, 'bez omezení') || v_txt); end if;
      if r.file_size_limit is null then perform pg_temp._d(4, 'H. Storage', 'bucket ' || r.name, 'Bez limitu velikosti souboru', null); end if;
      if r.mimes is null then perform pg_temp._d(4, 'H. Storage', 'bucket ' || r.name, 'Bez omezení typů souborů (lze nahrát cokoli, i HTML/skript)', null); end if;
    end loop;
    if to_regclass('storage.objects') is not null and not coalesce((select relrowsecurity from pg_class where oid = to_regclass('storage.objects')), false) then
      perform pg_temp._d(1, 'H. Storage', 'storage.objects', 'RLS na souborech je VYPNUTÉ', null);
    end if;
  end if;
  exception when others then
    perform pg_temp._d(3, 'Z. Chyba skriptu', 'část H', 'Tuhle část diagnostiky se nepodařilo dokončit (ostatní jsou v pořádku)', sqlerrm);
  end;

  -- =================================================================================================================
  -- I. Realtime
  -- =================================================================================================================
  begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    for r in select pt.schemaname, pt.tablename, c.relrowsecurity rls from pg_publication_tables pt join pg_class c on c.relname = pt.tablename and c.relnamespace = pt.schemaname::regnamespace where pt.pubname = 'supabase_realtime' loop
      if not r.rls then perform pg_temp._d(1, 'I. Realtime', r.schemaname || '.' || r.tablename, 'Tabulka je v realtime a nemá RLS: změny řádků může odposlouchávat kdokoli', null);
      else perform pg_temp._d(5, 'I. Realtime', r.schemaname || '.' || r.tablename, 'realtime publikuje změny (platí RLS)', null); end if;
    end loop;
  end if;
  exception when others then
    perform pg_temp._d(3, 'Z. Chyba skriptu', 'část I', 'Tuhle část diagnostiky se nepodařilo dokončit (ostatní jsou v pořádku)', sqlerrm);
  end;

  -- =================================================================================================================
  -- J. Rozšíření
  -- =================================================================================================================
  begin
  for r in select e.extname, e.extversion, n.nspname, ae.default_version from pg_extension e join pg_namespace n on n.oid = e.extnamespace left join pg_available_extensions ae on ae.name = e.extname order by 1 loop
    if r.nspname = 'public' then perform pg_temp._d(4, 'J. Rozšíření', r.extname, 'Rozšíření je ve schématu public (přesunout do extensions)', 'verze ' || r.extversion); end if;
    if r.extname in ('plpython3u', 'plperlu', 'plpythonu', 'file_fdw', 'dblink', 'postgres_fdw') then perform pg_temp._d(3, 'J. Rozšíření', r.extname, 'Rozšíření umožňuje volat ven / spouštět kód', 'zvaž, zda ho appka potřebuje'); end if;
    if v_inventory then perform pg_temp._d(5, 'J. Rozšíření (inventář)', r.extname, 'verze ' || r.extversion || case when r.default_version is distinct from r.extversion then ' (dostupná novější: ' || coalesce(r.default_version, '?') || ')' else '' end, 'schéma ' || r.nspname); end if;
  end loop;
  exception when others then
    perform pg_temp._d(3, 'Z. Chyba skriptu', 'část J', 'Tuhle část diagnostiky se nepodařilo dokončit (ostatní jsou v pořádku)', sqlerrm);
  end;

  -- =================================================================================================================
  -- K. Role, výchozí práva, přístup do systémových schémat
  -- =================================================================================================================
  begin
  for r in select rolname, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls, rolcanlogin, rolreplication, rolvaliduntil from pg_roles where rolname !~ '^pg_' order by 1 loop
    if r.rolname in ('anon', 'authenticated') and (r.rolsuper or r.rolbypassrls or r.rolcreaterole or r.rolcanlogin) then
      perform pg_temp._d(1, 'K. Role', r.rolname, 'Role pro klienty má nebezpečné vlastnosti', 'super=' || r.rolsuper || ' bypassrls=' || r.rolbypassrls || ' createrole=' || r.rolcreaterole || ' login=' || r.rolcanlogin);
    elsif r.rolname <> all(v_standard_roles) and (r.rolsuper or r.rolbypassrls or r.rolcreaterole) then
      perform pg_temp._d(2, 'K. Role', r.rolname, 'Neznámá role s vysokými právy', 'super=' || r.rolsuper || ' bypassrls=' || r.rolbypassrls || ' createrole=' || r.rolcreaterole || ' login=' || r.rolcanlogin);
    elsif r.rolname <> all(v_standard_roles) and r.rolcanlogin then
      perform pg_temp._d(3, 'K. Role', r.rolname, 'Neznámá role, která se může přihlásit k databázi', 'platnost hesla: ' || coalesce(r.rolvaliduntil::text, 'neomezená'));
    end if;
    if v_inventory then perform pg_temp._d(5, 'K. Role (inventář)', r.rolname, 'super=' || r.rolsuper || ' bypassrls=' || r.rolbypassrls || ' login=' || r.rolcanlogin, null); end if;
  end loop;
  for r in
    select r.rolname role, m.rolname member from pg_auth_members am join pg_roles r on r.oid = am.roleid join pg_roles m on m.oid = am.member
    where m.rolname in ('anon', 'authenticated') and (r.rolsuper or r.rolbypassrls or r.rolcreaterole or r.rolname in ('service_role', 'postgres', 'supabase_admin'))
  loop
    perform pg_temp._d(1, 'K. Role', r.member, 'Role pro klienty je členem silné role ' || r.role, null);
  end loop;
  for r in select n.nspname, pg_get_userbyid(d.defaclrole) owner, d.defaclobjtype typ, d.defaclacl::text acl from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace loop
    if r.acl ~ '(^|[{,"])anon=' then
      perform pg_temp._d(3, 'K. Výchozí práva', coalesce(r.nspname, '(vše)') || ' / vlastník ' || r.owner || ' / ' || case r.typ when 'r' then 'tabulky' when 'f' then 'funkce' when 'S' then 'sekvence' else r.typ::text end,
        'Nové objekty se automaticky otevřou roli anon (zapomenutá RLS = otevřená tabulka)', 'doporučení: alter default privileges ... revoke all from anon');
    end if;
  end loop;
  for r in select nspname from pg_namespace where nspname !~ '^pg_' and nspname <> 'information_schema' order by 1 loop
    if has_schema_privilege('anon', r.nspname, 'CREATE') or has_schema_privilege('authenticated', r.nspname, 'CREATE') then
      perform pg_temp._d(1, 'K. Role', 'schéma ' || r.nspname, 'Role anon/authenticated smí ve schématu vytvářet objekty (CREATE)', null);
    end if;
    if r.nspname in ('vault', 'cron', 'pgsodium', 'net', 'supabase_functions', 'pgsodium_masks') and (has_schema_privilege('anon', r.nspname, 'USAGE') or has_schema_privilege('authenticated', r.nspname, 'USAGE')) then
      perform pg_temp._d(3, 'K. Role', 'schéma ' || r.nspname, 'Klientské role mají přístup do interního schématu', null);
    end if;
  end loop;
  foreach v_txt in array array['auth.users', 'auth.sessions', 'auth.refresh_tokens', 'auth.identities', 'auth.mfa_factors', 'auth.one_time_tokens', 'vault.secrets', 'vault.decrypted_secrets', 'cron.job', 'cron.job_run_details', 'net._http_response', 'net.http_request_queue', 'supabase_functions.hooks'] loop
    if to_regclass(v_txt) is not null and (has_table_privilege('anon', v_txt, 'SELECT') or has_table_privilege('authenticated', v_txt, 'SELECT')) then
      perform pg_temp._d(1, 'K. Role', v_txt, 'Klientské role (anon/authenticated) smí číst interní tabulku', null);
    end if;
  end loop;
  exception when others then
    perform pg_temp._d(3, 'Z. Chyba skriptu', 'část K', 'Tuhle část diagnostiky se nepodařilo dokončit (ostatní jsou v pořádku)', sqlerrm);
  end;

  -- =================================================================================================================
  -- L. Triggery na tabulkách aplikace
  -- =================================================================================================================
  begin
  if v_inventory then
    for r in
      select n.nspname, c.relname, t.tgname, pg_get_triggerdef(t.oid) def, p.proname, p.prosecdef
      from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace join pg_proc p on p.oid = t.tgfoid
      where n.nspname = any(v_exposed) and not t.tgisinternal order by 1, 2, 3
    loop
      perform pg_temp._d(5, 'L. Triggery (inventář)', r.nspname || '.' || r.relname, r.tgname, regexp_replace(r.def, '^CREATE (CONSTRAINT )?TRIGGER \S+ ', '') || ' -> ' || r.proname || case when r.prosecdef then ' (SECURITY DEFINER)' else '' end);
    end loop;
  end if;
  for r in select evtname, evtevent, evtenabled from pg_event_trigger loop
    perform pg_temp._d(5, 'L. Triggery', 'event trigger ' || r.evtname, r.evtevent, case r.evtenabled when 'D' then 'vypnutý' else 'zapnutý' end);
  end loop;
  exception when others then
    perform pg_temp._d(3, 'Z. Chyba skriptu', 'část L', 'Tuhle část diagnostiky se nepodařilo dokončit (ostatní jsou v pořádku)', sqlerrm);
  end;

  -- =================================================================================================================
  -- M. Plánovač, vault, tajemství v datech (jen názvy a příznaky, žádné hodnoty)
  -- =================================================================================================================
  begin
  if to_regclass('cron.job') is not null then
    for r in execute 'select jobid, coalesce(jobname, ''(bez názvu)'') jobname, schedule, active, username, left(command, 60) cmd, command ~* ''(bearer|apikey|eyJ[A-Za-z0-9_-]{20,}|service_role|sb_secret)'' leak from cron.job order by jobid' loop
      if r.leak then perform pg_temp._d(1, 'M. Plánovač', 'cron: ' || r.jobname, 'Příkaz plánovače obsahuje zapsaný klíč/token (viditelný každému, kdo smí číst cron.job)', 'začátek příkazu: ' || r.cmd);
      else perform pg_temp._d(5, 'M. Plánovač', 'cron: ' || r.jobname, case when r.active then 'aktivní' else 'vypnutý' end || ', ' || r.schedule, 'uživatel ' || r.username || ' | ' || r.cmd); end if;
    end loop;
    if to_regclass('cron.job_run_details') is not null then
      execute 'select count(*) from cron.job_run_details where status = ''failed'' and start_time > now() - interval ''2 days''' into v_n;
      if v_n > 0 then perform pg_temp._d(4, 'M. Plánovač', 'cron.job_run_details', 'Neúspěšné běhy plánovače za 2 dny', v_n::text); end if;
    end if;
  end if;
  if to_regclass('vault.secrets') is not null then
    execute 'select count(*) from vault.secrets' into v_n;
    perform pg_temp._d(5, 'M. Vault', 'vault.secrets', 'uložených tajemství', v_n::text);
  end if;
  if to_regclass('public.site_settings') is not null and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'site_settings' and column_name = 'value') then
    execute 'select count(*) from public.site_settings where value::text ~* ''(private|secret|service_role|sb_secret|eyJ[A-Za-z0-9_-]{20,})''' into v_n;
    if v_n > 0 then perform pg_temp._d(case when has_table_privilege('anon', 'public.site_settings', 'SELECT') or has_table_privilege('authenticated', 'public.site_settings', 'SELECT') then 1 else 3 end, 'M. Tajemství v datech', 'public.site_settings', 'Hodnoty nastavení vypadají jako tajné klíče', v_n || ' řádků; tabulku čtou klientské role, kontrola politik viz výše');
    end if;
  end if;
  if to_regclass('public.system_logs') is not null and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'system_logs' and column_name = 'message') then
    execute 'select count(*) from public.system_logs where message ~* ''(heslo|password|token|secret)\s*[:=]\s*\S{6,}''' into v_n;
    if v_n > 0 then perform pg_temp._d(2, 'M. Tajemství v datech', 'public.system_logs', 'V systémovém logu jsou zapsaná hesla nebo tokeny', v_n || ' řádků (dočasná hesla správce?)'); end if;
  end if;
  exception when others then
    perform pg_temp._d(3, 'Z. Chyba skriptu', 'část M', 'Tuhle část diagnostiky se nepodařilo dokončit (ostatní jsou v pořádku)', sqlerrm);
  end;

  -- =================================================================================================================
  -- N. ZKOUŠKY: co by útočník skutečně mohl (vše se vrací zpět)
  -- =================================================================================================================
  begin
  v_adminrole := null; v_u := null; v_v := null; v_adm := null;
  if v_has_role then
    execute 'select role from public.profiles where role ~* ''admin|správ'' limit 1' into v_adminrole;
    execute 'select id from public.profiles where role ~* ''admin|správ'' order by id limit 1' into v_adm;
    execute 'select id from public.profiles where coalesce(role, '''') !~* ''admin|správ|nakladatel|publisher'' order by id limit 1' into v_u;
    execute 'select id from public.profiles where coalesce(role, '''') !~* ''admin|správ|nakladatel|publisher'' and id is distinct from $1 order by id limit 1' into v_v using v_u;
  elsif v_has_profiles then
    execute 'select id from public.profiles order by id limit 1' into v_u;
    execute 'select id from public.profiles where id is distinct from $1 order by id limit 1' into v_v using v_u;
  end if;
  if v_u is null then
    perform pg_temp._d(4, 'N. Zkoušky', '(přeskočeno)', 'V tabulce profiles není běžný uživatel, zkoušky pod rolí čtenáře se nespustily', null);
  else
    perform pg_temp._d(5, 'N. Zkoušky', '(průběh)', 'Zkoušky běží pod zkušebním čtenářem a anonymně', 'běžný čtenář nalezen' || case when v_v is null then ' (druhý není, zkoušky vůči cizím řádkům se vynechají)' else ' + druhý čtenář' end || case when v_adminrole is null then ', správce nenalezen' else ', hodnota role správce: ' || v_adminrole end);

    for t in
      select n.nspname, c.relname, c.oid, c.relrowsecurity rls,
             exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'user_id' and a.attnum > 0 and not a.attisdropped) has_user_id,
             exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'id' and a.attnum > 0 and not a.attisdropped) has_id,
             (c.relname = 'profiles') is_profiles
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = any(v_exposed) and c.relkind in ('r', 'p') and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
      order by 1, 2
    loop
      v_tab := t.nspname || '.' || t.relname;
      v_owner := case when t.is_profiles then 'id' when t.has_user_id then 'user_id' else null end;
      v_kind := format('%I.%I', t.nspname, t.relname);

      -- N1. Kolik řádků vidí anon a běžný čtenář
      v_res := null;
      v_txt := pg_temp._probe('anon', null, format('select count(*) from (select 1 from %s limit 100000) s', v_kind), 'n');
      if pg_temp._cnt(v_txt) > 0 then
        execute format('select count(*) from (select 1 from %s limit 100000) s', v_kind) into v_n;
        perform pg_temp._d(case when exists (select 1 from pg_attribute a where a.attrelid = t.oid and a.attname ~* v_sens_read and a.attnum > 0 and not a.attisdropped) or v_owner is not null then 1 else 3 end,
          'N. Zkoušky: čtení', v_tab, 'Bez přihlášení (anon) jde přečíst ' || pg_temp._cnt(v_txt) || ' z ' || v_n || ' řádků', case when v_owner is not null then 'tabulka obsahuje data konkrétních uživatelů' else 'veřejný obsah (katalog?)' end);
      end if;
      if v_owner is not null and v_v is not null then
        v_txt := pg_temp._probe('authenticated', v_u, format('select count(*) from %s where %I <> %L', v_kind, v_owner, v_u), 'n');
        if pg_temp._cnt(v_txt) > 0 then
          perform pg_temp._d(case when t.relname in ('profiles', 'user_books', 'user_daily_activity', 'coin_transactions', 'push_subscriptions') then 2 else 3 end, 'N. Zkoušky: čtení', v_tab,
            'Běžný čtenář vidí ' || pg_temp._cnt(v_txt) || ' řádků jiných uživatelů', 'ověř, zda je to záměr (žebříček), jinak nahradit funkcí, která vrací jen souhrny');
        end if;
      end if;

      -- N2. Zápis do cizích řádků a "kdokoli cokoli" u tabulek bez vlastníka
      if v_owner is not null and v_v is not null then
        v_txt := pg_temp._probe('authenticated', v_u, format('update %s set %I = %I where %I <> %L', v_kind, v_owner, v_owner, v_owner, v_u));
        if pg_temp._hit(v_txt) then perform pg_temp._d(1, 'N. Zkoušky: zápis', v_tab, 'Běžný čtenář může ÚPRAVOU měnit řádky jiných uživatelů', pg_temp._cnt(v_txt) || ' řádků by prošlo'); end if;
        v_txt := pg_temp._probe('authenticated', v_u, format('delete from %s where %I <> %L', v_kind, v_owner, v_u));
        if pg_temp._hit(v_txt) then perform pg_temp._d(1, 'N. Zkoušky: zápis', v_tab, 'Běžný čtenář může MAZAT řádky jiných uživatelů', pg_temp._cnt(v_txt) || ' řádků by prošlo'); end if;
        if not t.is_profiles then
          v_txt := pg_temp._probe('authenticated', v_u, format('insert into %s (%I) values (%L)', v_kind, v_owner, v_v));
          if pg_temp._passed(v_txt) then perform pg_temp._d(2, 'N. Zkoušky: zápis', v_tab, 'Běžný čtenář může VLOŽIT řádek jménem jiného uživatele (RLS WITH CHECK to nehlídá)', left(v_txt, 120)); end if;
        end if;
      end if;
      if v_owner is null then
        select a.attname into v_txt2 from pg_attribute a where a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped and a.attgenerated = '' order by a.attnum limit 1;
        if v_txt2 is not null then
          v_txt := pg_temp._probe('anon', null, format('update %s set %I = %I where ctid in (select ctid from %s limit 1)', v_kind, v_txt2, v_txt2, v_kind));
          if pg_temp._hit(v_txt) then perform pg_temp._d(1, 'N. Zkoušky: zápis', v_tab, 'Bez přihlášení (anon) jde ÚPRAVOU měnit řádky', null); end if;
          v_txt := pg_temp._probe('authenticated', v_u, format('update %s set %I = %I where ctid in (select ctid from %s limit 1)', v_kind, v_txt2, v_txt2, v_kind));
          if pg_temp._hit(v_txt) then perform pg_temp._d(1, 'N. Zkoušky: zápis', v_tab, 'Běžný čtenář může měnit řádky tabulky, která nepatří uživatelům (katalog, nastavení...)', 'sloupec ' || v_txt2); end if;
        end if;
        v_txt := pg_temp._probe('anon', null, format('delete from %s where ctid in (select ctid from %s limit 1)', v_kind, v_kind));
        if pg_temp._hit(v_txt) then perform pg_temp._d(1, 'N. Zkoušky: zápis', v_tab, 'Bez přihlášení (anon) jde MAZAT řádky', null); end if;
        v_txt := pg_temp._probe('authenticated', v_u, format('delete from %s where ctid in (select ctid from %s limit 1)', v_kind, v_kind));
        if pg_temp._hit(v_txt) then perform pg_temp._d(1, 'N. Zkoušky: zápis', v_tab, 'Běžný čtenář může MAZAT řádky tabulky, která nepatří uživatelům', null); end if;
        v_txt := pg_temp._probe('anon', null, format('insert into %s default values', v_kind));
        if pg_temp._passed(v_txt) then perform pg_temp._d(1, 'N. Zkoušky: zápis', v_tab, 'Bez přihlášení (anon) jde VKLÁDAT řádky', left(v_txt, 100)); end if;
        v_txt := pg_temp._probe('authenticated', v_u, format('insert into %s default values', v_kind));
        if pg_temp._passed(v_txt) then perform pg_temp._d(case when t.relname in ('system_logs') then 3 else 1 end, 'N. Zkoušky: zápis', v_tab, 'Běžný čtenář může VLOŽIT řádek do tabulky, která nepatří uživatelům', left(v_txt, 100)); end if;
      end if;

      -- N3. Které sloupce si čtenář může u vlastního řádku změnit přímo (hromadné přiřazení / mass assignment)
      if v_owner is not null then
        v_other := null;
        execute format('select %I from %s where %I in (select id from public.profiles %s) limit 1', v_owner, v_kind, v_owner, case when v_has_role then 'where coalesce(role, '''') !~* ''admin|správ|nakladatel|publisher''' else '' end) into v_other;
        if v_other is not null then
          v_list := ''; v_list2 := '';
          for c in
            select a.attname, format_type(a.atttypid, a.atttypmod) typ
            from pg_attribute a
            where a.attrelid = t.oid and a.attnum > 0 and not a.attisdropped and a.attgenerated = '' and a.attname not in ('id', 'user_id', 'created_at')
              and has_column_privilege('authenticated', t.oid, a.attnum, 'UPDATE')
            order by a.attnum
          loop
            v_expr := case
              when t.is_profiles and c.attname = 'role' and v_adminrole is not null then quote_literal(v_adminrole)
              when c.attname = 'status' and c.typ ~* 'text|char' then '''active'''
              when c.typ ~ '^(integer|bigint|smallint|numeric|real|double precision)' then format('coalesce(%I, 0) + 1', c.attname)
              when c.typ = 'boolean' then format('not coalesce(%I, false)', c.attname)
              when c.typ ~ '^(text|character|citext)' then format('coalesce(%I, '''') || ''x''', c.attname)
              when c.typ ~ '^timestamp' then format('coalesce(%I, now()) + interval ''1 minute''', c.attname)
              when c.typ = 'date' then format('coalesce(%I, current_date) + 1', c.attname)
              when c.typ = 'jsonb' then format('coalesce(%I, ''{}''::jsonb) || ''{"p":1}''::jsonb', c.attname)
              when c.typ = 'text[]' then format('coalesce(%I, ''{}''::text[]) || array[''__p'']', c.attname)
              else null end;
            if v_expr is null then continue; end if;
            v_txt := pg_temp._probe('authenticated', v_other, format('update %s set %I = %s where %I = %L', v_kind, c.attname, v_expr, v_owner, v_other));
            if pg_temp._hit(v_txt) then
              v_list := v_list || case when v_list = '' then '' else ', ' end || c.attname;
              if c.attname ~* v_sens_write and c.attname !~ v_benign_write then v_list2 := v_list2 || case when v_list2 = '' then '' else ', ' end || c.attname; end if;
            end if;
          end loop;
          if v_list2 <> '' then
            perform pg_temp._d(1, 'N. Zkoušky: mass assignment', v_tab, 'Čtenář si může přímo změnit CITLIVÉ sloupce vlastního řádku: ' || v_list2, 'všechny měnitelné sloupce: ' || v_list);
          elsif v_list <> '' then
            perform pg_temp._d(5, 'N. Zkoušky: mass assignment', v_tab, 'Čtenář si může přímo změnit sloupce vlastního řádku', v_list);
          end if;
        end if;
      end if;
    end loop;

    -- N4. Cílené zkoušky obchodní logiky (mince, placené knihy, nastavení, vlastní profil s rolí správce)
    if to_regclass('public.coin_transactions') is not null then
      v_txt := pg_temp._probe('authenticated', v_u, format('insert into public.coin_transactions (user_id, amount, source_type) values (%L, 1000000, ''__probe__'')', v_u));
      if pg_temp._passed(v_txt) then perform pg_temp._d(1, 'N. Zkoušky: logika', 'public.coin_transactions', 'Čtenář si může SÁM PŘIPSAT mince (zápis do deníku mincí)', left(v_txt, 100));
      else perform pg_temp._d(5, 'N. Zkoušky: logika', 'public.coin_transactions', 'V pořádku: čtenář si mince sám připsat nemůže', left(v_txt, 120)); end if;
      v_txt := pg_temp._probe('anon', null, format('insert into public.coin_transactions (user_id, amount, source_type) values (%L, 1000000, ''__probe__'')', v_u));
      if pg_temp._passed(v_txt) then perform pg_temp._d(1, 'N. Zkoušky: logika', 'public.coin_transactions', 'Bez přihlášení jde připsat mince', left(v_txt, 100)); end if;
    end if;
    if to_regclass('public.user_books') is not null and to_regclass('public.books') is not null
       and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'books' and column_name = 'price_coins') then
      v_txt := pg_temp._probe('authenticated', v_u, format('insert into public.user_books (user_id, book_id, status) select %L, b.id, ''active'' from public.books b where coalesce(b.price_coins, 0) > 0 and not exists (select 1 from public.user_books ub where ub.user_id = %L and ub.book_id = b.id) limit 1', v_u, v_u));
      if pg_temp._hit(v_txt) then perform pg_temp._d(1, 'N. Zkoušky: logika', 'public.user_books', 'Čtenář si může SÁM ODEMKNOUT placenou knihu (vložením řádku se stavem active)', null);
      elsif pg_temp._passed(v_txt) then perform pg_temp._d(2, 'N. Zkoušky: logika', 'public.user_books', 'Vložení řádku do user_books prošlo kontrolou RLS (selhalo až na omezení): ověř, zda se tak dá odemknout placená kniha', left(v_txt, 100));
      else perform pg_temp._d(5, 'N. Zkoušky: logika', 'public.user_books', 'V pořádku: placenou knihu si čtenář vložením řádku sám neodemkne', left(v_txt, 120)); end if;
    end if;
    if to_regclass('public.book_contents') is not null and to_regclass('public.user_books') is not null then
      v_txt := pg_temp._probe('authenticated', v_u, format('select count(*) from public.book_contents bc where not exists (select 1 from public.user_books ub where ub.book_id = bc.book_id and ub.user_id = %L)', v_u), 'n');
      if pg_temp._cnt(v_txt) > 0 then perform pg_temp._d(2, 'N. Zkoušky: logika', 'public.book_contents', 'Čtenář vidí text ' || pg_temp._cnt(v_txt) || ' knih, které nemá ve své knihovně (placený obsah?)', 'ověř politiku čtení: licence/koupě/autor'); end if;
      v_txt := pg_temp._probe('anon', null, 'select count(*) from public.book_contents', 'n');
      if pg_temp._cnt(v_txt) > 0 then perform pg_temp._d(1, 'N. Zkoušky: logika', 'public.book_contents', 'Texty knih jsou čitelné bez přihlášení (' || pg_temp._cnt(v_txt) || ' řádků)', null); end if;
    end if;
    if to_regclass('public.site_settings') is not null then
      v_txt := pg_temp._probe('authenticated', v_u, 'insert into public.site_settings (key) values (''__probe__'')');
      if pg_temp._passed(v_txt) then perform pg_temp._d(1, 'N. Zkoušky: logika', 'public.site_settings', 'Čtenář může zapisovat do nastavení appky (VAPID klíč, prohlídka...)', left(v_txt, 100));
      else perform pg_temp._d(5, 'N. Zkoušky: logika', 'public.site_settings', 'V pořádku: čtenář do nastavení appky zapisovat nemůže', left(v_txt, 120)); end if;
    end if;
    if v_has_profiles and v_adminrole is not null then
      v_txt := pg_temp._probe('authenticated', v_u, format('insert into public.profiles (id, role) values (%L, %L)', v_u, v_adminrole));
      if pg_temp._passed(v_txt) then perform pg_temp._d(2, 'N. Zkoušky: logika', 'public.profiles', 'RLS dovoluje vložit vlastní profil s libovolnou rolí (nebezpečné u účtu, který ještě profil nemá)', left(v_txt, 100));
      else perform pg_temp._d(5, 'N. Zkoušky: logika', 'public.profiles', 'V pořádku: čtenář si nemůže vložit vlastní profil s rolí správce', left(v_txt, 120)); end if;
    end if;

    -- N5. Funkce správce a funkce bez parametrů volané bez přihlášení / čtenářem
    for r in
      select n.nspname, p.proname, p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = any(v_exposed) and p.prokind = 'f' and p.provolatile in ('s', 'i') and p.pronargs = 0 and p.prorettype <> 'trigger'::regtype
        and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
    loop
      v_txt := pg_temp._probe('anon', null, format('select %I.%I()', r.nspname, r.proname), 'dml');
      if v_txt like 'ok:%' then perform pg_temp._d(case when r.proname ~ '^admin_' then 1 else 3 end, 'N. Zkoušky: funkce', r.nspname || '.' || r.proname || '()', 'Funkci bez parametrů jde zavolat bez přihlášení a vrátí odpověď', null); end if;
      if r.proname ~ '^admin_' then
        v_txt := pg_temp._probe('authenticated', v_u, format('select %I.%I()', r.nspname, r.proname), 'dml');
        if v_txt like 'ok:%' then
          -- Odpověď sama o úniku nic neříká (funkce může čtenáři vracet 0 nebo prázdno). Rozhodne srovnání: co vrátí čtenáři a co správci.
          v_triv_u := pg_temp._probe('authenticated', v_u, format('select case when %1$I.%2$I() is null or %1$I.%2$I()::text in (''0'', ''f'', ''false'', ''[]'', ''{}'', '''') then 0 else 1 end', r.nspname, r.proname), 'n');
          v_triv_a := case when v_adm is null then null else pg_temp._probe('authenticated', v_adm, format('select case when %1$I.%2$I() is null or %1$I.%2$I()::text in (''0'', ''f'', ''false'', ''[]'', ''{}'', '''') then 0 else 1 end', r.nspname, r.proname), 'n') end;
          if v_triv_u = 'ok:0' and v_triv_a = 'ok:1' then
            perform pg_temp._d(5, 'N. Zkoušky: funkce', r.nspname || '.' || r.proname || '()', 'V pořádku: čtenáři vrátí prázdnou odpověď (0), správci skutečný výsledek', null);
          elsif v_triv_u = 'ok:0' then
            perform pg_temp._d(3, 'N. Zkoušky: funkce', r.nspname || '.' || r.proname || '()', 'Funkce správce vrátí čtenáři prázdnou odpověď, ale nejde to odlišit od odpovědi správce (ten ji má momentálně taky prázdnou)', 'ověř ručně, že čtenář nedostane skutečný výsledek');
          else
            perform pg_temp._d(1, 'N. Zkoušky: funkce', r.nspname || '.' || r.proname || '()', 'Funkce správce vrátí odpověď i běžnému čtenáři', null);
          end if;
        end if;
      end if;
    end loop;
  end if;
  exception when others then
    perform pg_temp._d(3, 'Z. Chyba skriptu', 'část N', 'Tuhle část diagnostiky se nepodařilo dokončit (ostatní jsou v pořádku)', sqlerrm);
  end;

  -- =================================================================================================================
  -- O. Ruční kontrola v dashboardu (SQL tohle nevidí)
  -- =================================================================================================================
  begin
  perform pg_temp._d(4, 'O. Ruční kontrola v dashboardu', 'Authentication -> Providers -> Email', 'Potvrzení e-mailu povinné (Confirm email)', 'jinak se dá registrovat cizí e-mail');
  perform pg_temp._d(4, 'O. Ruční kontrola v dashboardu', 'Authentication -> Sign In / Providers', 'Minimální délka hesla aspoň 10 a zapnutá ochrana proti uniklým heslům (Leaked password protection)', 'nastavení hesel');
  perform pg_temp._d(4, 'O. Ruční kontrola v dashboardu', 'Authentication -> Sign In / Providers', 'Anonymní přihlášení vypnuté, nepoužívané poskytovatele vypnout, registrace povolené jen když je chceš', null);
  perform pg_temp._d(4, 'O. Ruční kontrola v dashboardu', 'Authentication -> URL Configuration', 'Site URL a Redirect URLs bez zástupných znaků (*) a bez cizích domén', 'jinak lze krást přihlášení přesměrováním');
  perform pg_temp._d(4, 'O. Ruční kontrola v dashboardu', 'Authentication -> Rate Limits / Attack Protection', 'Zapnout CAPTCHA (Turnstile/hCaptcha) a nechat omezení počtu e-mailů a přihlášení', null);
  perform pg_temp._d(4, 'O. Ruční kontrola v dashboardu', 'Authentication -> Sessions / JWT', 'Platnost přístupového tokenu (JWT expiry) do hodiny, platnost OTP do hodiny', null);
  perform pg_temp._d(4, 'O. Ruční kontrola v dashboardu', 'Project Settings -> API', 'Exposed schemas jen public; Max rows nastavené; staré service_role a anon klíče neuniklé (jinak je otočit)', 'service_role klíč nesmí být nikde v kódu appky');
  perform pg_temp._d(4, 'O. Ruční kontrola v dashboardu', 'Edge Functions', 'U každé funkce zapnuté Verify JWT, kromě code-login (tam kontrola zevnitř); tajemství jen v Secrets', 'viz db/ai, db/auth, db/push');
  perform pg_temp._d(4, 'O. Ruční kontrola v dashboardu', 'Database -> Settings', 'Zapnutý SSL enforcement, omezení IP adres (Network Restrictions), zálohy/PITR, žádné veřejné heslo databáze v kódu', null);
  perform pg_temp._d(4, 'O. Ruční kontrola v dashboardu', 'Realtime -> Settings', 'Zapnout autorizaci realtime kanálů (nepovolovat veřejný přístup, pokud ho appka nepotřebuje)', null);
  perform pg_temp._d(4, 'O. Ruční kontrola v dashboardu', 'Účet a tým', 'Dvoufázové ověření u všech, kdo mají přístup do Supabase, GitHubu a Vercelu', null);
  exception when others then
    perform pg_temp._d(3, 'Z. Chyba skriptu', 'část O', 'Tuhle část diagnostiky se nepodařilo dokončit (ostatní jsou v pořádku)', sqlerrm);
  end;

end
$diag$;

-- Výsledek: nejzávažnější nahoře. Nejdřív souhrn, pak nálezy, na konci inventář (pokud je zapnutý).
select zavaznost, sekce, objekt, nalez, detail
from (
  select 0 as o, 'SOUHRN' as zavaznost, 'SOUHRN' as sekce, 'počet nálezů' as objekt,
         string_agg(case sev when 1 then 'KRITICKÉ: ' when 2 then 'VYSOKÉ: ' when 3 then 'STŘEDNÍ: ' when 4 then 'NÍZKÉ: ' else 'INFO: ' end || n::text, '   |   ' order by sev) as nalez, null::text as detail
  from (select sev, count(*) n from pg_temp._diag group by sev) s
  union all
  select sev, case sev when 1 then '1 KRITICKÉ' when 2 then '2 VYSOKÉ' when 3 then '3 STŘEDNÍ' when 4 then '4 nízké' else '5 info' end, sekce, objekt, nalez, detail from pg_temp._diag
) q
order by o, sekce, objekt, nalez;
