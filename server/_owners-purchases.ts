import { clean } from "./_crm-utils.js";
import { getSql } from "./_db.js";
import { ensureTrackingSchema } from "./_tracking-schema.js";

function isUuid(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean(value));
}

function jsonArray(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function vehicleLabelFromRow(row: any) {
  const vehicles = jsonArray(row?.purchase_vehicles)
    .map((vehicle: any) => ({
      name: clean(vehicle?.name || vehicle?.car_name),
      qty: Math.max(1, Number(vehicle?.qty || 1)),
      vin: clean(vehicle?.vin),
    }))
    .filter((vehicle: any) => vehicle.name);

  if (vehicles.length) {
    const labels = vehicles.map((vehicle: any) => vehicle.qty > 1 ? `${vehicle.name} × ${vehicle.qty}` : vehicle.name);
    return {
      label: labels.join(" + "),
      vehicles,
    };
  }

  const fallbackName = [clean(row?.sale_car_name), clean(row?.sale_car_category)].filter(Boolean).join(" - ");
  const fallbackQty = Math.max(1, Number(row?.sale_quantity || 1));
  if (!fallbackName) return { label: "", vehicles: [] as any[] };
  return {
    label: fallbackQty > 1 ? `${fallbackName} × ${fallbackQty}` : fallbackName,
    vehicles: [{ name: fallbackName, qty: fallbackQty, vin: "" }],
  };
}

export async function ownerPurchaseLedger(memberIdValue: unknown) {
  const memberId = clean(memberIdValue);
  if (!isUuid(memberId)) return [];
  await ensureTrackingSchema();
  const sql = getSql();
  const rows = await sql<any[]>`
    select
      ledger.id::text,
      ledger.points,
      ledger.event_type,
      ledger.description,
      ledger.metadata,
      ledger.created_at,
      sale.id::text as sale_id,
      sale.source_type as sale_source_type,
      sale.source_reference as sale_order_reference,
      sale.sale_at,
      sale.quantity as sale_quantity,
      sale.car_name as sale_car_name,
      sale.car_category as sale_car_category,
      vehicle_rows.vehicles as purchase_vehicles
    from owners.points_ledger ledger
    left join lateral (
      select st.*
      from crm.sales_transactions st
      where ledger.event_type='purchase'
        and coalesce(st.is_cancelled,false)=false
        and (
          (
            st.id = case
              when coalesce(ledger.metadata->>'saleId','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
                then (ledger.metadata->>'saleId')::uuid
              else null::uuid
            end
          )
          or (
            nullif(ledger.metadata->>'saleOrderReference','') is not null
            and st.source_reference=ledger.metadata->>'saleOrderReference'
          )
        )
      order by
        case when coalesce(ledger.metadata->>'saleId','')=st.id::text then 0 else 1 end,
        st.sale_at desc,st.created_at desc,st.id desc
      limit 1
    ) sale on true
    left join lateral (
      select o.id
      from tracking.orders o
      where nullif(coalesce(sale.source_reference,ledger.metadata->>'saleOrderReference'), '') is not null
        and o.sales_order_no=coalesce(sale.source_reference,ledger.metadata->>'saleOrderReference')
        and coalesce(o.is_cancelled,false)=false
      order by o.updated_at desc,o.created_at desc,o.id desc
      limit 1
    ) tracking_order on true
    left join lateral (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'name',coalesce(nullif(ov.car_name,''),concat_ws(' ',nullif(ov.item_type,''),nullif(ov.item_category,''),nullif(ov.item_model,''))),
            'qty',greatest(coalesce(ov.qty,1),1),
            'vin',ov.vin
          )
          order by coalesce(ov.item_no,''),ov.created_at,ov.id
        ) filter(where coalesce(nullif(ov.car_name,''),nullif(ov.item_type,''),nullif(ov.item_category,''),nullif(ov.item_model,'')) is not null),
        '[]'::jsonb
      ) as vehicles
      from tracking.order_vehicles ov
      where ov.order_id=tracking_order.id
    ) vehicle_rows on true
    where ledger.member_id=${memberId}::uuid
    order by ledger.created_at desc,ledger.id desc
    limit 100
  `;

  return rows.map((row: any) => {
    if (String(row.event_type || "") !== "purchase") return row;
    const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata : {};
    const salesOrderReference = clean(row.sale_order_reference || metadata.saleOrderReference);
    const vehicle = vehicleLabelFromRow(row);
    return {
      ...row,
      purchase: {
        saleId: clean(row.sale_id || metadata.saleId) || null,
        salesOrderReference: salesOrderReference || null,
        saleAt: row.sale_at || metadata.saleAt || row.created_at || null,
        quantity: Math.max(1, Number(row.sale_quantity || metadata.saleQuantity || vehicle.vehicles.reduce((total: number, item: any) => total + Number(item.qty || 1), 0) || 1)),
        vehicleLabel: vehicle.label || null,
        vehicles: vehicle.vehicles,
        invoiceEligible: Boolean(salesOrderReference),
      },
    };
  });
}

export async function ownerPurchaseSummary(memberIdValue: unknown) {
  const memberId = clean(memberIdValue);
  if (!isUuid(memberId)) return { purchaseCount: 0, firstSaleAt: null, lastSaleAt: null };
  const sql = getSql();
  const [summary] = await sql<any[]>`
    select
      count(distinct sale.id)::int as purchase_count,
      min(sale.sale_at) as first_sale_at,
      max(sale.sale_at) as last_sale_at
    from owners.members member
    join crm.sales_transactions sale on coalesce(sale.is_cancelled,false)=false
    join crm.leads lead on lead.id=sale.lead_id and lead.is_deleted=false
    where member.id=${memberId}::uuid
      and (
        (member.source_sale_id is not null and sale.id=member.source_sale_id)
        or (member.crm_lead_id is not null and sale.lead_id=member.crm_lead_id)
        or (
          nullif(member.phone_normalized,'') is not null
          and nullif(lead.phone_normalized,'') is not null
          and lead.phone_normalized=member.phone_normalized
        )
      )
  `;
  return {
    purchaseCount: Number(summary?.purchase_count || 0),
    firstSaleAt: summary?.first_sale_at || null,
    lastSaleAt: summary?.last_sale_at || null,
  };
}

export async function ownerOwnsSalesOrder(memberIdValue: unknown, salesOrderValue: unknown) {
  const memberId = clean(memberIdValue);
  const salesOrder = clean(salesOrderValue);
  if (!isUuid(memberId) || !salesOrder) return false;
  const sql = getSql();
  const [row] = await sql<any[]>`
    select member.id::text
    from owners.members member
    where member.id=${memberId}::uuid
      and member.status='active'
      and (
        exists (
          select 1
          from crm.sales_transactions sale
          join crm.leads lead on lead.id=sale.lead_id and lead.is_deleted=false
          where sale.source_reference=${salesOrder}
            and coalesce(sale.is_cancelled,false)=false
            and (
              (member.source_sale_id is not null and sale.id=member.source_sale_id)
              or (member.crm_lead_id is not null and sale.lead_id=member.crm_lead_id)
              or (
                nullif(member.phone_normalized,'') is not null
                and nullif(lead.phone_normalized,'') is not null
                and lead.phone_normalized=member.phone_normalized
              )
            )
        )
        or exists (
          select 1
          from owners.points_ledger ledger
          where ledger.member_id=member.id
            and ledger.event_type='purchase'
            and nullif(ledger.metadata->>'saleOrderReference','')=${salesOrder}
        )
      )
    limit 1
  `;
  return Boolean(row?.id);
}
