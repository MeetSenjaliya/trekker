-- ============================================================================
-- 0028 — session end, sign-in method, account type and new-device flag on
--        login_events
-- ============================================================================
-- 0027 records who signed in, when, from where and on what. Four things the
-- page still could not say: when the session ended, how they signed in
-- (password or email link), what kind of account it was, and whether the
-- device was one this user had used before. All four are derivable from
-- tables GoTrue already keeps — for as long as it keeps them — so the same
-- copy-it-before-it-goes approach as 0027 applies.
--
-- ---- ended_at: a third trigger on auth.sessions ------------------------------
-- GoTrue deletes the auth.sessions row on sign-out (and on expiry cleanup).
-- An AFTER DELETE trigger stamps ended_at on the matching login_events row.
-- Until that delete happens the row is "Active" — which means the session row
-- still exists, not necessarily that anyone is using it: sessions GoTrue has
-- not yet cleaned up show Active too.
--
-- ---- method: comes from auth.mfa_amr_claims, not auth.sessions ---------------
-- The sign-in method is not on auth.sessions at all. GoTrue records it as an
-- AMR claim (auth.mfa_amr_claims.authentication_method: 'password', 'otp',
-- 'magiclink', 'recovery', …) — and it inserts that claim AFTER the session
-- row, in the same transaction. So the on_auth_session_created trigger runs
-- before the claim exists and cannot read it. Hence a second trigger, on
-- auth.mfa_amr_claims itself, that writes the method back onto the
-- login_events row once the claim lands. The session INSERT still tries to
-- read a claim (`method = (select …)`) so that if GoTrue ever reorders its
-- writes the value is picked up either way; the claim trigger only fills a
-- NULL, so the first claim per session wins and nothing is overwritten.
--
-- ---- every trigger here is fail-open, on purpose -----------------------------
-- Both auth.sessions and auth.mfa_amr_claims are written inside the sign-in
-- request. A trigger on either that raises rolls GoTrue's write back and the
-- user gets a 500 instead of a session — for everyone, until the trigger is
-- dropped. That is 0027's rule and it now covers three triggers and two
-- functions: record_login_event() (INSERT / UPDATE / DELETE on auth.sessions)
-- and record_login_method() (INSERT on auth.mfa_amr_claims) both wrap their
-- whole body in `exception when others`. A missed column is a gap in a log; a
-- raise is an outage. Keep it that way.
--
-- Both tables belong to supabase_auth_admin; `postgres` holds TRIGGER on each
-- (has_table_privilege, checked live 2026-09-17), the same standing 0001 and
-- 0027 rely on. GoTrue writes as supabase_auth_admin, which has no rights on
-- public.*, so both functions are SECURITY DEFINER with EXECUTE revoked from
-- every client role.
--
-- ---- account_type: a snapshot, highest wins ---------------------------------
-- platform_admins → 'platform_admin'; company_members.role = 'owner' →
-- 'company_owner'; any other company_members row → 'company_staff'; else
-- 'trekker'. Taken at sign-in, like email, so a later role change does not
-- rewrite history.
--
-- ---- is_new_device: no earlier row with this ip AND none with this browser --
-- Per user. A first sign-in is a new device; so is a new IP on a browser the
-- user has never used. A new IP alone is not (people move networks), and a new
-- browser alone is not (people update browsers) — so the user-agent is
-- compared with every version number stripped out, and a Chrome 151 → 152
-- bump on the same IP is not flagged. Equality is `is not distinct from` so a
-- client that sends no user-agent compares equal to itself rather than
-- flagging every sign-in.
--
-- ---- access: unchanged ------------------------------------------------------
-- authenticated keeps SELECT only, under 0027's is_platform_admin() policy;
-- anon holds nothing; no client role can write. New columns inherit the
-- table-level grant, so nothing to add.

-- ---- columns -----------------------------------------------------------------
alter table public.login_events
  add column if not exists ended_at      timestamptz,
  add column if not exists method        text,
  add column if not exists account_type  text,
  add column if not exists is_new_device boolean not null default false;

-- ---- trigger function on auth.sessions ---------------------------------------
create or replace function public.record_login_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.login_events
      (user_id, session_id, email, ip, user_agent, created_at, last_seen_at,
       method, account_type, is_new_device)
    select new.user_id, new.id, u.email, host(new.ip), new.user_agent,
           new.created_at, new.created_at,
           (select c.authentication_method
              from auth.mfa_amr_claims c
             where c.session_id = new.id
             order by c.created_at
             limit 1),
           case
             when exists (select 1 from public.platform_admins pa
                           where pa.user_id = new.user_id)
               then 'platform_admin'
             when exists (select 1 from public.company_members cm
                           where cm.user_id = new.user_id and cm.role = 'owner')
               then 'company_owner'
             when exists (select 1 from public.company_members cm
                           where cm.user_id = new.user_id)
               then 'company_staff'
             else 'trekker'
           end,
           not exists (select 1 from public.login_events e
                        where e.user_id = new.user_id
                          and e.session_id is distinct from new.id
                          and e.ip is not distinct from host(new.ip))
           and not exists (select 1 from public.login_events e
                            where e.user_id = new.user_id
                              and e.session_id is distinct from new.id
                              and regexp_replace(e.user_agent, '\d+([._]\d+)*', '', 'g')
                                  is not distinct from
                                  regexp_replace(new.user_agent, '\d+([._]\d+)*', '', 'g'))
      from auth.users u
     where u.id = new.user_id
    on conflict (session_id) do nothing;
    return new;
  elsif tg_op = 'DELETE' then
    update public.login_events
       set ended_at = now()
     where session_id = old.id
       and ended_at is null;
    return old;
  else
    update public.login_events
       set last_seen_at = now()
     where session_id = new.id;
    return new;
  end if;
exception when others then
  -- A failure here would fail the sign-in (or sign-out) itself. Never let it.
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke execute on function public.record_login_event() from public, anon, authenticated;

drop trigger if exists on_auth_session_deleted on auth.sessions;
create trigger on_auth_session_deleted
  after delete on auth.sessions
  for each row execute function public.record_login_event();

-- ---- trigger function on auth.mfa_amr_claims ---------------------------------
create or replace function public.record_login_method()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.login_events
     set method = new.authentication_method
   where session_id = new.session_id
     and method is null;
  return new;
exception when others then
  -- Same rule as record_login_event(): a raise here fails the sign-in.
  return new;
end;
$$;

revoke execute on function public.record_login_method() from public, anon, authenticated;

drop trigger if exists on_auth_amr_claim_created on auth.mfa_amr_claims;
create trigger on_auth_amr_claim_created
  after insert on auth.mfa_amr_claims
  for each row execute function public.record_login_method();

-- ---- backfill the rows 0027 already holds ------------------------------------
-- Every one of them is a session that is still alive (0027 only ever copied
-- live sessions and the DELETE trigger did not exist), so ended_at stays null.
update public.login_events le
   set method = (select c.authentication_method
                   from auth.mfa_amr_claims c
                  where c.session_id = le.session_id
                  order by c.created_at
                  limit 1)
 where le.method is null;

update public.login_events le
   set account_type = case
     when exists (select 1 from public.platform_admins pa where pa.user_id = le.user_id)
       then 'platform_admin'
     when exists (select 1 from public.company_members cm
                   where cm.user_id = le.user_id and cm.role = 'owner')
       then 'company_owner'
     when exists (select 1 from public.company_members cm where cm.user_id = le.user_id)
       then 'company_staff'
     else 'trekker'
   end
 where le.account_type is null;

-- "Earlier" is by (created_at, id) so two rows with the same timestamp still
-- have a definite order and cannot both come out as the first.
update public.login_events le
   set is_new_device =
       not exists (select 1 from public.login_events e
                    where e.user_id = le.user_id
                      and (e.created_at, e.id) < (le.created_at, le.id)
                      and e.ip is not distinct from le.ip)
       and not exists (select 1 from public.login_events e
                        where e.user_id = le.user_id
                          and (e.created_at, e.id) < (le.created_at, le.id)
                          and regexp_replace(e.user_agent, '\d+([._]\d+)*', '', 'g')
                              is not distinct from
                              regexp_replace(le.user_agent, '\d+([._]\d+)*', '', 'g'));

-- ============================================================================
-- RECORD THIS MIGRATION
-- ============================================================================
insert into supabase_migrations.schema_migrations (version, name)
values ('0028', 'session-end-method-account-type-and-new-device-on-login-events')
on conflict (version) do nothing;
