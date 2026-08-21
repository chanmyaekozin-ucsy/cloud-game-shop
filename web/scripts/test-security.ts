import { checkRateLimit } from "../src/lib/rate-limit";

function testRateLimiter() {
  const key = "test:user1";
  const limit = 3;
  const windowMs = 1000;

  for (let i = 1; i <= limit; i++) {
    const res = checkRateLimit(key, limit, windowMs);
    if (!res.ok) {
      throw new Error(`Expected attempt ${i} to succeed`);
    }
  }

  const blocked = checkRateLimit(key, limit, windowMs);
  if (blocked.ok) {
    throw new Error("Expected rate limiter to block after reaching limit");
  }

  console.log("✓ Rate limiter unit test passed!");
}

testRateLimiter();
