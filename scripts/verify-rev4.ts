/**
 * Round-trip verification of the rev-4 PhoneBurner client fix.
 * Creates a test contact with full payload, fetches it back, asserts
 * every field persisted, then deletes it.
 *
 *   PHONEBURNER_TOKEN=... node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/verify-rev4.ts
 */
import { createContact, getContact, deleteContact } from "../src/lib/phoneburner/client";
import { FOLDERS } from "../src/lib/phoneburner/folders";

(async () => {
  const phone = "555" + Math.floor(1000000 + Math.random() * 8999999);
  console.log(`creating with phone ${phone}, folder ${FOLDERS.LEADS_FRESH}`);

  const created = await createContact({
    first_name: "REVFOUR_VERIFY",
    last_name: "DELETE_ME",
    phone,
    email: "revfour@example.invalid",
    address1: "123 Verify St",
    city: "Brooklyn",
    state: "NY",
    zip: "11201",
    category_id: FOLDERS.LEADS_FRESH,
    notes: "rev-4 verification — should land in 66223880 with all fields populated",
    custom_fields: [{ name: "Customer ID", type: 1, value: "REV4-VERIFY-9999" }],
  });
  console.log(`created.user_id = ${created.user_id}`);
  if (!created.user_id) throw new Error("FAILED — no user_id from createContact");

  const fetched = await getContact(created.user_id);
  console.log(`\n--- fetched ---`);
  console.log(JSON.stringify(fetched, null, 2));

  const cf = fetched?.custom_fields ?? [];
  const customerIdField = cf.find((c) => c.name === "Customer ID");
  const checks: Record<string, boolean> = {
    user_id_matches: fetched?.user_id === created.user_id,
    first_name: fetched?.first_name === "REVFOUR_VERIFY",
    raw_phone: fetched?.raw_phone === phone,
    email: fetched?.email_address === "revfour@example.invalid",
    address1: fetched?.address1 === "123 Verify St",
    city: fetched?.city === "Brooklyn",
    state: fetched?.state === "NY",
    zip: fetched?.zip === "11201",
    category_id: fetched?.category_id === FOLDERS.LEADS_FRESH,
    notes_present: !!fetched?.notes && fetched.notes.includes("rev-4 verification"),
    custom_field_customer_id: customerIdField?.value === "REV4-VERIFY-9999",
  };
  console.log(`\n--- checks ---`);
  let allPass = true;
  for (const [k, v] of Object.entries(checks)) {
    console.log(`  ${v ? "✓" : "✗"}  ${k}`);
    if (!v) allPass = false;
  }

  await deleteContact(created.user_id);
  console.log(`\ntest contact deleted: ${created.user_id}`);
  console.log(allPass ? "\n=== ALL CHECKS PASSED ===" : "\n=== SOME CHECKS FAILED ===");
  process.exitCode = allPass ? 0 : 1;
})().catch((e) => {
  console.error("verify failed:", e);
  process.exitCode = 1;
});
