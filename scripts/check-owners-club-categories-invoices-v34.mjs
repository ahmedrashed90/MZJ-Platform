import fs from "node:fs";

let passed = 0;
let failed = 0;

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function expect(name, condition) {
  if (condition) {
    passed += 1;
    console.log(`PASS: ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL: ${name}`);
  }
}

const category = read("src/owners/customerCategory.ts");
const community = read("src/owners/OwnersCommunityPage.tsx");
const portal = read("src/owners/OwnersPortalPage.tsx");
const preview = read("src/owners/OwnersMemberPreviewPage.tsx");
const purchaseActions = read("src/owners/PurchaseInvoiceActions.tsx");
const purchases = read("server/_owners-purchases.ts");
const invoices = read("server/_owners-invoices.ts");
const adminApi = read("server/owners.ts");
const publicApi = read("server/owners-public.ts");
const ownersCore = read("server/_owners.ts");
const styles = read("src/styles.css");

expect("customer category thresholds are fixed at 1000, 1500 and 2500 lifetime points",
  category.includes('if (points >= 2500) return "special"')
  && category.includes('if (points >= 1500) return "gold"')
  && category.includes('if (points >= 1000) return "distinction"'));
expect("customer category labels are exactly تميز وذهبي وخاصة",
  category.includes('return "تميز"') && category.includes('return "ذهبي"') && category.includes('return "خاصة"'));
expect("sold customers table renames type to category and renders colored category badges",
  community.includes('<th>الفئة</th>') && community.includes('owners-customer-category') && styles.includes('.owners-customer-category.distinction') && styles.includes('.owners-customer-category.gold') && styles.includes('.owners-customer-category.special'));
expect("sold customers have a category filter",
  community.includes('value={membersCategoryFilter}') && community.includes('كل الفئات') && community.includes('ownersCustomerCategoryFromPoints(member.lifetime_points)'));
expect("new customers have a category filter",
  community.includes('value={legacyCategoryFilter}') && community.includes('ownersCustomerCategoryFromPoints(customer.lifetime_points || 0)'));
expect("membership card back shows category and useful customer details without QR",
  portal.includes('فئة العميل') && portal.includes('owners-card-back-details') && portal.includes('كود العميل') && portal.includes('تاريخ الانضمام') && portal.includes('عدد مرات الشراء') && portal.includes('آخر شراء') && !portal.includes('QR') && !portal.includes('owners-card-back-rewards'));
expect("admin membership preview shows the same category and back-card details",
  preview.includes('ownersCustomerCategoryFromPoints') && preview.includes('owners-card-back-details') && preview.includes('عدد مرات الشراء'));
expect("category is based on lifetime points so redemption does not lower it",
  portal.includes('ownersCustomerCategoryFromPoints(member.lifetimePoints)')
  && preview.includes('ownersCustomerCategoryFromPoints(member.lifetimePoints)')
  && ownersCore.includes('lifetime_points=lifetime_points+')
  && publicApi.includes('points_balance=points_balance-${Number(reward.points_cost)}')
  && !publicApi.includes('lifetime_points=lifetime_points-${pointsCost}'));
expect("reward catalog is a separate admin tab from membership card",
  community.includes('tab === "membership"') && community.includes('tab === "rewards"') && community.includes('الكتالوج مستقل عن بطاقة العضوية'));
expect("reward editor no longer requires a membership-card selection",
  !community.includes('showOnMemberCard') && !community.includes('إظهار في بطاقة العضوية'));
expect("server preserves legacy reward schema without using membership-card flag for updates",
  adminApi.includes('show_on_member_card,show_on_member_page') && adminApi.includes('${rewardValue || null},false,${showOnMemberPage}') && !adminApi.includes('show_on_member_card=${'));
expect("purchase ledger enriches actual purchased vehicle from the exact tracking sales order",
  purchases.includes('o.sales_order_no=coalesce(sale.source_reference,ledger.metadata->>\'saleOrderReference\')')
  && purchases.includes('from tracking.order_vehicles ov')
  && purchases.includes("'name',coalesce(nullif(ov.car_name,''),concat_ws"));
expect("movement ledger displays the actual purchased vehicle",
  portal.includes('entry?.purchase?.vehicleLabel') && preview.includes('entry?.purchase?.vehicleLabel'));
expect("invoice endpoint verifies the sales order belongs to the member before touching NEXT ERP",
  publicApi.includes('ownerOwnsSalesOrder(member.id, salesOrder)') && adminApi.includes('ownerOwnsSalesOrder(memberId, salesOrder)'));
expect("NEXT ERP invoice lookup uses the official Frappe Connections endpoint",
  invoices.includes('frappe.desk.form.linked_with.get')
  && invoices.includes('doctype: "Sales Order"')
  && invoices.includes('message?.["Sales Invoice"]'));
expect("invoice lookup never queries Sales Invoice Item through the generic REST resource API",
  !invoices.includes('/api/resource/${encodeURIComponent("Sales Invoice Item")}')
  && !invoices.includes('invoiceParentsFromChildRows'));
expect("linked invoice parent documents are rechecked against their Sales Order item rows",
  invoices.includes('items.some((item: any) => clean(item?.sales_order) === salesOrder)'));
expect("only submitted non-cancelled Sales Invoices are returned",
  invoices.includes('Number(doc.docstatus || 0) !== 1') && invoices.includes('clean(doc.status).toLowerCase() === "cancelled"'));
expect("invoice PDF is downloaded live from NEXT ERP print endpoint and validated as PDF",
  invoices.includes('frappe.utils.print_format.download_pdf') && invoices.includes('doctype: "Sales Invoice"') && invoices.includes('signature !== "%PDF-"'));
expect("customer movement provides invoice download and supports multiple linked invoices",
  portal.includes('PurchaseInvoiceActions') && purchaseActions.includes('تحميل الفاتورة') && purchaseActions.includes('rows.length === 1') && purchaseActions.includes('invoices.length > 1'));
expect("missing invoice is stated without fabricating a PDF",
  purchaseActions.includes('الفاتورة غير متاحة بعد'));
expect("NEXT ERP invoice API credentials stay server side",
  invoices.includes('process.env.NEXT_API_KEY') && invoices.includes('process.env.NEXT_API_SECRET') && !purchaseActions.includes('NEXT_API_KEY') && !portal.includes('NEXT_API_KEY'));
expect("no QR was added to membership card",
  !portal.includes('qrcode') && !portal.includes('QrCode') && !preview.includes('QrCode'));

console.log(`\nMZJ Club v34 focused checks: ${passed}/${passed + failed} passed.`);
if (failed) process.exit(1);
