create table usage_events (
  id uuid default gen_random_uuid() primary key,
  created_at timestamptz default now(),
  anon_id text not null,
  event_type text not null,
  recipe_title text
);

alter table usage_events enable row level security;

create policy "Allow inserts from service role"
  on usage_events for insert
  to service_role
  using (true);
