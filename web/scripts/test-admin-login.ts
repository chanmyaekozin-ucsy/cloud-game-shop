import { readStore } from "../src/lib/store";
import { hashPassword } from "../src/lib/hash";
import { adminCredentials } from "../src/lib/seed";

async function testAdminLogin() {
  console.log("=== Testing Admin Login Authentication ===");
  const creds = adminCredentials();
  console.log("Loaded Admin Credentials from .env:", creds);

  const store = await readStore();
  const adminUser = store.users.find((u) => u.id === "user_admin" || u.role === "admin");

  if (!adminUser) {
    console.error("❌ Admin user not found in store!");
    process.exit(1);
  }

  console.log("Admin User in Store:", {
    id: adminUser.id,
    email: adminUser.email,
    role: adminUser.role,
    pinHash: adminUser.pinHash,
  });

  const testEmail = "admin@cgs.com";
  const testPassword = "Zxcvbnm7890@";

  const emailMatch = adminUser.email.toLowerCase() === testEmail.toLowerCase();
  const passwordHashMatch = adminUser.pinHash === hashPassword(testPassword);

  console.log(`\nEmail match '${testEmail}':`, emailMatch);
  console.log(`Password hash match '${testPassword}':`, passwordHashMatch);

  if (emailMatch && passwordHashMatch) {
    console.log("\n✅ Admin login successfully verified!");
  } else {
    console.error("\n❌ Admin login verification failed!");
    process.exit(1);
  }
}

testAdminLogin().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
