import { getSql } from "./_db.js";

/**
 * Canonical CRM customer visibility for period-based dashboards and reports.
 * Existing customers remain visible in every status except "غير مؤهل";
 * that status is included only when its most recent transition falls in the
 * selected Riyadh-local date interval. A missing transition uses registration
 * as the legacy fallback, exactly as the CRM dashboard has done historically.
 *
 * The SQL fragment expects the CRM lead alias to be `l`, including when `l`
 * is an effective-lead report CTE. This function is read-only: it does not
 * update statuses, ownership, or historical transactions.
 */
export function crmVisibleCustomerCohortSql(
  sql: ReturnType<typeof getSql>,
  from: string | null,
  to: string | null,
) {
  const exclusionDate = sql`
    (coalesce(
      (select max(e.created_at) from crm.lead_events e
       where e.lead_id=l.id and e.new_status='غير مؤهل'
         and e.event_type in ('status_change','department_transfer','manual_status_change')),
      l.registered_at, l.created_at
    ) at time zone 'Asia/Riyadh')::date
  `;
  return sql`
    (
      l.status_label is distinct from 'غير مؤهل'
      or (
        (${from}::date is null or ${exclusionDate} >= ${from}::date)
        and (${to}::date is null or ${exclusionDate} <= ${to}::date)
      )
    )
  `;
}
