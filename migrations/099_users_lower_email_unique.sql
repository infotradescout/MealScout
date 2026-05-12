-- Prevent case-only duplicate accounts such as Owner@Truck.com and owner@truck.com.
-- If this migration reports duplicates, merge or disable those rows first, then rerun.
do $$
begin
  if exists (
    select 1
    from users
    where email is not null and btrim(email) <> ''
    group by lower(btrim(email))
    having count(*) > 1
  ) then
    raise exception 'Cannot create users lower(email) unique index while duplicate normalized emails exist. Run scripts/auditDuplicateUsers.ts for details.';
  end if;
end $$;

update users
set email = lower(btrim(email)),
    updated_at = now()
where email is not null
  and email <> lower(btrim(email));

create unique index if not exists idx_users_email_lower_unique
  on users (lower(email))
  where email is not null;
