/** BulkPublish adapter for approved TikTok organic content only.
 * Ads, Meta, Google, YouTube, Snapchat and CRM never call this adapter.
 * Mutations are not automatically retried: an ambiguous response must be verified.
 */
const ORIGIN = 'https://app.bulkpublish.com';
const clean = (value: unknown) => String(value ?? '').trim();
const item = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
const MAX_MEDIA_BYTES = 100 * 1024 * 1024;
const MAX_TIKTOK_PHOTOS = 35;

type FinalMedia = { fileName: string; mimeType: string; fileUrl: string };
type TikTokKind = 'video' | 'photo_slideshow';

function credentials() {
  const key = clean(process.env.BULKPUBLISH_API_KEY);
  const channelId = Number(process.env.BULKPUBLISH_TIKTOK_CHANNEL_ID || 2042);
  if (!key) throw new Error('لجدولة TikTok أضف BULKPUBLISH_API_KEY إلى متغيرات Vercel فقط');
  if (!Number.isSafeInteger(channelId) || channelId < 1) throw new Error('BULKPUBLISH_TIKTOK_CHANNEL_ID غير صالح');
  return { key, channelId };
}
export function bulkPublishConfigured() { return Boolean(clean(process.env.BULKPUBLISH_API_KEY)); }

async function request(method: 'GET' | 'POST' | 'PUT', path: string, key: string, body?: BodyInit, json = false, timeout = 40_000): Promise<Record<string, any>> {
  const response = await fetch(`${ORIGIN}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', ...(json ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body } : {}),
    redirect: 'manual',
    signal: AbortSignal.timeout(timeout),
  });
  const payload = item(await response.json().catch(() => ({})));
  if (!response.ok || payload.error || payload.success === false) {
    const error = item(payload.error);
    const explanation = clean(payload.message || error.message || payload.error).slice(0, 240);
    throw new Error(`BulkPublish رفض الطلب (${response.status})${explanation ? `: ${explanation}` : ''}`);
  }
  return payload;
}

/** Saudi wall-clock date/time mapped to a single UTC instant. Saudi Arabia has no DST. */
export function riyadhPublishIso(date: string, time: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new Error('حدد تاريخ ووقت نشر صحيحين بتوقيت السعودية');
  }
  const target = new Date(`${date}T${time}:00+03:00`);
  if (!Number.isFinite(target.getTime())) throw new Error('تاريخ النشر غير صالح');
  const observed = new Date(target.getTime() + 3 * 3600_000).toISOString().slice(0, 16);
  if (observed !== `${date}T${time}`) throw new Error('تاريخ النشر غير صالح');
  if (target.getTime() <= Date.now() + 120_000) throw new Error('اختر موعد TikTok بعد أكثر من دقيقتين من الوقت الحالي');
  return target.toISOString();
}

function mediaKind(files: FinalMedia[]): TikTokKind {
  if (!files.length || files.length > MAX_TIKTOK_PHOTOS) throw new Error('منشور TikTok يجب أن يحتوي على فيديو واحد أو من 1 إلى 35 صورة معتمدة');
  const video = (file: FinalMedia) => /\.(mp4|mov)$/i.test(file.fileName) || /^video\/(mp4|quicktime)$/i.test(file.mimeType);
  const photo = (file: FinalMedia) => /\.(jpe?g|png|webp)$/i.test(file.fileName) || /^image\/(jpeg|png|webp)$/i.test(file.mimeType);
  if (files.length === 1 && video(files[0])) return 'video';
  if (files.every(photo)) return 'photo_slideshow';
  throw new Error('TikTok يحتاج فيديو MP4/MOV واحدًا أو صور JPG/PNG/WebP فقط، دون خلط الصور والفيديو');
}

function validateContent(caption: string, hashtags: string): string {
  const text = [clean(caption), clean(hashtags)].filter(Boolean).join('\n\n');
  if (!text) throw new Error('الكابشن مطلوب لجدولة TikTok');
  if (Array.from(text).length > 2200) throw new Error('الكابشن والهاشتاج على TikTok لا يمكن أن يتجاوزا 2200 حرف');
  return text;
}

function mediaMime(bytes: Uint8Array, kind: TikTokKind): string {
  if (kind === 'video') {
    if (new TextDecoder().decode(bytes.subarray(4, 8)) !== 'ftyp') throw new Error('رابط الملف لم يرجع فيديو MP4/MOV صالحًا');
    return 'video/mp4';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((n, i) => bytes[i] === n)) return 'image/png';
  if (new TextDecoder().decode(bytes.subarray(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.subarray(8, 12)) === 'WEBP') return 'image/webp';
  throw new Error('رابط الصورة لم يرجع ملف JPG/PNG/WebP صالحًا');
}

async function uploadFinalMedia(key: string, file: FinalMedia, kind: TikTokKind): Promise<number> {
  let url: URL;
  try { url = new URL(file.fileUrl); }
  catch { throw new Error('رابط الملف المعتمد غير صالح'); }
  if (url.protocol !== 'https:') throw new Error('يجب جلب ملفات النشر من رابط HTTPS آمن');
  const response = await fetch(url, { signal: AbortSignal.timeout(90_000) });
  if (!response.ok) throw new Error('تعذر تنزيل الملف النهائي المعتمد من المخزن');
  const headerBytes = Number(response.headers.get('content-length')) || 0;
  if (headerBytes > MAX_MEDIA_BYTES) { await response.body?.cancel(); throw new Error('حجم الملف أكبر من حد الرفع المباشر (100 ميجابايت)'); }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > MAX_MEDIA_BYTES) throw new Error('الملف فارغ أو حجمه أكبر من 100 ميجابايت');
  const detectedType = mediaMime(bytes, kind);
  // Node's Blob constructor owns its bytes. Do not retain media buffers across uploads.
  const owned = new Uint8Array(bytes.length);
  owned.set(bytes);
  const form = new FormData();
  form.append('file', new Blob([owned], { type: detectedType === 'video/mp4' && /quicktime/i.test(file.mimeType) ? 'video/quicktime' : detectedType }), file.fileName);
  const upload = await request('POST', '/api/media', key, form, false, 90_000);
  const mediaId = Number(upload.id || item(upload.media).id || item(upload.data).id);
  if (!Number.isSafeInteger(mediaId) || mediaId < 1) throw new Error('BulkPublish استقبل الملف لكنه لم يرجع Media ID؛ راجعه قبل إعادة المحاولة');
  return mediaId;
}

function postData(result: Record<string, any>): Record<string, any> { return item(result.post || result.data || result); }

async function validatedTikTokChannel(key: string, channelId: number) {
  const reply = await request('GET', '/api/channels', key, undefined, false, 12_000);
  const channels = Array.isArray(reply.channels) ? reply.channels : Array.isArray(reply.data) ? reply.data : [];
  if (!channels.some((channel: any) => Number(channel.id) === channelId && clean(channel.platform).toLowerCase() === 'tiktok'
    && channel.isActive === true && channel.needsReconnect !== true && item(channel.capabilities).canPublishPosts !== false)) {
    throw new Error('قناة TikTok المختارة غير متصلة أو تحتاج إعادة ربط في BulkPublish');
  }
}

/** One scheduled POST, never an immediate publish. A success means scheduled, NOT posted. */
export async function scheduleBulkPublishTikTok(input: {
  date: string; time: string; caption: string; hashtags: string; files: FinalMedia[];
}) {
  const { key, channelId } = credentials();
  const scheduledAt = riyadhPublishIso(input.date, input.time);
  const content = validateContent(input.caption, input.hashtags);
  const kind = mediaKind(input.files);
  await validatedTikTokChannel(key, channelId);
  const mediaIds: number[] = [];
  for (const file of input.files) mediaIds.push(await uploadFinalMedia(key, file, kind));
  const result = await request('POST', '/api/posts', key, JSON.stringify({
    content,
    channels: [{ channelId, platform: 'tiktok' }],
    mediaFiles: mediaIds,
    postTypeOverrides: { tiktok: kind },
    status: 'scheduled', scheduledAt, timezone: 'Asia/Riyadh',
    platformSpecific: { tiktok: { privacyLevel: 'PUBLIC_TO_EVERYONE', brandOrganicToggle: true } },
  }), true, 35_000);
  const post = postData(result);
  const postId = Number(post.id);
  if (!Number.isSafeInteger(postId) || postId < 1) throw new Error('BulkPublish ربما استقبل المنشور لكنه لم يرجع Post ID؛ تحقق قبل إعادة الإرسال');
  if (clean(post.status) !== 'scheduled') throw new Error(`BulkPublish استقبل المنشور ${postId} لكنه لم يؤكد الجدولة؛ تحقق منه قبل إعادة الإرسال`);
  return { provider: 'bulkpublish', postId, mediaIds, mediaId: mediaIds[0], channelId,
    status: 'scheduled' as const, scheduledAt, timezone: 'Asia/Riyadh', caption: content, kind };
}

/** Read-only on demand; never call publish-immediately under any circumstances. */
export async function bulkPublishTikTokStatus(postId: number) {
  const { key } = credentials();
  if (!Number.isSafeInteger(postId) || postId < 1) throw new Error('رقم منشور TikTok غير صالح');
  const response = await request('GET', `/api/posts/${postId}`, key);
  const post = postData(response);
  const platform = Array.isArray(post.postPlatforms)
    ? post.postPlatforms.find((entry: any) => clean(entry.platform).toLowerCase() === 'tiktok') : undefined;
  const detail = item(platform);
  const status = clean(post.status).toLowerCase();
  const providerStatus = clean(detail.status).toLowerCase();
  return {
    status: status === 'published' || providerStatus === 'published' ? 'published' : status,
    providerStatus, publishedAt: clean(post.publishedAt),
    url: clean(detail.platformUrl || post.platformUrl || post.url), postId,
  };
}

/** Safe rescheduling: reuses the SAME provider Post and already uploaded media. */
export async function rescheduleBulkPublishTikTok(input: {
  postId: number; channelId: number; mediaIds: number[]; date: string; time: string; caption: string;
}) {
  const { key, channelId } = credentials();
  if (input.channelId !== channelId) throw new Error('قناة TikTok المجدولة لا تطابق القناة الحالية؛ تحقق من الربط أولًا');
  if (!Number.isSafeInteger(input.postId) || input.postId < 1 || !input.mediaIds.length || input.mediaIds.some(id => !Number.isSafeInteger(id) || id < 1)) {
    throw new Error('بيانات المنشور المجدول غير مكتملة؛ لا يمكن إعادة الجدولة بشكل آمن');
  }
  const scheduledAt = riyadhPublishIso(input.date, input.time);
  const current = postData(await request('GET', `/api/posts/${input.postId}`, key, undefined, false, 12_000));
  if (clean(current.status) !== 'scheduled') throw new Error('لم يعد المنشور مجدولًا لدى BulkPublish؛ تحقق من حالته قبل تغيير الموعد');
  const reply = postData(await request('PUT', `/api/posts/${input.postId}`, key, JSON.stringify({
    status: 'scheduled', scheduledAt, content: clean(input.caption),
    channels: [{ channelId, platform: 'tiktok' }], mediaFiles: input.mediaIds,
  }), true, 25_000));
  if (Number(reply.id) !== input.postId || clean(reply.status) !== 'scheduled') {
    throw new Error('BulkPublish لم يؤكد موعد الجدولة الجديد؛ تحقق من المنشور قبل تكرار العملية');
  }
  return { postId: input.postId, status: 'scheduled' as const, scheduledAt };
}
