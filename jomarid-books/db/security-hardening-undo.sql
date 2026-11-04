-- ============================================================================
-- Jomarid Books: návrat zpět po db/security-hardening.sql
-- ============================================================================
-- Spouštěj JEN když se po zpevnění něco v appce rozbilo a nejde to opravit jinak. Vrátí přesně to, co zpevnění změnilo, podle zálohy, kterou si
-- zpevnění při prvním spuštění uložilo (tabulka security_hardening_backup): práva k tabulkám, sekvencím a funkcím, výchozí práva, tři zúžené politiky
-- (user_books_select, user_daily_activity_select, book_ratings_select) a nastavení bucketů. Odstraní ochranné spouště a jejich funkce. Žádná data
-- uživatelů se nemění. Funkce leaderboard_reads a leaderboard_activity zůstávají (nevadí, appka je používá a po návratu politik fungují dál).
-- Supabase při spuštění ukáže varování před destruktivním příkazem (kvůli odstranění spouští): potvrď ho.
--
-- Po návratu je databáze zase tak děravá, jak ji ukázala diagnostika. Napiš mi, co se rozbilo, a opravím jen to, co je třeba, místo celého návratu.
-- Po úspěšném návratu se záloha smaže: příští spuštění zpevnění si uloží novou.
-- ============================================================================

create temp table if not exists _undo_log (n serial, sekce text, stav text, detail text);
delete from _undo_log where true;

do $$
declare
  d jsonb; r jsonb; a jsonb; b jsonb;
  v_kind text; v_to text; v_o text; v_sql text; v_t text;
  n_rel int := 0; n_fn int := 0; n_err int := 0;
begin
  select data into d from public.security_hardening_backup where id = 1;
  if d is null then
    raise exception 'Záloha původního nastavení neexistuje: zpevnění se ještě nespustilo, nebo už se vracelo. Není co vracet.';
  end if;

  -- 1. tabulky, pohledy a sekvence: práva pro anon, authenticated a PUBLIC přesně jako dřív
  for r in select * from jsonb_array_elements(d -> 'relations') loop
    begin
      v_kind := r ->> 'kind';
      execute format('revoke all on %s %s from public, anon, authenticated', v_kind, r ->> 'name');
      for a in select * from jsonb_array_elements(r -> 'acl') loop
        v_to := case when a ->> 'grantee' = 'public' then 'public' else quote_ident(a ->> 'grantee') end;
        execute format('grant %s on %s %s to %s', a ->> 'priv', v_kind, r ->> 'name', v_to);
      end loop;
      n_rel := n_rel + 1;
    exception when others then
      n_err := n_err + 1;
      insert into _undo_log (sekce, stav, detail) values ('Tabulky', 'UPOZORNĚNÍ', (r ->> 'name') || ': ' || sqlerrm);
    end;
  end loop;

  -- 2. funkce
  for r in select * from jsonb_array_elements(d -> 'functions') loop
    begin
      execute format('revoke all on routine %s from public, anon, authenticated', r ->> 'sig');
      for a in select * from jsonb_array_elements(r -> 'acl') loop
        v_to := case when a ->> 'grantee' = 'public' then 'public' else quote_ident(a ->> 'grantee') end;
        execute format('grant %s on routine %s to %s', a ->> 'priv', r ->> 'sig', v_to);
      end loop;
      n_fn := n_fn + 1;
    exception when others then
      n_err := n_err + 1;
      insert into _undo_log (sekce, stav, detail) values ('Funkce', 'UPOZORNĚNÍ', (r ->> 'sig') || ': ' || sqlerrm);
    end;
  end loop;

  -- 3. schémata (zakládání objektů v public, přístup k net a cron)
  for r in select * from jsonb_array_elements(d -> 'schemas') loop
    begin
      execute format('revoke all on schema %I from public, anon, authenticated', r ->> 'name');
      for a in select * from jsonb_array_elements(r -> 'acl') loop
        v_to := case when a ->> 'grantee' = 'public' then 'public' else quote_ident(a ->> 'grantee') end;
        execute format('grant %s on schema %I to %s', a ->> 'priv', r ->> 'name', v_to);
      end loop;
    exception when others then
      n_err := n_err + 1;
      insert into _undo_log (sekce, stav, detail) values ('Schémata', 'UPOZORNĚNÍ', (r ->> 'name') || ': ' || sqlerrm);
    end;
  end loop;

  -- 4. výchozí práva nových objektů
  for r in select * from jsonb_array_elements(d -> 'defaults') loop
    begin
      v_t := case r ->> 'type' when 'r' then 'tables' when 'S' then 'sequences' when 'f' then 'functions' else null end;
      continue when v_t is null;
      v_o := format('alter default privileges for role %I %s', r ->> 'role', case when r ->> 'schema' is null then '' else format('in schema %I', r ->> 'schema') end);
      execute v_o || format(' revoke all on %s from public, anon, authenticated', v_t);
      for a in select * from jsonb_array_elements(r -> 'acl') loop
        v_to := case when a ->> 'grantee' = 'public' then 'public' else quote_ident(a ->> 'grantee') end;
        execute v_o || format(' grant %s on %s to %s', a ->> 'priv', v_t, v_to);
      end loop;
    exception when others then
      insert into _undo_log (sekce, stav, detail) values ('Výchozí práva', 'UPOZORNĚNÍ', (r ->> 'role') || ': ' || sqlerrm);
    end;
  end loop;
  -- zpevnění vzalo pro nové funkce právo PUBLIC (globálně pro vlastníka); původně ho měly
  for v_o in select unnest(array['postgres', 'supabase_admin']) loop
    begin
      if exists (select 1 from pg_roles where rolname = v_o) and pg_has_role(current_user, v_o, 'member') then
        execute format('alter default privileges for role %I grant execute on functions to public', v_o);
      end if;
    exception when others then
      insert into _undo_log (sekce, stav, detail) values ('Výchozí práva', 'UPOZORNĚNÍ', v_o || ': ' || sqlerrm);
    end;
  end loop;

  -- 5. politiky zúžené na vlastní řádky
  for r in select * from jsonb_array_elements(d -> 'policies') loop
    begin
      execute format('alter policy %I on public.%I using (%s)', r ->> 'policy', r ->> 'table', r ->> 'qual');
    exception when others then
      insert into _undo_log (sekce, stav, detail) values ('Politiky', 'UPOZORNĚNÍ', (r ->> 'policy') || ': ' || sqlerrm);
    end;
  end loop;

  -- 6. úložiště
  if d ? 'buckets' and to_regclass('storage.buckets') is not null then
    for b in select * from jsonb_array_elements(d -> 'buckets') loop
      begin
        execute 'update storage.buckets set public = $2, file_size_limit = $3, allowed_mime_types = $4 where id = $1'
          using b ->> 'id', (b ->> 'public')::boolean, nullif(b ->> 'file_size_limit', '')::bigint,
                case when jsonb_typeof(b -> 'allowed_mime_types') = 'array' then array(select jsonb_array_elements_text(b -> 'allowed_mime_types')) else null end;
      exception when others then
        insert into _undo_log (sekce, stav, detail) values ('Úložiště', 'UPOZORNĚNÍ', (b ->> 'id') || ': ' || sqlerrm);
      end;
    end loop;
  end if;

  -- 7. ochranné spouště a jejich funkce
  if to_regclass('public.profiles') is not null then execute 'drop trigger if exists trg_00_guard_profiles_client on public.profiles'; end if;
  if to_regclass('public.user_books') is not null then execute 'drop trigger if exists trg_00_guard_user_books_client on public.user_books'; end if;
  if to_regclass('public.admin_notifications') is not null then execute 'drop trigger if exists trg_00_guard_admin_notifications_flood on public.admin_notifications'; end if;
  drop function if exists public.guard_profiles_client_write();
  drop function if exists public.guard_user_books_client_write();
  drop function if exists public.guard_admin_notifications_flood();

  insert into _undo_log (sekce, stav, detail) values ('Návrat', case when n_err = 0 then 'OK' else 'UPOZORNĚNÍ' end,
    format('Vráceno původní nastavení: %s tabulek a sekvencí, %s funkcí, schémata, výchozí práva, politiky, buckety; ochranné spouště odstraněny%s', n_rel, n_fn,
           case when n_err > 0 then format('. %s věcí se vrátit nepodařilo (viz výše)', n_err) else '' end));
  if n_err = 0 then delete from public.security_hardening_backup where true; end if;
end $$;

select sekce, stav, detail from _undo_log order by case stav when 'UPOZORNĚNÍ' then 0 else 1 end, n;
