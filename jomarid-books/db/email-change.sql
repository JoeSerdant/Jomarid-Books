-- Změna e-mailu přes správce (stejně jako dočasné heslo): čtenář pošle žádost, správce ji v Admin → Upozornění buď provede, nebo zamítne.
-- Spusť celý soubor v Supabase SQL Editoru. Jde spustit víckrát (nic se nepřepisuje, jen se funkce nahrazují).
-- Předpoklady, které v databázi už jsou: tabulky profiles, admin_notifications, user_notifications, system_logs, funkce notif_require_admin()
-- a trigger trg_sync_profile_email na auth.users (kopíruje změněný e-mail do profiles.email).
--
-- Uživatel zůstane po změně přihlášený, heslo se nemění. Appka e-mail neumí změnit sama, jen přes žádost správci.
-- Supabase Auth ale e-mail přes API (updateUser) změnit umí; jestli to chce potvrzení odkazem z nové schránky, záleží na nastavení
-- projektu (Authentication → Providers → Email: Confirm email, Secure email change). Tenhle soubor tu cestu neblokuje (to by chtělo spouštěč na auth.users).

-- Nejvýš jedna otevřená žádost na uživatele (chrání i před dvěma souběžnými žádostmi).
create unique index if not exists admin_notifications_one_open_email_request
  on public.admin_notifications (user_id) where kind = 'email_change_request' and status = 'open';

-- ---------- Čtenář ----------
-- Žádost o změnu e-mailu: uloží se jako upozornění správci (to rozsvítí i oznámení do zařízení správců).
-- Nový e-mail je jen v datech žádosti, ne v titulku ani textu (ty se posílají na zamčenou obrazovku správců).
create or replace function public.request_email_change(p_new_email text, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  v_new text := lower(btrim(coalesce(p_new_email, '')));
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 500), '');
  v_old text;
  v_conflict boolean;
  v_id uuid;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if char_length(v_new) > 254 or v_new !~ '^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$' then raise exception 'invalid_email'; end if;
  select email into v_old from auth.users where id = v_uid;
  if not found then raise exception 'not_authenticated'; end if;
  if lower(coalesce(v_old, '')) = v_new then raise exception 'same_email'; end if;
  if exists (select 1 from public.admin_notifications where user_id = v_uid and kind = 'email_change_request' and status = 'open') then
    raise exception 'request_already_open';
  end if;
  if (select count(*) from public.admin_notifications
       where user_id = v_uid and kind = 'email_change_request' and created_at > now() - interval '24 hours') >= 3 then
    raise exception 'too_many_requests';
  end if;
  -- Strop otevřených žádostí všech uživatelů dohromady (aby spousta účtů nezahltila správce upozorněními). Zámek drží do konce
  -- transakce, takže dvě souběžné žádosti strop nepřekročí; žádost trvá zlomek vteřiny, takže se nic nezdržuje.
  perform pg_advisory_xact_lock(hashtext('email_change_request_cap'));
  if (select count(*) from public.admin_notifications where kind = 'email_change_request' and status = 'open') >= 200 then
    raise exception 'too_many_requests';
  end if;
  -- Obsazený e-mail se čtenáři neprozradí (jinak by šlo zjišťovat, kdo je zaregistrovaný); upozornění to dostane jen správce.
  v_conflict := exists (select 1 from auth.users where lower(email) = v_new and id <> v_uid);
  begin
    insert into public.admin_notifications (kind, user_id, title, body, payload)
    values ('email_change_request', v_uid, 'Žádost o změnu e-mailu', v_note,
            jsonb_build_object('new_email', v_new, 'old_email', lower(coalesce(v_old, '')), 'logged_in', true, 'conflict', v_conflict))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'request_already_open';
  end;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- Poslední žádost přihlášeného čtenáře (nebo null), ať Nastavení ukáže „čeká na správce“.
create or replace function public.my_email_change_request()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  return (select jsonb_build_object('id', n.id, 'status', n.status, 'new_email', n.payload ->> 'new_email',
                                    'created_at', n.created_at, 'handled_at', n.handled_at, 'cancelled', coalesce((n.payload ->> 'cancelled')::boolean, false))
            from public.admin_notifications n
           where n.user_id = v_uid and n.kind = 'email_change_request'
           order by n.created_at desc limit 1);
end $$;

-- Čtenář svou otevřenou žádost zruší (např. překlep). Do denního limitu se počítá dál.
create or replace function public.cancel_my_email_change_request()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_n integer;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  update public.admin_notifications
     set status = 'dismissed', handled_at = now(), payload = payload || jsonb_build_object('cancelled', true)
   where user_id = v_uid and kind = 'email_change_request' and status = 'open';
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'cancelled', v_n > 0);
end $$;

-- ---------- Správce ----------
-- Provede změnu e-mailu účtu (z žádosti, nebo přímo z detailu účtu). Mění auth.users, auth.identities a (přes trigger) profiles.email
-- v jedné transakci. Nový e-mail se bere rovnou jako potvrzený, potvrzovací e-mail se neposílá.
create or replace function public.admin_change_email(p_user uuid, p_new_email text, p_notification uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_admin uuid := public.notif_require_admin();
  v_new text := lower(btrim(coalesce(p_new_email, '')));
  v_old text;
  v_username text;
  v_req public.admin_notifications%rowtype;
begin
  if p_user = v_admin then raise exception 'cannot_change_own_email'; end if;
  if char_length(v_new) > 254 or v_new !~ '^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$' then raise exception 'invalid_email'; end if;
  select email into v_old from auth.users where id = p_user for update;
  if not found then raise exception 'user_not_found'; end if;
  if lower(coalesce(v_old, '')) = v_new then raise exception 'same_email'; end if;

  perform pg_advisory_xact_lock(hashtext('email_change:' || v_new));
  if exists (select 1 from auth.users where lower(email) = v_new and id <> p_user)
     or exists (select 1 from auth.identities where lower(identity_data ->> 'email') = v_new and user_id <> p_user)
     or exists (select 1 from public.profiles where lower(email) = v_new and id <> p_user) then
    raise exception 'email_taken';
  end if;

  if p_notification is not null then
    select * into v_req from public.admin_notifications where id = p_notification for update;
    if not found or v_req.kind <> 'email_change_request' or v_req.user_id is distinct from p_user then raise exception 'notification_not_found'; end if;
    if v_req.status <> 'open' then raise exception 'already_handled'; end if;
    -- správce zadal jiný e-mail, než o jaký čtenář v téhle žádosti požádal
    if lower(coalesce(v_req.payload ->> 'new_email', '')) <> v_new then raise exception 'email_mismatch'; end if;
  end if;

  update auth.users
     set email = v_new,
         email_confirmed_at = coalesce(email_confirmed_at, now()),
         email_change = '', email_change_token_new = '', email_change_token_current = '', email_change_sent_at = null,
         email_change_confirm_status = 0,
         raw_user_meta_data = case when raw_user_meta_data ? 'email' then raw_user_meta_data || jsonb_build_object('email', v_new) else raw_user_meta_data end,
         updated_at = now()
   where id = p_user;
  update auth.identities
     set identity_data = identity_data || jsonb_build_object('email', v_new),
         provider_id = case when lower(provider_id) = lower(coalesce(v_old, '')) then v_new else provider_id end,
         updated_at = now()
   where user_id = p_user and provider = 'email';

  -- profiles.email kopíruje trigger trg_sync_profile_email; kdyby ne, dorovná se tady a nesedí-li to ani potom, celá změna se vrátí
  if exists (select 1 from public.profiles where id = p_user) and (select email from public.profiles where id = p_user) is distinct from v_new then
    perform set_config('app.bypass_username_guard', 'true', true);
    update public.profiles set email = v_new where id = p_user;
    perform set_config('app.bypass_username_guard', 'false', true);
    if (select email from public.profiles where id = p_user) is distinct from v_new then raise exception 'profile_email_not_synced'; end if;
  end if;
  select username into v_username from public.profiles where id = p_user;

  update public.admin_notifications
     set status = 'done', handled_at = now(), handled_by = v_admin
   where kind = 'email_change_request' and status = 'open' and (user_id = p_user or id = p_notification);
  insert into public.user_notifications (user_id, kind, title, body)
  values (p_user, 'email_changed', 'E-mail je změněný', 'Správce ti změnil přihlašovací e-mail. Přihlašuj se od teď novým.');
  insert into public.system_logs (log_type, message)
  values ('WARN', 'Správce změnil e-mail účtu „' || coalesce(v_username, left(p_user::text, 8)) || '“.');
  return jsonb_build_object('old_email', v_old, 'new_email', v_new, 'username', v_username);
end $$;

-- Zamítne žádost o změnu e-mailu a dá to čtenáři vědět (obecné „Vyřízeno/Zamítnout“ by čtenáři nic neřeklo).
create or replace function public.admin_reject_email_change(p_notification uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_admin uuid := public.notif_require_admin();
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 300), '');
  v_req public.admin_notifications%rowtype;
begin
  select * into v_req from public.admin_notifications where id = p_notification and kind = 'email_change_request' for update;
  if not found then raise exception 'notification_not_found'; end if;
  if v_req.status <> 'open' then raise exception 'already_handled'; end if;
  update public.admin_notifications set status = 'dismissed', handled_at = now(), handled_by = v_admin where id = p_notification;
  insert into public.user_notifications (user_id, kind, title, body)
  values (v_req.user_id, 'email_change_rejected', 'Žádost o změnu e-mailu zamítnuta',
          coalesce(v_reason, 'Kdyby to byl omyl, pošli žádost znovu a připiš vzkaz.'));
  return jsonb_build_object('success', true);
end $$;

-- ---------- Oprávnění ----------
revoke all on function public.request_email_change(text, text) from public, anon;
revoke all on function public.my_email_change_request() from public, anon;
revoke all on function public.cancel_my_email_change_request() from public, anon;
revoke all on function public.admin_change_email(uuid, text, uuid) from public, anon;
revoke all on function public.admin_reject_email_change(uuid, text) from public, anon;
grant execute on function public.request_email_change(text, text) to authenticated;
grant execute on function public.my_email_change_request() to authenticated;
grant execute on function public.cancel_my_email_change_request() to authenticated;
grant execute on function public.admin_change_email(uuid, text, uuid) to authenticated;
grant execute on function public.admin_reject_email_change(uuid, text) to authenticated;
