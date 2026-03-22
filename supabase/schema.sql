create extension if not exists "pgcrypto";

create table if not exists games (
  id uuid primary key default gen_random_uuid(),
  game_id text not null unique,
  admin_player_id text,
  created_at timestamptz not null default now()
);

create table if not exists players (
  id uuid primary key default gen_random_uuid(),
  game_id text not null,
  player_id text not null,
  nickname text not null,
  is_admin boolean not null default false,
  joined_at timestamptz not null default now(),
  unique (game_id, player_id)
);

create table if not exists rounds (
  id uuid primary key default gen_random_uuid(),
  game_id text not null,
  round_id text not null,
  round_no int not null,
  dist_min int not null,
  dist_max int not null,
  realized_demand int,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  unique (game_id, round_id)
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  game_id text not null,
  round_id text not null,
  player_id text not null,
  nickname text not null,
  order_qty int not null,
  sold int,
  leftover int,
  stockout int,
  profit numeric(12,2),
  submitted_at timestamptz not null default now(),
  unique (game_id, round_id, player_id)
);

create table if not exists session_events (
  id uuid primary key default gen_random_uuid(),
  game_id text,
  player_id text,
  event_type text not null,
  payload_json jsonb,
  created_at timestamptz not null default now()
);
