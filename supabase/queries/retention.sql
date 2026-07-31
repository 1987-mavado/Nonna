-- Aktive Nutzer letzte 7 Tage
select count(distinct anon_id)
from usage_events
where created_at > now() - interval '7 days';

-- Retention: aktiv in Woche 1 UND noch aktiv in Woche 3
select count(distinct w1.anon_id)
from usage_events w1
where w1.created_at between now() - interval '21 days' and now() - interval '14 days'
and exists (
  select 1 from usage_events w3
  where w3.anon_id = w1.anon_id
  and w3.created_at > now() - interval '7 days'
);
