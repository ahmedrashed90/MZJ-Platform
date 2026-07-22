-- MZJ CRM Conversation Automation v1.18.1 post-deployment verification
select
  to_regclass('crm.conversation_automation_settings') is not null as settings_ready,
  to_regclass('crm.conversation_automation_platforms') is not null as platforms_ready,
  to_regclass('crm.conversation_automation_start_messages') is not null as start_messages_ready,
  to_regclass('crm.conversation_automation_flows') is not null as flows_ready,
  to_regclass('crm.conversation_automation_flow_steps') is not null as steps_ready,
  to_regclass('crm.conversation_automation_sessions') is not null as sessions_ready,
  to_regclass('crm.conversation_automation_inbound_events') is not null as inbound_events_ready,
  to_regclass('crm.conversation_automation_outbound_messages') is not null as outbound_messages_ready,
  to_regclass('crm.conversation_automation_final_actions') is not null as final_actions_ready;

select
  (select count(*) from crm.conversation_automation_start_messages where is_active) as active_start_messages,
  (select count(*) from crm.conversation_automation_flows where is_active) as active_flows,
  (select count(*) from crm.conversation_automation_flow_steps where is_active) as active_steps,
  (select count(*) from crm.conversation_automation_flow_aliases) as accepted_replies,
  (select automation_enabled from crm.conversation_automation_settings where id='default') as automation_enabled,
  (select trigger_policy from crm.conversation_automation_settings where id='default') as trigger_policy;

select message_key,message_text,is_active,sort_order
from crm.conversation_automation_start_messages
order by sort_order,id;

select flow_code,display_name,service_key,department_code,branch_policy,branch_code,final_action,final_message,is_active,sort_order
from crm.conversation_automation_flows
order by sort_order,id;

select f.flow_code,a.alias_type,a.alias_value,a.normalized_value
from crm.conversation_automation_flow_aliases a
join crm.conversation_automation_flows f on f.id=a.flow_id
order by f.sort_order,a.alias_type,a.normalized_value;

select f.flow_code,s.step_key,s.step_name,s.prompt_text,s.step_type,s.customer_field,s.validation_rules,s.validation_error,s.max_attempts,s.sort_order
from crm.conversation_automation_flow_steps s
join crm.conversation_automation_flows f on f.id=s.flow_id
order by f.sort_order,s.sort_order,s.id;

select column_name
from information_schema.columns
where table_schema='crm' and table_name='automation_settings'
order by ordinal_position;
