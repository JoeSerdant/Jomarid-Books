-- Oprava online Kouloví Kámošů (jen dvě funkce, malý soubor): server bere koule s 18 i 54 čísly (26 bodů obalu) a limit tahu je 60 000 znaků.
-- Stejná změna je v db/multiplayer.sql; tenhle soubor stačí, když se celé multiplayer.sql do SQL Editoru nevejde. Jde spustit víckrát.

create or replace function public.mp_cfg(p_game text, p_mode text)
returns jsonb language sql immutable set search_path to 'public' as $$
  select case p_game || '/' || p_mode
    when 'chess/duel'         then jsonb_build_object('kind', 'turn',     'turn_seconds', 0,   'bank', 300, 'inc', 3, 'first_move', 60, 'reward', 30, 'min_moves', 10, 'min_seconds', 45,  'max_payload', 400,   'max_moves', 700,  'team', false)
    when 'koulovikamosi/duel' then jsonb_build_object('kind', 'turn',     'turn_seconds', 60,  'bank', 0,   'inc', 0, 'first_move', 60, 'reward', 20, 'min_moves', 6,  'min_seconds', 30,  'max_payload', 60000, 'max_moves', 400,  'team', false)
    when 'warroom/duel'       then jsonb_build_object('kind', 'turn',     'turn_seconds', 120, 'bank', 0,   'inc', 0, 'first_move', 90, 'reward', 35, 'min_moves', 4,  'min_seconds', 40,  'max_payload', 16000, 'max_moves', 900,  'team', false)
    when 'hannibal/duel'      then jsonb_build_object('kind', 'turn',     'turn_seconds', 180, 'bank', 0,   'inc', 0, 'first_move', 90, 'reward', 40, 'min_moves', 4,  'min_seconds', 30,  'max_payload', 16000, 'max_moves', 1500, 'team', false)
    when 'cityclicker/race'   then jsonb_build_object('kind', 'race',     'turn_seconds', 0,   'bank', 0,   'inc', 0, 'first_move', 0,  'reward', 40, 'min_moves', 0,  'min_seconds', 38,  'max_payload', 600,   'max_moves', 0,    'team', false, 'target', 10000000000)
    when 'onlinegames/katakomby' then jsonb_build_object('kind', 'turn',  'turn_seconds', 120, 'bank', 0,   'inc', 0, 'first_move', 120, 'reward', 40, 'min_moves', 40, 'min_seconds', 240, 'max_payload', 400,  'max_moves', 4000, 'team', true)
    when 'onlinegames/katakombypvp' then jsonb_build_object('kind', 'turn', 'turn_seconds', 90, 'bank', 0, 'inc', 0, 'first_move', 120, 'reward', 35, 'min_moves', 14, 'min_seconds', 60, 'max_payload', 400, 'max_moves', 1500, 'team', false)
    when 'onlinegames/chaos'  then jsonb_build_object('kind', 'realtime', 'turn_seconds', 0,   'bank', 0,   'inc', 0, 'first_move', 0,  'reward', 35, 'min_moves', 0,  'min_seconds', 150, 'max_payload', 600,   'max_moves', 0,    'team', true)
    when 'rocket/coop'        then jsonb_build_object('kind', 'realtime', 'turn_seconds', 0,   'bank', 0,   'inc', 0, 'first_move', 0,  'reward', 25, 'min_moves', 0,  'min_seconds', 60,  'max_payload', 600,   'max_moves', 0,    'team', true)
    when 'rocket/pvp'         then jsonb_build_object('kind', 'realtime', 'turn_seconds', 0,   'bank', 0,   'inc', 0, 'first_move', 0,  'reward', 35, 'min_moves', 0,  'min_seconds', 30,  'max_payload', 600,   'max_moves', 0,    'team', false)
    else null
  end
$$;

create or replace function public.mp_check_payload(p_match public.mp_matches, p_slot smallint, p_payload jsonb)
returns void language plpgsql stable set search_path to 'public' as $$
declare
  v_game text := p_match.game_id;
  v_keys text[];
  v_k int;
  v_prev_len int;
  v_len int;
  v_ball jsonb;
  v_i int;
  v_a jsonb;
  v_n int;
  v_sum numeric;
begin
  if jsonb_typeof(p_payload) <> 'object' then raise exception 'illegal_move'; end if;
  select array_agg(k) into v_keys from jsonb_object_keys(p_payload) k;

  if v_game = 'koulovikamosi' then
    -- hod {d:1, k, x, t}: typ koule je dán pořadím ze semínka (nejde si vybrat); stav misky {r:1, k, b:[koule]} nebo {r:1, k, out:1} (koule vypadla)
    v_k := (select count(*) from public.mp_moves where match_id = p_match.id and payload ? 'r');
    if not public.mp_int_in(p_payload -> 'k', 0, 100000) or (p_payload ->> 'k')::int <> v_k then raise exception 'illegal_move'; end if;
    if p_payload ? 'd' then
      if not (v_keys <@ array['d', 'k', 'x', 't']) or p_payload -> 'd' <> '1'::jsonb or not public.mp_num_in(p_payload -> 'x', 0, 540)
         or not public.mp_int_in(p_payload -> 't', 0, 11) or (p_payload ->> 't')::int <> public.mp_koulovi_type(p_match.seed, v_k) then raise exception 'illegal_move'; end if;
    elsif p_payload ? 'r' then
      if p_payload -> 'r' <> '1'::jsonb then raise exception 'illegal_move'; end if;
      if p_payload ? 'out' then
        if not (v_keys <@ array['r', 'k', 'out']) or p_payload -> 'out' <> '1'::jsonb then raise exception 'illegal_move'; end if;
      else
        if not (v_keys <@ array['r', 'k', 'b']) or jsonb_typeof(p_payload -> 'b') <> 'array' then raise exception 'illegal_move'; end if;
        v_len := jsonb_array_length(p_payload -> 'b');
        select coalesce(jsonb_array_length(payload -> 'b'), 0) into v_prev_len from public.mp_moves
          where match_id = p_match.id and payload ? 'r' and payload ? 'b' order by seq desc limit 1;
        v_prev_len := coalesce(v_prev_len, 0);
        -- po hodu přibude nejvýš jedna koule (spojováním jich ubývá); víc než 160 se do misky nevejde
        if v_len < 1 or v_len > 160 or v_len > v_prev_len + 1 then raise exception 'illegal_move'; end if;
        -- každá koule: [typ, fáze, body obalu x, y]: 8 bodů (stará hra, 18 čísel) nebo 26 bodů (současná hra, 54 čísel)
        for v_i in 0..(v_len - 1) loop
          v_ball := (p_payload -> 'b') -> v_i;
          if jsonb_typeof(v_ball) <> 'array' or jsonb_array_length(v_ball) not in (18, 54) or not public.mp_int_in(v_ball -> 0, 0, 11) or not public.mp_num_in(v_ball -> 1, -1000, 1000) then raise exception 'illegal_move'; end if;
          for v_n in 2..(jsonb_array_length(v_ball) - 1) loop
            if not public.mp_num_in(v_ball -> v_n, -100, case when v_n % 2 = 0 then 640 else 1060 end) then raise exception 'illegal_move'; end if;   -- x je na sudých místech, y na lichých
          end loop;
        end loop;
      end if;
    else
      raise exception 'illegal_move';
    end if;

  elsif v_game = 'warroom' then
    -- den {t:'a', k, adv, m, d, w, l}: k je pořadí dne hráče, adv posun fronty, d doktrína (jen první den), w vyhrál jsem, l prohrál jsem
    if not (v_keys <@ array['t', 'k', 'adv', 'm', 'd', 'w', 'l']) or p_payload -> 't' <> '"a"'::jsonb then raise exception 'illegal_move'; end if;
    v_k := (select count(*) from public.mp_moves where match_id = p_match.id and player = p_slot) + 1;
    if not public.mp_int_in(p_payload -> 'k', 1, 100000) or (p_payload ->> 'k')::int <> v_k then raise exception 'illegal_move'; end if;
    if not public.mp_num_in(p_payload -> 'adv', 0, 3000) then raise exception 'illegal_move'; end if;   -- soupeřova hra bere nejvýš 1000 za den
    if p_payload ? 'm' and (jsonb_typeof(p_payload -> 'm') <> 'string' or length(p_payload ->> 'm') > 300) then raise exception 'illegal_move'; end if;
    if p_payload ? 'd' and (v_k <> 1 or jsonb_typeof(p_payload -> 'd') <> 'string'
       or (p_payload ->> 'd') not in ('fortress', 'blitz', 'intel', 'quartermaster', 'tech', 'artillery', 'partisan', 'propaganda', 'fanatic', 'fleet', 'mercenary', 'chemical')) then raise exception 'illegal_move'; end if;
    if p_payload ? 'w' and p_payload -> 'w' <> '1'::jsonb then raise exception 'illegal_move'; end if;
    if p_payload ? 'l' and p_payload -> 'l' <> '1'::jsonb then raise exception 'illegal_move'; end if;
    if p_payload ? 'w' and p_payload ? 'l' then raise exception 'illegal_move'; end if;
    -- vítězství znamená dotlačit frontu z poloviny na maximum (aspoň ~90 bodů i v nejmenším scénáři): bez dostatečného postupu se tvrzení nepřijme
    if p_payload ? 'w' then
      select coalesce(sum((payload ->> 'adv')::numeric), 0) into v_sum from public.mp_moves where match_id = p_match.id and player = p_slot;
      if v_sum + (p_payload ->> 'adv')::numeric < 90 then raise exception 'illegal_move'; end if;
    end if;

  elsif v_game = 'onlinegames' then
    -- Katakomby (tahové režimy Jomarid Online Games: výprava ve dvou a souboj hrdinů): hrdina {t:'hero', h: 0-4} (první dva tahy zápasu, po jednom od každého),
    -- zahrání karty {t:'p', k: číslo karty v ruce}, konec tahu {t:'e', x: otisk stavu, a: 1 když tah za poraženého hrdinu ukončila hra sama} a výběr odměny po vlně
    -- {t:'r', j: 0-2}. V souboji (katakombypvp) není odměna po vlně ani poražený hrdina, který by tah za sebe nechal ukončit hrou.
    if not (v_keys <@ array['t', 'h', 'k', 'x', 'a', 'j']) or jsonb_typeof(p_payload -> 't') <> 'string' then raise exception 'illegal_move'; end if;
    if p_match.mode not in ('katakomby', 'katakombypvp') then raise exception 'illegal_move'; end if;
    if p_match.mode = 'katakombypvp' and ((p_payload ->> 't') = 'r' or p_payload ? 'a') then raise exception 'illegal_move'; end if;
    if (p_payload ->> 't') = 'hero' then
      if p_match.move_count >= 2 or not (v_keys <@ array['t', 'h']) or not public.mp_int_in(p_payload -> 'h', 0, 4) then raise exception 'illegal_move'; end if;
    else
      if p_match.move_count < 2 then raise exception 'illegal_move'; end if;
      if (p_payload ->> 't') = 'p' then
        if not (v_keys <@ array['t', 'k']) or not public.mp_int_in(p_payload -> 'k', 0, 9) then raise exception 'illegal_move'; end if;
      elsif (p_payload ->> 't') = 'e' then
        if not (v_keys <@ array['t', 'x', 'a']) or (p_payload ? 'x' and not public.mp_int_in(p_payload -> 'x', 0, 4294967295)) or (p_payload ? 'a' and p_payload -> 'a' <> '1'::jsonb) then raise exception 'illegal_move'; end if;
      elsif (p_payload ->> 't') = 'r' then
        if not (v_keys <@ array['t', 'j']) or not public.mp_int_in(p_payload -> 'j', 0, 2) then raise exception 'illegal_move'; end if;
      else
        raise exception 'illegal_move';
      end if;
    end if;

  elsif v_game = 'hannibal' then
    -- tah {t:'turn', k: pořadí tahu v zápase od 0, a: seznam akcí, h: otisk stavu, e: konec}; akce: ['m', jednotka, sloupec, řada], ['a', útočník, cíl], ['b', jednotka], ['u']
    if not (v_keys <@ array['t', 'k', 'a', 'h', 'e']) or p_payload -> 't' <> '"turn"'::jsonb then raise exception 'illegal_move'; end if;
    if not public.mp_int_in(p_payload -> 'k', 0, 100000) or (p_payload ->> 'k')::int <> p_match.move_count then raise exception 'illegal_move'; end if;
    if not public.mp_int_in(p_payload -> 'h', 0, 4294967295) or (p_payload ? 'e' and not public.mp_int_in(p_payload -> 'e', 0, 1)) then raise exception 'illegal_move'; end if;
    if jsonb_typeof(p_payload -> 'a') <> 'array' or jsonb_array_length(p_payload -> 'a') > 150 then raise exception 'illegal_move'; end if;
    for v_i in 0..(jsonb_array_length(p_payload -> 'a') - 1) loop
      v_a := (p_payload -> 'a') -> v_i;
      if jsonb_typeof(v_a) <> 'array' or jsonb_typeof(v_a -> 0) <> 'string' then raise exception 'illegal_move'; end if;
      v_n := jsonb_array_length(v_a);
      if not (case v_a ->> 0
                when 'm' then v_n = 4 and jsonb_typeof(v_a -> 1) in ('string', 'number') and public.mp_int_in(v_a -> 2, 0, 11) and public.mp_int_in(v_a -> 3, 0, 7)
                when 'a' then v_n = 3 and jsonb_typeof(v_a -> 1) in ('string', 'number') and jsonb_typeof(v_a -> 2) in ('string', 'number')
                when 'b' then v_n = 2 and jsonb_typeof(v_a -> 1) in ('string', 'number')
                when 'u' then v_n = 1
                else false end) then raise exception 'illegal_move'; end if;
    end loop;
  end if;
end $$;

revoke all on function public.mp_cfg(text, text) from public, anon, authenticated;
revoke all on function public.mp_check_payload(public.mp_matches, smallint, jsonb) from public, anon, authenticated;
