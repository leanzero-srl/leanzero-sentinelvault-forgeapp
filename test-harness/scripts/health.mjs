// Connectivity + credential check: confirms the harness can reach Confluence.
import { currentUser } from "../lib/confluence.mjs";

try {
  const me = await currentUser();
  console.log(`ok   authenticated as ${me.displayName || me.accountId} (${me.accountId})`);
  process.exit(0);
} catch (e) {
  console.log(`FAIL ${e.message}`);
  process.exit(1);
}
