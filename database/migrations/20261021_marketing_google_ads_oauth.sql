-- Add Google Ads to existing provider lists without touching YouTube or Meta tokens.
begin;
alter table marketing.platform_connections drop constraint if exists platform_connections_platform_check;
alter table marketing.platform_connections add constraint platform_connections_platform_check
  check(platform in ('facebook','instagram','tiktok','youtube','google_ads'));
alter table marketing.platform_oauth_states drop constraint if exists platform_oauth_states_provider_check;
alter table marketing.platform_oauth_states add constraint platform_oauth_states_provider_check
  check(provider in ('meta','tiktok','youtube','google_ads'));
alter table marketing.platform_connection_events drop constraint if exists platform_connection_events_provider_check;
alter table marketing.platform_connection_events add constraint platform_connection_events_provider_check
  check(provider in ('meta','tiktok','youtube','google_ads'));
alter table marketing.platform_connection_drafts drop constraint if exists platform_connection_drafts_provider_check;
alter table marketing.platform_connection_drafts add constraint platform_connection_drafts_provider_check
  check(provider in ('meta','tiktok','youtube','google_ads'));
update marketing.schema_state set version=greatest(version,3),updated_at=now() where id=1;
commit;
