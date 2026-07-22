-- MZJ CRM Automation v1.18.0 post-deployment verification (read-only)

select version, applied_at
from core.schema_migrations
where version = 'crm-conversation-automation-v1.18.0';

select table_name
from information_schema.tables
where table_schema = 'crm'
  and table_name in (
    'automation_platforms','automation_start_messages','automation_flows','automation_flow_aliases',
    'automation_flow_steps','automation_sessions','automation_inbound_events','automation_answers',
    'automation_outbound_messages','automation_final_actions'
  )
order by table_name;

select automation_name, automation_enabled, trigger_policy, custom_interval_value, custom_interval_unit
from crm.automation_settings
where id = 'default';

select message_key, message_text, is_active, sort_order
from crm.automation_start_messages
order by sort_order, id;

select f.flow_code, f.display_name, f.service_key, f.department_code, f.branch_policy, f.branch_code,
       f.final_action, f.final_message, f.is_active, f.sort_order,
       count(distinct a.id) as accepted_reply_count,
       count(distinct s.id) filter (where s.is_active) as active_step_count
from crm.automation_flows f
left join crm.automation_flow_aliases a on a.flow_id = f.id
left join crm.automation_flow_steps s on s.flow_id = f.id
group by f.id
order by f.sort_order, f.flow_code;

select f.flow_code, s.step_key, s.step_name, s.prompt_text, s.step_type, s.customer_field,
       s.validation_rules, s.validation_error, s.max_attempts, s.is_active, s.sort_order
from crm.automation_flow_steps s
join crm.automation_flows f on f.id = s.flow_id
order by f.sort_order, s.sort_order, s.id;

-- Expected: zero rows. There must never be two active sessions for one contact or conversation.
select contact_id, count(*) as active_sessions
from crm.automation_sessions
where status in ('awaiting_service','awaiting_answer')
group by contact_id
having count(*) > 1;

select conversation_id, count(*) as active_sessions
from crm.automation_sessions
where status in ('awaiting_service','awaiting_answer')
group by conversation_id
having count(*) > 1;

-- Expected: zero rows. Enabled automation platforms must have a matching active worker and text send route.
select p.platform_code, p.worker_code, p.is_enabled, e.is_active as worker_is_active,
       coalesce(nullif(e.text_send_url,''), nullif(e.send_url,'')) as worker_send_url
from crm.automation_platforms p
left join crm.integration_endpoints e on e.source_code = p.worker_code
where p.is_enabled
  and (p.worker_code is null or p.worker_code <> p.platform_code or e.source_code is null
       or e.is_active is not true
       or coalesce(nullif(e.text_send_url,''), nullif(e.send_url,'')) is null);

-- Operational overview after live testing.
select status, count(*) from crm.automation_sessions group by status order by status;
select status, count(*) from crm.automation_inbound_events group by status order by status;
select status, count(*) from crm.automation_outbound_messages group by status order by status;
select status, count(*) from crm.automation_final_actions group by status order by status;
