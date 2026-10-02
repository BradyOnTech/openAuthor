-- Database-owned Realtime issuance quota. Never accepts a client-selected user,
-- key, clock or policy. One user's devices/books share one window in this tenant.
begin;

create table public.mobile_realtime_rate_policy (
  singleton boolean primary key default true check (singleton),
  issuance_limit integer not null check (issuance_limit between 1 and 1000),
  window_ms integer not null check (window_ms between 1000 and 86400000)
);
insert into public.mobile_realtime_rate_policy (issuance_limit, window_ms) values (5, 60000);

create table public.mobile_realtime_rate_windows (
  user_id uuid primary key references auth.users(id) on delete cascade,
  started_at timestamptz not null,
  issuance_count integer not null check (issuance_count between 0 and 1000)
);

alter table public.mobile_realtime_rate_policy enable row level security;
alter table public.mobile_realtime_rate_windows enable row level security;
revoke all on table public.mobile_realtime_rate_policy, public.mobile_realtime_rate_windows from public, anon, authenticated;

create function public.mobile_consume_realtime_rate_limit(
  p_project_id uuid,
  p_device_id uuid,
  p_expected_limit integer,
  p_expected_window_ms integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
set lock_timeout = '3s'
as $$
declare
  v_policy public.mobile_realtime_rate_policy;
  v_window public.mobile_realtime_rate_windows;
  v_now timestamptz;
  v_end timestamptz;
begin
  perform public.mobile_assert_project_device(p_device_id, p_project_id, 'viewer');
  select * into v_policy from public.mobile_realtime_rate_policy where singleton for share;
  if not found or p_expected_limit is distinct from v_policy.issuance_limit
    or p_expected_window_ms is distinct from v_policy.window_ms then
    raise exception using errcode = '22023', message = 'Gateway rate policy does not match database policy';
  end if;

  insert into public.mobile_realtime_rate_windows (user_id, started_at, issuance_count)
    values (auth.uid(), clock_timestamp(), 0) on conflict (user_id) do nothing;
  select * into v_window from public.mobile_realtime_rate_windows where user_id = auth.uid() for update;
  -- Authority may have changed while this replica waited on another quota write.
  -- Recheck using the current statement snapshot before counting/issuing.
  perform public.mobile_assert_project_device(p_device_id, p_project_id, 'viewer');
  -- Read the server clock after acquiring the row lock. A caller waiting behind
  -- another replica must not reset the window using an older request timestamp.
  v_now := clock_timestamp();
  v_end := v_window.started_at + v_policy.window_ms * interval '1 millisecond';
  if v_now >= v_end then
    update public.mobile_realtime_rate_windows set started_at = v_now, issuance_count = 1 where user_id = auth.uid();
    return jsonb_build_object('allowed', true, 'retry_after_seconds', null);
  end if;
  if v_window.issuance_count >= v_policy.issuance_limit then
    return jsonb_build_object('allowed', false, 'retry_after_seconds',
      greatest(1, ceil(extract(epoch from (v_end - v_now)))::integer));
  end if;
  update public.mobile_realtime_rate_windows set issuance_count = issuance_count + 1 where user_id = auth.uid();
  return jsonb_build_object('allowed', true, 'retry_after_seconds', null);
end;
$$;

revoke execute on function public.mobile_consume_realtime_rate_limit(uuid, uuid, integer, integer) from public, anon;
grant execute on function public.mobile_consume_realtime_rate_limit(uuid, uuid, integer, integer) to authenticated;
comment on function public.mobile_consume_realtime_rate_limit(uuid, uuid, integer, integer) is
  'Atomic per-user Realtime issuance quota with active session/device/project checks. Database administrator owns limits. A lost response is not a safe retry.';

commit;
