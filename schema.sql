create extension if not exists postgis;
create extension if not exists citext;

create table profiles(
  user_id uuid primary key references auth.users on delete cascade,
  nickname citext unique not null check (nickname ~ '^[A-Za-z0-9_]{3,20}$'),
  avatar text not null default '🏠',
  created_at timestamptz not null default now());

-- VIRTUAL currency (AC). Not real money.
create table wallets(
  user_id uuid primary key references auth.users on delete cascade,
  balance int not null default 100000 check (balance >= 0));

create table plots(
  id uuid primary key default gen_random_uuid(),
  owner uuid unique not null references auth.users on delete cascade, -- one house per user
  nickname citext not null,
  lat double precision not null, lng double precision not null,
  cell_x int not null, cell_y int not null,
  style text not null default 'modern' check (style in ('modern','classic','villa','uzbek')),
  wall text not null default '#e8e2d5' check (wall ~ '^#[0-9a-fA-F]{6}$'),
  roof text not null default '#8a3b2e' check (roof ~ '^#[0-9a-fA-F]{6}$'),
  garden boolean not null default true,
  garage boolean not null default false,
  lights boolean not null default true,
  geog geography(point,4326) generated always as (st_point(lng,lat)::geography) stored,
  created_at timestamptz not null default now(),
  unique(cell_x, cell_y));          -- duplicate-location protection
create index on plots using gist(geog);

create table purchases(
  id bigserial primary key, user_id uuid not null, plot_id uuid not null,
  price int not null, created_at timestamptz not null default now());

alter table profiles enable row level security;
alter table wallets enable row level security;
alter table plots enable row level security;
alter table purchases enable row level security;
create policy "public read" on profiles for select using (true);
create policy "public read" on plots for select using (true);
create policy "own wallet" on wallets for select using (user_id = auth.uid());
create policy "own purchases" on purchases for select using (user_id = auth.uid());
-- no insert/update/delete policies: all writes go through the functions below.

create or replace function purchase_plot(p_lat float8, p_lng float8, p_nick text, p_style text, p_wall text, p_roof text)
returns plots language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); price int := 25000; cx int; cy int; r plots;
begin
  if uid is null then raise exception 'Please log in first'; end if;
  if p_lat not between 40.72 and 40.84 or p_lng not between 72.27 and 72.42 then
    raise exception 'This location is outside Andijan'; end if;
  cx := floor(p_lng * 10000); cy := floor(p_lat * 10000);   -- ~8m x 11m cells
  insert into profiles(user_id, nickname) values (uid, p_nick) on conflict (user_id) do nothing;
  insert into wallets(user_id) values (uid) on conflict do nothing;
  if (select nickname from profiles where user_id = uid) <> p_nick then
    raise exception 'Your account already uses a different nickname'; end if;
  update wallets set balance = balance - price where user_id = uid and balance >= price;
  if not found then raise exception 'Not enough virtual coins'; end if;
  insert into plots(owner, nickname, lat, lng, cell_x, cell_y, style, wall, roof)
    values (uid, p_nick, (cy + .5) / 10000.0, (cx + .5) / 10000.0, cx, cy, p_style, p_wall, p_roof)
    returning * into r;
  insert into purchases(user_id, plot_id, price) values (uid, r.id, price);
  return r;
exception when unique_violation then
  raise exception 'Location already sold, or nickname/house already exists';  -- whole purchase rolls back
end $$;

create or replace function update_house(p_style text, p_wall text, p_roof text, p_garden bool, p_garage bool, p_lights bool)
returns void language sql security definer set search_path = public as $$
  update plots set style = p_style, wall = p_wall, roof = p_roof,
    garden = p_garden, garage = p_garage, lights = p_lights where owner = auth.uid(); $$;

revoke execute on function purchase_plot(float8, float8, text, text, text, text) from public, anon;
revoke execute on function update_house(text, text, text, bool, bool, bool) from public, anon;
grant execute on function purchase_plot(float8, float8, text, text, text, text) to authenticated;
grant execute on function update_house(text, text, text, bool, bool, bool) to authenticated;
alter publication supabase_realtime add table plots;
