import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const checks = [];
const check = (label, condition) => {
  if (!condition) throw new Error(`FAIL: ${label}`);
  checks.push(label);
  console.log(`PASS: ${label}`);
};

const schema = read('server/_marketing-schema.ts');
const migration = read('database/migrations/20260731_youtube_publish_settings.sql');
const shared = read('shared/youtube-publishing.ts');
const connections = read('server/_platform-connections.ts');
const connectionsApi = read('server/marketing/platform-connections.ts');
const publishApi = read('server/marketing/index.ts');
const connectionUi = read('src/marketing/pages/PlatformConnectionsPage.tsx');
const publishUi = read('src/marketing/pages/PublishPrepPage.tsx');
const css = read('src/marketing/marketing.css');

check('YouTube defaults have one canonical shared model', shared.includes('YOUTUBE_PUBLISH_DEFAULTS') && shared.includes('normalizeYouTubePublishSettings') && shared.includes('normalizeYouTubePublishOptions'));
check('platform publishing defaults are stored in PostgreSQL', schema.includes('marketing.platform_publish_settings') && migration.includes('marketing.platform_publish_settings'));
check('per-task YouTube options are stored on publish schedule', schema.includes('publish_options jsonb') && publishApi.includes("publish_options->'youtube'") && publishApi.includes("{youtube:youtubeOptions}"));
check('legacy privacy values are no longer treated as YouTube post types', schema.includes("('فيديو',1920,1080),('Shorts',1080,1920)") && schema.includes("'عام','غير مدرج','خاص','public','unlisted','private'"));
check('YouTube settings API supports load and save', connectionsApi.includes('youtube_publish_options') && connectionsApi.includes('save_youtube_publish_settings'));
check('YouTube category and playlist choices come from the connected channel', connections.includes('/youtube/v3/videoCategories') && connections.includes('/youtube/v3/playlists') && connections.includes('mine'));
check('expired YouTube access tokens are refreshed before settings options load', connections.includes('getYouTubeAccessToken') && connections.includes('refreshYouTubeToken') && connections.includes('tokenNearExpiry'));
check('YouTube settings button and defaults modal exist', connectionUi.includes('إعدادات النشر') && connectionUi.includes('إعدادات نشر YouTube') && connectionUi.includes('حفظ إعدادات YouTube'));
check('YouTube task override fields exist in publish prep', publishUi.includes('إعدادات فيديو YouTube') && publishUi.includes('عنوان الفيديو') && publishUi.includes('قائمة التشغيل') && publishUi.includes('مخصص للأطفال'));
check('YouTube title is required only when YouTube is selected', publishUi.includes('includesYouTube(row)') && publishUi.includes('عنوان YouTube') && publishApi.includes('if(youtubeSelected)'));
check('YouTube settings have dedicated responsive styles', css.includes('.marketing-youtube-settings-modal') && css.includes('.marketing-youtube-publish-section') && css.includes('.marketing-youtube-task-toggles'));
check('YouTube settings migration is transactional', migration.trim().startsWith('begin;') && migration.trim().endsWith('commit;'));

console.log(`YouTube publishing settings checks: ${checks.length}/${checks.length} passed`);
