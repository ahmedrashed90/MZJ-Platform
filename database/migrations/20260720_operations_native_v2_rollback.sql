-- MZJ Platform Operations Native V2 - rollback guidance
-- This release intentionally does not provide a destructive automatic rollback.
-- It adds operational history, audit, source identity, and permissions that must not be dropped blindly.
-- Safe rollback procedure:
-- 1) stop writes/deployment;
-- 2) restore the verified pre-migration PostgreSQL snapshot to a separate database;
-- 3) validate counts and VIN/source identities;
-- 4) switch DATABASE_URL only after approval;
-- 5) retain this migrated database read-only until reconciliation is complete.
--
-- The only non-data rollback below disables the newly introduced permissions for non-system roles.
-- It does not remove tables, columns, history, tracking audits, or vehicles.
\set ON_ERROR_STOP on
BEGIN;
delete from core.role_permissions rp
using core.roles r, core.permissions p
where rp.role_id=r.id and rp.permission_id=p.id
  and r.code in ('operations_manager','operations_user','finance_manager')
  and p.code in (
    'operations.view','operations.vehicle.create','operations.vehicle.edit','operations.vehicle.delete','operations.vehicle.archive',
    'operations.vehicle.import','operations.vehicle.export','operations.movement.create','operations.movement.view',
    'operations.transfer.create','operations.transfer.view','operations.transfer.receive_order','operations.transfer.send_vehicle',
    'operations.transfer.receive_vehicle','operations.transfer.complete','operations.transfer.cancel','operations.transfer.delete',
    'operations.approval.view','operations.approval.financial','operations.approval.administrative','operations.settings.manage',
    'tracking.orders.delete'
  );
COMMIT;
