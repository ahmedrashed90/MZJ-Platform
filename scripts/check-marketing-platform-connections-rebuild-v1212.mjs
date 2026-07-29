import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const files = {
  ui: read("src/marketing/pages/PlatformConnectionsPage.tsx"),
  css: read("src/marketing/marketing.css"),
  api: read("server/marketing/platform-connections.ts"),
  helper: read("server/_platform-connections.ts"),
  schema: read("server/_marketing-schema.ts"),
  migration: read("database/migrations/20260730_marketing_platform_connections_clean_rebuild.sql"),
  router: read("api/index.ts"),
  permissions: read("server/_api-permissions.ts"),
  env: read(".env.example"),
  marketing: read("server/marketing/index.ts"),
};

const checks = [];
function expect(name, condition) {
  checks.push({ name, ok: Boolean(condition) });
}
function has(text, ...needles) { return needles.every((needle) => text.includes(needle)); }
function lacks(text, ...needles) { return needles.every((needle) => !text.includes(needle)); }

expect("UI rebuilt for Meta, TikTok and YouTube", has(files.ui, 'meta: "Meta"', 'tiktok: "TikTok"', 'youtube: "YouTube"', "TiktokLogo", "YoutubeLogo", "إعادة الربط", "فصل الربط"));
expect("Manual token form removed", lacks(files.ui, "accessToken", "userAccessToken", "pageAccessToken", "نقل التوكنات", "حفظ الاتصال"));
expect("OAuth popup and callback message flow exist", has(files.ui, "window.open", "mzj-platform-connection", "addEventListener", "select_meta_page") && has(files.api, "postMessage"));
expect("Meta page selection is a first-class flow", has(files.ui, "availablePages", "marketing-meta-page-selector", "cancel_oauth_draft"));
expect("Connection validation and real disconnect actions exist", has(files.ui, 'action: "validate"', 'action: "disconnect"', "window.confirm"));
expect("Responsive rebuilt styles exist", has(files.css, ".marketing-connections-grid-rebuilt", ".marketing-meta-page-selector", ".marketing-connection-history", "@media (max-width: 760px)"));

expect("Dedicated API is routed", has(files.router, 'marketing/platform-connections", platformConnectionsHandler', "callback/meta", "callback/tiktok", "callback/youtube"));
expect("API has view/manage permission boundaries", has(files.permissions, "marketing/platform-connections", "marketing.platforms.view", "marketing.connections.manage"));
expect("Callback performs authenticated permission check", has(files.api, "getSessionUser", 'hasPermission(user, "marketing.connections.manage")'));
expect("API supports all clean actions", has(files.api, "start_oauth", "select_meta_page", "cancel_oauth_draft", "validate", "disconnect"));

expect("Tokens use AES-256-GCM with mandatory 32+ char key", has(files.helper, "aes-256-gcm", "MZJ_PLATFORM_TOKEN_ENCRYPTION_KEY", "secret.length < 32") && lacks(files.helper, "development-secret", "fallback-secret"));
expect("OAuth state is hashed, expiring and user-bound", has(files.helper, "stateHash", "platform_oauth_states", "expires_at>now()", "user_id=${user.id}::uuid"));
expect("Meta reconnect draft preserves current active connection", has(files.helper, "platform_connection_drafts", "savePendingMetaSelection", "cancelPlatformConnectionDraft"));
expect("No token is returned by public connection mapper", has(files.helper, "tokenStored:") && lacks(files.helper.slice(files.helper.indexOf("export function publicPlatformConnection"), files.helper.indexOf("function safePublicUrl")), "accessToken:"));
expect("Provider scopes are verified", has(files.helper, "assertScopes", 'assertScopes(scopes, metaScopes()', 'assertScopes(scopes, tiktokScopes()', 'assertScopes(parseScopes(token.scope), youtubeScopes()'));
expect("Meta, TikTok and Google revocation exists", has(files.helper, "revokeMeta", "revokeTikTok", "revokeGoogle", "/me/permissions", "/v2/oauth/revoke/", "oauth2.googleapis.com/revoke"));
expect("TikTok and YouTube refresh flow exists", has(files.helper, "refreshTikTokToken", "refreshYouTubeToken", "refresh_token"));
expect("Meta Graph default is v25.0", has(files.helper, '"v25.0"') && has(files.marketing, '"v25.0"'));

expect("PostgreSQL schema supports four platform assets", has(files.schema, "'facebook','instagram','tiktok','youtube'", "platform_oauth_states", "platform_connection_drafts", "platform_connection_events"));
expect("Migration performs clean legacy cutover", has(files.migration, "reauthorization_required", "access_token_encrypted=null", "refresh_token_encrypted=null", "platform_connection_drafts"));
expect("Legacy manual connection actions removed from backend", lacks(files.marketing, "save_connection", "disconnect_connection", "migrate_connection_env"));
expect("Old manual token environment variables removed", lacks(files.env, "META_ACCESS_TOKEN=", "META_USER_ACCESS_TOKEN=", "META_PAGE_ACCESS_TOKEN=", "META_SYSTEM_PAGE_TOKEN="));
expect("All OAuth environment variables are documented", has(files.env, "META_APP_ID=", "TIKTOK_CLIENT_KEY=", "YOUTUBE_CLIENT_ID=", "MZJ_PLATFORM_TOKEN_ENCRYPTION_KEY=", "META_REDIRECT_URI=", "TIKTOK_REDIRECT_URI=", "YOUTUBE_REDIRECT_URI="));

const failed = checks.filter((check) => !check.ok);
for (const check of checks) console.log(`${check.ok ? "PASS" : "FAIL"} - ${check.name}`);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed.`);
if (failed.length) process.exit(1);
