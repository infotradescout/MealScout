import { pool } from "../server/db.js";
import bcrypt from "bcryptjs";

function requireOneOfEnv(names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }
  throw new Error(`Missing required environment variable: ${names.join(" or ")}`);
}

function resolveAdminEmail(): string {
  return requireOneOfEnv(["MEALSCOUT_ADMIN_EMAIL", "ADMIN_EMAIL"]);
}

function resolveAdminPassword(): string {
  return requireOneOfEnv(["MEALSCOUT_ADMIN_PASSWORD", "ADMIN_PASSWORD"]);
}

async function checkAndFixAdmin() {
  const email = resolveAdminEmail();
  const password = resolveAdminPassword();

  console.log(`Checking admin account: ${email}\n`);

  try {
    if (!pool) {
      throw new Error("Database pool is not initialized");
    }

    // Check if admin exists
    const adminUsersResult = await pool.query(
      `
        select
          id,
          email,
          user_type,
          first_name,
          last_name,
          password_hash,
          email_verified
        from users
        where email = $1
        limit 1
      `,
      [email],
    );
    const adminUsers = adminUsersResult.rows || [];

    if (adminUsers.length === 0) {
      console.log("❌ Admin account does not exist!");
      console.log("Creating admin account...\n");

      const passwordHash = await bcrypt.hash(password, 12);

      await pool.query(
        `
          insert into users
            (email, user_type, first_name, last_name, password_hash, email_verified, created_at)
          values
            ($1, $2, $3, $4, $5, $6, now())
        `,
        [email, "admin", "MealScout", "Admin", passwordHash, true],
      );

      console.log("✅ Admin account created successfully!");
      console.log(`   Email: ${email}`);
    } else {
      const admin = adminUsers[0];
      console.log("✅ Admin account found:");
      console.log(`   ID: ${admin.id}`);
      console.log(`   Email: ${admin.email}`);
      console.log(`   User Type: ${admin.user_type}`);
      console.log(`   Name: ${admin.first_name} ${admin.last_name}`);
      console.log(`   Has Password: ${admin.password_hash ? "Yes" : "No"}`);
      console.log(`   Email Verified: ${admin.email_verified}\n`);

      // Update password if missing or if explicitly requested
      if (!admin.password_hash) {
        console.log("⚠️  No password hash found. Setting password...\n");
      } else {
        console.log("🔄 Resetting password...\n");
      }

      const passwordHash = await bcrypt.hash(password, 12);

      await pool.query(
        `
          update users
          set
            password_hash = $1,
            email_verified = $2,
            user_type = $3,
            updated_at = now()
          where id = $4
        `,
        [passwordHash, true, "admin", admin.id],
      );

      console.log("✅ Password updated successfully!");
      console.log(`   Email: ${email}`);
    }

    console.log("\n✅ Admin login should now work at /admin-login");
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }

  process.exit(0);
}

checkAndFixAdmin();
