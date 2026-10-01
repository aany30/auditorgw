-- Saved, reusable UGC personas (characters you create once and reuse across reels).
-- Run this once in the Supabase SQL editor. If you skip it, the app falls back to
-- browser localStorage automatically (per-browser only).

create table if not exists ugc_personas (
  id              uuid primary key default gen_random_uuid(),
  name            text not null default 'Untitled persona',
  style           text not null default 'real',        -- 'real' | 'animated'
  animated_style  text,
  archetype       text,
  source          text,                                -- 'create' | 'upload' | 'reference'
  traits          jsonb,
  details         text,
  product_context jsonb,
  images          jsonb not null default '[]'::jsonb,  -- array of image data URLs (anchor first)
  created_at      timestamptz not null default now()
);

create index if not exists ugc_personas_created_at_idx on ugc_personas (created_at desc);

-- The app talks to Supabase with the service key (server-side only), so RLS can stay
-- off for this table. If you enable RLS, add policies for the service role.
