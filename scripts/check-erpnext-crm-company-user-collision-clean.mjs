import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = fs.readFileSync(new URL("../server/_erpnext-sales-order-sync.ts", import.meta.url), "utf8");
const parsed = ts.createSourceFile("erpnext-sales-order-sync.ts", source, ts.ScriptTarget.Latest, true);
const names = ["normalizeComparable", "erpCustomerIdentity", "erpCrmContactIdentity", "sameCrmContactPhone", "ensureCrmContact"];
const functions = parsed.statements
  .filter((node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text))
  .map((node) => node.getText(parsed));
assert.equal(functions.length, names.length, "All actual source functions must be available for the regression test");
const isolated = ts.transpileModule(functions.join("\n\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const context = {
  clean: (value) => value == null ? "" : String(value).trim(),
};
vm.runInNewContext(`${isolated}\nthis.exports = { erpCrmContactIdentity, ensureCrmContact };`, context);
const { erpCrmContactIdentity, ensureCrmContact } = context.exports;

function createDb(seedContacts = [], seedIdentities = []) {
  const contacts = seedContacts.map((row) => ({ ...row }));
  const identities = seedIdentities.map((row) => ({ ...row }));
  let nextId = 1;
  const tx = async (strings, ...values) => {
    const query = strings.join("?").replace(/\s+/g, " ").trim().toLowerCase();
    if (query.startsWith("select c.*,c.id::text from crm.contact_identities")) {
      const identity = identities.find((row) => row.channel_code === "erpnext" && row.external_id === values[0]);
      return identity ? contacts.filter((row) => row.id === identity.contact_id) : [];
    }
    if (query.startsWith("select *,id::text from crm.contacts where id=")) return contacts.filter((row) => row.id === values[0]);
    if (query.startsWith("select *,id::text from crm.contacts where primary_phone_normalized=")) return contacts.filter((row) => row.primary_phone_normalized === values[0]);
    if (query.startsWith("select *,id::text from crm.contacts where contact_key=")) return contacts.filter((row) => row.contact_key === values[0]);
    if (query.startsWith("select id::text from crm.contacts where contact_key=")) return contacts.filter((row) => row.contact_key === values[0]).map((row) => ({ id: row.id }));
    if (query.startsWith("select contact_id::text from crm.contact_identities")) return identities.filter((row) => row.channel_code === "erpnext" && row.external_id === values[0]).map((row) => ({ contact_id: row.contact_id }));
    if (query.startsWith("insert into crm.contacts(")) {
      if (contacts.some((row) => row.contact_key === values[0])) return [];
      if (values[3] && contacts.some((row) => row.primary_phone_normalized === values[3])) throw new Error("simulated phone UNIQUE collision");
      const row = { id: `new-${nextId++}`, contact_key: values[0], display_name: values[1], primary_phone: values[2], primary_phone_normalized: values[3], metadata: values[4] };
      contacts.push(row);
      return [row];
    }
    if (query.startsWith("update crm.contacts set")) {
      const row = contacts.find((item) => item.id === values[4]);
      assert.ok(row, "UPDATE must target an existing contact");
      row.display_name = values[0] || row.display_name;
      row.primary_phone = values[1] || row.primary_phone;
      row.primary_phone_normalized = values[2] || row.primary_phone_normalized;
      row.metadata = { ...row.metadata, ...values[3] };
      return [row];
    }
    if (query.startsWith("insert into crm.contact_identities(")) {
      const [contactId, externalId, participantId, displayName, metadata] = values;
      const existing = identities.find((item) => item.channel_code === "erpnext" && item.external_id === externalId);
      if (existing) Object.assign(existing, { contact_id: contactId, participant_id: participantId, display_name: displayName || existing.display_name, metadata: { ...existing.metadata, ...metadata } });
      else identities.push({ contact_id: contactId, channel_code: "erpnext", external_id: externalId, participant_id: participantId, display_name: displayName, metadata });
      return [];
    }
    throw new Error(`Unexpected SQL statement in regression test: ${query.slice(0, 170)}`);
  };
  tx.json = (value) => value;
  return { tx, contacts, identities };
}

const company = "شركة تمويل اختبارية";
const user = "عميل اختباري مستقل";
const phone = "966500000111";
const doc = {
  erpCustomerId: company,
  accountingCustomerName: company,
  actualCustomerName: user,
  actualCustomerPhone: "0500000111  ",
  actualCustomerPhoneNormalized: phone,
  sourceInstanceKey: "next-erp:sales-order:SAL-ORD-TEST-001:created:2026-10-12",
};
const accountKey = `erpnext:${company}`;
const companyContact = { id: "company-contact", contact_key: accountKey, display_name: company, primary_phone: "0559999999", primary_phone_normalized: "966559999999", metadata: {} };
const db = createDb([companyContact], [{ contact_id: companyContact.id, channel_code: "erpnext", external_id: `customer:${company}`, participant_id: company, metadata: {} }]);
assert.equal(erpCrmContactIdentity(doc).contactKey, `erpnext:user-phone:${phone}`);
const first = await ensureCrmContact(db.tx, { normalized: doc, name: user, orderNo: "SAL-ORD-TEST-001" });
assert.equal(first.contact_key, `erpnext:user-phone:${phone}`, "The actual user must not receive the financing company's unique key");
assert.equal(db.contacts.length, 2, "Company and actual user must remain separate CRM contacts");
assert.equal(db.contacts[0].primary_phone_normalized, "966559999999", "Existing company phone must not be overwritten");
assert.equal(db.identities.find((row) => row.external_id === `customer:${company}`).contact_id, "company-contact", "Company ERP identity must not be reassigned");
assert.equal(db.identities.find((row) => row.external_id === `user-phone:${phone}`).contact_id, first.id, "User identity must link to user contact");
const repeat = await ensureCrmContact(db.tx, { normalized: doc, name: user, orderNo: "SAL-ORD-TEST-001" });
assert.equal(repeat.id, first.id, "Replaying the same webhook must reuse the same CRM contact");
assert.equal(db.contacts.length, 2, "Replaying must not duplicate CRM contacts");

const sameUserDifferentBank = { ...doc, erpCustomerId: "شركة تمويل أخرى", accountingCustomerName: "شركة تمويل أخرى" };
const replayFromAnotherCompany = await ensureCrmContact(db.tx, { normalized: sameUserDifferentBank, name: user, orderNo: "SAL-ORD-TEST-002" });
assert.equal(replayFromAnotherCompany.id, first.id, "One phone must resolve to one actual user across ERP customer companies");

const fallbackDb = createDb([companyContact]);
const sameAccountingName = { ...doc, actualCustomerName: company, actualCustomerPhoneNormalized: "966500000222", actualCustomerPhone: "0500000222" };
const fallback = await ensureCrmContact(fallbackDb.tx, { normalized: sameAccountingName, name: company, orderNo: "SAL-ORD-TEST-003" });
assert.equal(fallback.contact_key, `erpnext:user-phone:966500000222`, "A company key already tied to another phone must not be hijacked");
assert.equal(fallbackDb.contacts.length, 2);
const fallbackReplay = await ensureCrmContact(fallbackDb.tx, { normalized: sameAccountingName, name: company, orderNo: "SAL-ORD-TEST-003" });
assert.equal(fallbackReplay.id, fallback.id, "Fallback contact must be stable on replay");
assert.equal(fallbackDb.identities.find((row) => row.external_id === `user-phone:${sameAccountingName.actualCustomerPhoneNormalized}`).contact_id, fallback.id, "Fallback must retain the end-user identity after replay");
assert.equal(fallbackDb.identities.some((row) => row.external_id === `customer:${company}` && row.contact_id === fallback.id), false, "Replay must not hijack the accounting customer identity");

const noPhoneDb = createDb([companyContact]);
const noPhone = await ensureCrmContact(noPhoneDb.tx, { normalized: { ...doc, actualCustomerPhone: "", actualCustomerPhoneNormalized: "" }, name: company, orderNo: "SAL-ORD-TEST-004" });
assert.equal(noPhone.contact_key, accountKey, "Phone-less orders retain existing ERP accounting identity handling");
assert.equal(noPhoneDb.contacts.length, 1);

const existingLeadDb = createDb([{ id: "existing-crm-contact", contact_key: "whatsapp:customer-123", display_name: user, primary_phone: "0500000111", primary_phone_normalized: phone, metadata: {} }, companyContact]);
const alreadyLinked = await ensureCrmContact(existingLeadDb.tx, { normalized: doc, name: user, orderNo: "SAL-ORD-TEST-001", existingContactId: "existing-crm-contact" });
assert.equal(alreadyLinked.id, "existing-crm-contact", "Existing CRM lead/contact must take priority");
assert.equal(existingLeadDb.contacts.length, 2);

assert.ok(source.includes("pg_advisory_xact_lock"), "Same-phone linking must be serialized before lead lookup");
assert.ok(source.includes("on conflict(contact_key) do nothing"), "Contact insert must be safe on repeated key");
console.log("PASS: ERPNext Sales Order duplicate ERP customer key, distinct end-user phone, replay, fallback and existing CRM contact checks");
