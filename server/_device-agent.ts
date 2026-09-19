import type { VercelRequest } from "@vercel/node";
import {
  createHash,
  createPublicKey,
  createVerify,
  randomBytes,
} from "node:crypto";
import { getSql } from "./_db.js";
import { requestIp } from "./_auth.js";
import { deviceAgentSchemaExists, ensureDeviceAgentSchema } from "./_device-agent-schema.js";

const CHALLENGE_MINUTES = 2;
const DEFAULT_PLATFORM_ORIGIN = "https://mzj-platform.vercel.app";

function clean(value: unknown, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizePem(value: string) {
  return value.replace(/\r\n/g, "\n").trim();
}

function platformOrigin(request?: VercelRequest) {
  const configured = clean(process.env.MZJ_PLATFORM_ORIGIN, 500).replace(/\/+$/, "");
  if (configured) return configured;
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production" && request) {
    const host = clean(request.headers["x-forwarded-host"] || request.headers.host, 300);
    if (host) return `https://${host}`;
  }
  return DEFAULT_PLATFORM_ORIGIN;
}

export function deviceSignaturePayload(challengeId: string, challenge: string) {
  return `MZJ-DEVICE-LOGIN|v1|${challengeId}|${challenge}`;
}

export async function isDeviceVerificationRequired(userId: string) {
  const sql = getSql();
  const [exists] = await sql<{ exists: boolean }[]>`
    select to_regclass('core.user_device_policies') is not null as exists
  `;
  if (!exists?.exists) return false;
  const [policy] = await sql<{ verification_required: boolean }[]>`
    select verification_required from core.user_device_policies where user_id=${userId}::uuid
  `;
  return Boolean(policy?.verification_required);
}

export async function createDeviceLoginChallenge(input: {
  userId: string;
  attendanceCheckIn: boolean;
  request: VercelRequest;
}) {
  await ensureDeviceAgentSchema();
  const sql = getSql();
  const challenge = randomBytes(32).toString("base64url");
  const pollToken = randomBytes(32).toString("base64url");
  const [row] = await sql<{ id: string; expires_at: string }[]>`
    insert into core.device_login_challenges(
      user_id,challenge,poll_token_hash,attendance_check_in,expires_at,ip_address,user_agent
    ) values (
      ${input.userId}::uuid,${challenge},${sha256(pollToken)},${input.attendanceCheckIn},
      now()+${CHALLENGE_MINUTES}*interval '1 minute',${requestIp(input.request)},
      ${clean(input.request.headers["user-agent"], 500) || null}
    )
    returning id::text,expires_at::text
  `;
  const origin = platformOrigin(input.request);
  const params = new URLSearchParams({
    challengeId: row.id,
    challenge,
    server: origin,
  });
  return {
    challengeId: row.id,
    challenge,
    pollToken,
    expiresAt: row.expires_at,
    agentUrl: `mzjagent://verify?${params.toString()}`,
    installerUrl: "/downloads/MZJ-Device-Agent-Setup.exe",
  };
}

export async function getDeviceChallengeStatus(challengeId: string, pollToken: string) {
  if (!challengeId || !pollToken) return { status: "invalid" as const };
  if (!(await deviceAgentSchemaExists())) return { status: "invalid" as const };
  const sql = getSql();
  const [row] = await sql<{
    proof_verified_at: string | null;
    device_id: string | null;
    consumed_at: string | null;
    expires_at: string;
    device_status: string | null;
    device_name: string | null;
  }[]>`
    select c.proof_verified_at::text,c.device_id,c.consumed_at::text,c.expires_at::text,
           d.status as device_status,d.device_name
    from core.device_login_challenges c
    left join core.user_devices d on d.user_id=c.user_id and d.device_id=c.device_id
    where c.id=${challengeId}::uuid and c.poll_token_hash=${sha256(pollToken)}
    limit 1
  `.catch(() => [] as any);
  if (!row) return { status: "invalid" as const };
  if (row.consumed_at) return { status: "consumed" as const };
  if (new Date(row.expires_at).getTime() <= Date.now()) return { status: "expired" as const };
  if (!row.proof_verified_at || !row.device_id) return { status: "waiting_agent" as const };
  if (row.device_status === "approved") return { status: "approved" as const, deviceName: row.device_name || row.device_id };
  if (row.device_status === "revoked") return { status: "revoked" as const, deviceName: row.device_name || row.device_id };
  return { status: "pending_approval" as const, deviceName: row.device_name || row.device_id };
}

export async function verifyDeviceChallengeProof(request: VercelRequest, body: Record<string, any>) {
  await ensureDeviceAgentSchema();
  const challengeId = clean(body.challengeId, 80);
  const deviceId = clean(body.deviceId, 120);
  const deviceName = clean(body.deviceName, 200) || "Windows Device";
  const platform = clean(body.platform, 50).toLowerCase() || "windows";
  const agentVersion = clean(body.agentVersion, 50) || null;
  const fingerprintHash = clean(body.fingerprintHash, 128).toLowerCase() || null;
  const suppliedPublicKey = normalizePem(clean(body.publicKeyPem, 6000));
  const signatureText = clean(body.signature, 4000);

  if (!/^[0-9a-f-]{36}$/i.test(challengeId) || !/^MZJ-WIN-[A-Z0-9-]{8,80}$/i.test(deviceId)) {
    throw new Error("INVALID_DEVICE_PROOF");
  }
  if (platform !== "windows") throw new Error("UNSUPPORTED_DEVICE_PLATFORM");
  if (fingerprintHash && !/^[0-9a-f]{64}$/.test(fingerprintHash)) throw new Error("INVALID_DEVICE_FINGERPRINT");
  if (!signatureText) throw new Error("INVALID_DEVICE_SIGNATURE");

  const sql = getSql();
  const [challengeRow] = await sql<{
    id: string;
    user_id: string;
    challenge: string;
    expires_at: string;
    consumed_at: string | null;
  }[]>`
    select id::text,user_id::text,challenge,expires_at::text,consumed_at::text
    from core.device_login_challenges
    where id=${challengeId}::uuid
    limit 1
  `;
  if (!challengeRow || challengeRow.consumed_at || new Date(challengeRow.expires_at).getTime() <= Date.now()) {
    throw new Error("DEVICE_CHALLENGE_EXPIRED");
  }

  const [existing] = await sql<{
    id: string;
    public_key_pem: string;
    status: "pending" | "approved" | "revoked";
  }[]>`
    select id::text,public_key_pem,status
    from core.user_devices
    where user_id=${challengeRow.user_id}::uuid and device_id=${deviceId}
    limit 1
  `;

  const publicKeyPem = existing?.public_key_pem ? normalizePem(existing.public_key_pem) : suppliedPublicKey;
  if (!publicKeyPem) throw new Error("DEVICE_PUBLIC_KEY_REQUIRED");
  if (existing && suppliedPublicKey && normalizePem(existing.public_key_pem) !== suppliedPublicKey) {
    throw new Error("DEVICE_KEY_MISMATCH");
  }

  let publicKey;
  try {
    publicKey = createPublicKey(publicKeyPem);
  } catch {
    throw new Error("INVALID_DEVICE_PUBLIC_KEY");
  }
  if (publicKey.asymmetricKeyType !== "ec" || publicKey.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error("INVALID_DEVICE_PUBLIC_KEY");
  const publicDer = publicKey.export({ type: "spki", format: "der" });
  const derivedDeviceId = `MZJ-WIN-${createHash("sha256").update(publicDer).digest("hex").slice(0, 20).toUpperCase()}`;
  if (deviceId.toUpperCase() !== derivedDeviceId) throw new Error("DEVICE_ID_KEY_MISMATCH");

  const signature = Buffer.from(signatureText, "base64");
  const verifier = createVerify("SHA256");
  verifier.update(deviceSignaturePayload(challengeId, challengeRow.challenge));
  verifier.end();
  if (!verifier.verify(publicKey, signature)) throw new Error("DEVICE_SIGNATURE_REJECTED");

  let deviceStatus: "pending" | "approved" | "revoked" = existing?.status || "pending";
  if (!existing) {
    const [created] = await sql<{ status: "pending" | "approved" | "revoked" }[]>`
      insert into core.user_devices(
        user_id,device_id,device_name,platform,agent_version,public_key_pem,fingerprint_hash,
        status,last_ip,last_user_agent,created_at,updated_at
      ) values (
        ${challengeRow.user_id}::uuid,${deviceId},${deviceName},${platform},${agentVersion},${publicKeyPem},${fingerprintHash},
        'pending',${requestIp(request)},${clean(request.headers["user-agent"], 500) || null},now(),now()
      )
      returning status
    `;
    deviceStatus = created.status;
  } else {
    await sql`
      update core.user_devices
      set device_name=${deviceName},agent_version=${agentVersion},fingerprint_hash=coalesce(${fingerprintHash},fingerprint_hash),
          last_ip=${requestIp(request)},last_user_agent=${clean(request.headers["user-agent"], 500) || null},updated_at=now()
      where id=${existing.id}::uuid
    `;
  }

  await sql`
    update core.device_login_challenges
    set device_id=${deviceId},proof_verified_at=now()
    where id=${challengeId}::uuid and consumed_at is null
  `;
  if (deviceStatus === "approved") {
    await sql`
      update core.user_devices
      set last_verified_at=now(),updated_at=now()
      where user_id=${challengeRow.user_id}::uuid and device_id=${deviceId}
    `;
  }
  return { status: deviceStatus, deviceId, deviceName };
}

export async function consumeApprovedDeviceChallenge(challengeId: string, pollToken: string) {
  await ensureDeviceAgentSchema();
  const sql = getSql();
  const [row] = await sql<{
    user_id: string;
    attendance_check_in: boolean;
    device_id: string;
  }[]>`
    update core.device_login_challenges c
    set consumed_at=now()
    from core.user_devices d
    where c.id=${challengeId}::uuid
      and c.poll_token_hash=${sha256(pollToken)}
      and c.consumed_at is null
      and c.expires_at>now()
      and c.proof_verified_at is not null
      and c.device_id is not null
      and d.user_id=c.user_id
      and d.device_id=c.device_id
      and d.status='approved'
    returning c.user_id::text,c.attendance_check_in,c.device_id
  `;
  return row || null;
}

export async function adminDeviceSnapshot() {
  await ensureDeviceAgentSchema();
  const sql = getSql();
  const [policies, devices] = await Promise.all([
    sql<any[]>`select user_id::text,verification_required from core.user_device_policies`,
    sql<any[]>`
      select id::text,user_id::text,device_id,device_name,platform,agent_version,status,
             approved_at::text,revoked_at::text,last_verified_at::text,created_at::text
      from core.user_devices
      order by created_at desc
    `,
  ]);
  const policyMap = new Map(policies.map((row) => [String(row.user_id), Boolean(row.verification_required)]));
  const deviceMap = new Map<string, any[]>();
  for (const device of devices) {
    const key = String(device.user_id);
    if (!deviceMap.has(key)) deviceMap.set(key, []);
    deviceMap.get(key)!.push({
      id: device.id,
      deviceId: device.device_id,
      deviceName: device.device_name || device.device_id,
      platform: device.platform,
      agentVersion: device.agent_version,
      status: device.status,
      approvedAt: device.approved_at,
      revokedAt: device.revoked_at,
      lastVerifiedAt: device.last_verified_at,
      createdAt: device.created_at,
    });
  }
  return { policyMap, deviceMap };
}

export async function setUserDevicePolicy(userIds: string[], required: boolean, adminId: string) {
  await ensureDeviceAgentSchema();
  const sql = getSql();
  for (const userId of userIds) {
    await sql`
      insert into core.user_device_policies(user_id,verification_required,updated_by,updated_at)
      values(${userId}::uuid,${required},${adminId}::uuid,now())
      on conflict(user_id) do update
      set verification_required=excluded.verification_required,updated_by=excluded.updated_by,updated_at=now()
    `;
    await sql`delete from core.sessions where user_id=${userId}::uuid`;
  }
  return { ok: true, count: userIds.length, required };
}

export async function approveUserDevice(deviceRecordId: string, adminId: string) {
  await ensureDeviceAgentSchema();
  const sql = getSql();
  return sql.begin(async (tx) => {
    const [target] = await tx<{ user_id: string; device_id: string }[]>`
      select user_id::text,device_id
      from core.user_devices
      where id=${deviceRecordId}::uuid
      for update
    `;
    if (!target) throw new Error("DEVICE_NOT_FOUND");

    await tx`
      update core.user_devices
      set status='revoked',revoked_by=${adminId}::uuid,revoked_at=now(),updated_at=now()
      where user_id=${target.user_id}::uuid and id<>${deviceRecordId}::uuid and status='approved'
    `;
    const [row] = await tx<{ user_id: string; device_id: string }[]>`
      update core.user_devices
      set status='approved',approved_by=${adminId}::uuid,approved_at=now(),revoked_by=null,revoked_at=null,updated_at=now()
      where id=${deviceRecordId}::uuid
      returning user_id::text,device_id
    `;
    await tx`delete from core.sessions where user_id=${target.user_id}::uuid`;
    return { ok: true, userId: row.user_id, deviceId: row.device_id };
  });
}

export async function revokeUserDevice(deviceRecordId: string, adminId: string) {
  await ensureDeviceAgentSchema();
  const sql = getSql();
  const [row] = await sql<{ user_id: string; device_id: string }[]>`
    update core.user_devices
    set status='revoked',revoked_by=${adminId}::uuid,revoked_at=now(),updated_at=now()
    where id=${deviceRecordId}::uuid
    returning user_id::text,device_id
  `;
  if (!row) throw new Error("DEVICE_NOT_FOUND");
  await sql`delete from core.sessions where user_id=${row.user_id}::uuid`;
  return { ok: true, userId: row.user_id, deviceId: row.device_id };
}
