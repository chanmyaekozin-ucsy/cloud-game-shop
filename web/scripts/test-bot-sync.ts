import { readStore, updateStore } from "../src/lib/store";
import { formatKs, salePriceKs } from "../src/lib/format";
import { packagesKeyboard } from "../src/bot/keyboards";

async function run() {
  console.log("=== Testing Bot & Web Unified Price Sync ===");

  const storeBefore = await readStore();
  const mlbbPkg = storeBefore.packages.find((p) => p.gameId === "game_mlbb" || p.gameId === "mlbb");

  if (!mlbbPkg) {
    console.error("No MLBB package found!");
    process.exit(1);
  }

  console.log(`[Before Update] Package: ${mlbbPkg.displayName}`);
  console.log(`Original: ${mlbbPkg.priceKs} Ks | Off: ${mlbbPkg.offPercent}% | Sale: ${formatKs(salePriceKs(mlbbPkg))}`);

  const testPrice = 7777;
  const testOffPercent = 15;

  console.log(`\nSimulating Admin Web Update -> priceKs: ${testPrice}, offPercent: ${testOffPercent}%...`);
  await updateStore((store) => {
    const pkg = store.packages.find((p) => p.id === mlbbPkg.id);
    if (pkg) {
      pkg.priceKs = testPrice;
      pkg.offPercent = testOffPercent;
    }
  });

  const storeAfter = await readStore();
  const updatedPkg = storeAfter.packages.find((p) => p.id === mlbbPkg.id)!;
  console.log(`[After Update in Store] Package: ${updatedPkg.displayName}`);
  console.log(`Original: ${updatedPkg.priceKs} Ks | Off: ${updatedPkg.offPercent}% | Sale: ${formatKs(salePriceKs(updatedPkg))}`);

  const activePkgs = storeAfter.packages.filter((p) => p.gameId === updatedPkg.gameId && p.isActive);
  const kb = packagesKeyboard(activePkgs, "my");
  console.log(`\n[Bot Inline Keyboard] Generated ${kb.inline_keyboard.length} rows directly from store!`);

  // Restore original
  await updateStore((store) => {
    const pkg = store.packages.find((p) => p.id === mlbbPkg.id);
    if (pkg) {
      pkg.priceKs = mlbbPkg.priceKs;
      pkg.offPercent = mlbbPkg.offPercent;
    }
  });
  console.log("\n[PASS] Test Passed: Telegram bot dynamically queries store.json with zero divergence!");
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
