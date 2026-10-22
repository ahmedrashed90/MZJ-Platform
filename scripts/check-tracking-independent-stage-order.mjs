import fs from "node:fs";

const orders = fs.readFileSync("server/tracking/orders.ts", "utf8");
const page = fs.readFileSync("src/tracking/pages/TrackingOrdersPage.tsx", "utf8");

const expect = (label, condition) => {
  if (!condition) throw new Error(`FAIL: ${label}`);
  console.log(`PASS: ${label}`);
};

expect(
  "Stage completion no longer queries unfinished earlier stages",
  !orders.includes("previousPending") && !orders.includes("ps.sort_order<"),
);
expect(
  "Old sequential-stage rejection message is removed",
  !orders.includes("لا يمكن تنفيذ المرحلة قبل استكمال المراحل السابقة"),
);
expect(
  "Each stage still requires its own completion permission",
  orders.includes('const permissionCode = action === "complete_stage" ? `tracking.stage.${stageNo}.complete`'),
);
expect(
  "Cancelled and archived tracking orders remain protected",
  orders.includes("طلب البيع ملغي من NEXT ERP ولا يمكن تعديل مراحله")
    && orders.includes("الطلب مؤرشف ولا يمكن تعديل مراحله"),
);
expect(
  "Completing a selected stage still updates that exact stage for all order vehicles",
  orders.includes("ov.order_id=${row.order_id}::uuid and vs.stage_id=${stageId}::uuid and vs.status<>'completed'"),
);
expect(
  "Order status is still recalculated after every stage action",
  orders.includes("await recalculateTrackingOrder(row.order_id)"),
);
expect(
  "UI exposes completion independently for every unfinished permitted stage",
  page.includes("!done && hasPermission(user, `tracking.stage.${String(stage.sort_order).padStart(2, \"0\")}.complete`)")
    && !page.includes("previousPending"),
);

console.log("Tracking stages can now be completed independently without changing permissions, archive rules, or status recalculation.");
