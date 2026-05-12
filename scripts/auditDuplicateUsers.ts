import "dotenv/config";
import { pool } from "../server/db";

async function main() {
  if (!pool) {
    throw new Error("DATABASE_URL is required");
  }

  const result = await pool.query(`
    select
      lower(btrim(email)) as normalized_email,
      count(*)::int as account_count,
      json_agg(
        json_build_object(
          'id', id,
          'email', email,
          'userType', user_type,
          'googleId', google_id,
          'facebookId', facebook_id,
          'tradescoutId', tradescout_id,
          'isDisabled', coalesce(is_disabled, false),
          'createdAt', created_at,
          'updatedAt', updated_at
        )
        order by created_at asc
      ) as accounts
    from users
    where email is not null and btrim(email) <> ''
    group by lower(btrim(email))
    having count(*) > 1
    order by count(*) desc, normalized_email asc
  `);

  if (result.rows.length === 0) {
    console.log("No duplicate normalized user emails found.");
    return;
  }

  console.log(
    `Found ${result.rows.length} duplicate normalized email group(s).`,
  );
  for (const row of result.rows) {
    console.log(`\n${row.normalized_email} (${row.account_count} accounts)`);
    for (const account of row.accounts || []) {
      console.log(
        [
          `- ${account.id}`,
          account.email,
          `type=${account.userType}`,
          account.googleId ? "google" : null,
          account.facebookId ? "facebook" : null,
          account.tradescoutId ? "tradescout" : null,
          account.isDisabled ? "disabled" : "active",
          `created=${account.createdAt}`,
        ]
          .filter(Boolean)
          .join(" | "),
      );
    }
  }

  process.exitCode = 2;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool?.end().catch(() => undefined);
  });
