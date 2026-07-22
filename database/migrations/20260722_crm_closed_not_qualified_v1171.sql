begin;

update crm.automation_settings
set closed_statuses=jsonb_set(
      jsonb_set(coalesce(closed_statuses,'{}'::jsonb),'{cash}','["تم البيع","غير مؤهل"]'::jsonb,true),
      '{finance}','["تم البيع","غير مؤهل"]'::jsonb,true
    ),
    updated_at=now()
where id='default';

update crm.service_requests request
set request_state='closed',
    status_label=lead.status_label,
    closed_at=coalesce(request.closed_at,now()),
    closure_reason=coalesce(nullif(request.closure_reason,''),lead.status_label),
    updated_at=now()
from crm.leads lead
where lead.current_request_id=request.id
  and request.request_state='open'
  and lead.department_code in ('cash_sales','finance_sales','call_center')
  and lead.status_label='غير مؤهل';

update crm.conversations conversation
set service_request_id=null,classification_state='closed',service_selection_sent_at=null,closed_at=coalesce(conversation.closed_at,now()),updated_at=now()
from crm.leads lead
where lead.current_request_id=conversation.service_request_id
  and lead.department_code in ('cash_sales','finance_sales','call_center')
  and lead.status_label='غير مؤهل';

update crm.leads
set current_request_id=null,updated_at=now()
where current_request_id is not null
  and department_code in ('cash_sales','finance_sales','call_center')
  and status_label='غير مؤهل';

insert into core.schema_migrations(version)
values('crm-closed-not-qualified-v1.17.1')
on conflict(version) do nothing;

commit;
