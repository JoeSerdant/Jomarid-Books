-- Texty knih ve Storage (soukromý bucket "book-texts", soubor <id knihy>.txt).
-- Spouští se ručně v Supabase -> SQL Editor. Je idempotentní (jde pustit víckrát).
-- Pozor: složka se záměrně nejmenuje "supabase/", ať ji integrace s GitHubem sama nespouští na produkci.

-- 0) Staré otevřené pravidlo Storage: kdokoli s veřejným klíčem mohl nahrávat, přepisovat a mazat soubory.
--    Appka Storage dřív nepoužívala, takže se smazání ničeho nedotkne.
drop policy if exists "povolit vse 1jx2ne_0" on storage.objects;
drop policy if exists "povolit vse 1jx2ne_2" on storage.objects;
drop policy if exists "povolit vse 1jx2ne_3" on storage.objects;
drop policy if exists "Admini mohou vše, ostatní nic 1jx2ne_0" on storage.objects;
drop policy if exists "Admini mohou vše, ostatní nic 1jx2ne_1" on storage.objects;
drop policy if exists "Admini mohou vše, ostatní nic 1jx2ne_2" on storage.objects;
drop policy if exists "Admini mohou vše, ostatní nic 1jx2ne_3" on storage.objects;

-- 1) Soukromý bucket (limit jednoho souboru 20 MB)
insert into storage.buckets (id, name, public, file_size_limit)
values ('book-texts', 'book-texts', false, 20971520)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- 2) Pomocné funkce. Pravidla přesně opakují dosavadní RLS tabulky book_contents.
create or replace function public.app_book_text_id(p_name text)
returns uuid language sql immutable as $$
  select case when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.txt$'
              then substr(p_name, 1, 36)::uuid end
$$;

-- čtení: správce, autor-nakladatel, automaticky přidělené knihy, držitel aktivní licence
create or replace function public.app_can_read_book_text(p_book uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select p_book is not null and (
    coalesce(public.app_current_role(), '') = 'správce'
    or exists (select 1 from public.books b where b.id = p_book
               and (b.is_auto_assigned = true
                    or (coalesce(public.app_current_role(), '') = 'nakladatel' and b.author_id = auth.uid())))
    or exists (select 1 from public.user_books ub where ub.book_id = p_book and ub.user_id = auth.uid() and ub.status = 'active')
  );
$$;

-- zápis: správce, nebo nakladatel u vlastní knihy
create or replace function public.app_can_write_book_text(p_book uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select p_book is not null and (
    coalesce(public.app_current_role(), '') = 'správce'
    or exists (select 1 from public.books b where b.id = p_book
               and coalesce(public.app_current_role(), '') = 'nakladatel' and b.author_id = auth.uid())
  );
$$;

revoke execute on function public.app_can_read_book_text(uuid), public.app_can_write_book_text(uuid) from public, anon;
grant execute on function public.app_can_read_book_text(uuid), public.app_can_write_book_text(uuid) to authenticated;

-- 3) Pravidla pro bucket
drop policy if exists book_texts_select on storage.objects;
create policy book_texts_select on storage.objects for select to authenticated
  using (bucket_id = 'book-texts' and public.app_can_read_book_text(public.app_book_text_id(name)));

drop policy if exists book_texts_insert on storage.objects;
create policy book_texts_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'book-texts' and public.app_can_write_book_text(public.app_book_text_id(name)));

drop policy if exists book_texts_update on storage.objects;
create policy book_texts_update on storage.objects for update to authenticated
  using (bucket_id = 'book-texts' and public.app_can_write_book_text(public.app_book_text_id(name)))
  with check (bucket_id = 'book-texts' and public.app_can_write_book_text(public.app_book_text_id(name)));

drop policy if exists book_texts_delete on storage.objects;
create policy book_texts_delete on storage.objects for delete to authenticated
  using (bucket_id = 'book-texts' and public.app_can_write_book_text(public.app_book_text_id(name)));
