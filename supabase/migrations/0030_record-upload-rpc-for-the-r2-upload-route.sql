-- 0030 — record_upload(): the upload rate limit as an RPC, for the R2 route
--
-- Uploads are moving from Supabase Storage to Cloudflare R2, written by one
-- Next.js route handler (src/app/api/upload/route.ts). The 6/hour and 20/hour
-- caps in 0001 §13.4 hang off a trigger on storage.objects, which R2 never
-- touches — so the route needs to ask the database the same question the
-- trigger answered, and have the answer recorded in the same counter.
--
-- One SECURITY DEFINER function, called BEFORE the R2 write: it takes the same
-- per-user advisory lock the 0012 email trigger takes, counts the trailing
-- hour, and either inserts the rate_events row and returns true or returns
-- false. rate_events keeps its zero policies and zero grants — the caller
-- learns one boolean about its own counter, nothing else. The rule table is
-- the existing storage_rate_rule(), so the limits stay in one place.
--
-- Returns false rather than raising: the route turns false into a real 429
-- with a message, which the storage-api path could never produce (§13.5). A
-- bucket without a rule, or no session, is false with no row written.
--
-- Additive: the storage trigger, its policies and the upload_rate_limited()
-- probe all stay until 0031, after the stored URLs point at R2.
create or replace function public.record_upload(p_bucket text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_rule  record;
  v_count int;
begin
  if v_uid is null then
    return false;
  end if;

  select * into v_rule from public.storage_rate_rule(p_bucket);
  if v_rule.v_action is null then
    return false;
  end if;

  -- Serialise per (action, user): two concurrent uploads must not both read
  -- the same pre-cap count. Held to end of transaction.
  perform pg_advisory_xact_lock(hashtextextended(v_rule.v_action || ':' || v_uid::text, 0));

  select count(*) into v_count
  from public.rate_events
  where actor = v_uid and action = v_rule.v_action and at > now() - interval '1 hour';

  if v_count >= v_rule.v_limit then
    return false;
  end if;

  insert into public.rate_events (actor, action) values (v_uid, v_rule.v_action);
  return true;
end;
$$;

revoke all on function public.record_upload(text) from public, anon;
grant execute on function public.record_upload(text) to authenticated;

insert into supabase_migrations.schema_migrations (version, name)
values ('0030', 'record-upload-rpc-for-the-r2-upload-route')
on conflict (version) do nothing;
