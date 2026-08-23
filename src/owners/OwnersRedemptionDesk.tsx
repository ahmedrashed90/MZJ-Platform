import { useEffect, useRef, useState } from "react";
import { CheckCircle, MagnifyingGlass, QrCode, StopCircle, WarningCircle, XCircle } from "@phosphor-icons/react";
import { ownersAdminPost } from "./api";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "تعذر تنفيذ الطلب";
}

function formatDate(value: unknown) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("ar-SA", { dateStyle: "medium", timeStyle: "short" }).format(new Date(String(value)));
  } catch {
    return String(value);
  }
}

type LookupResult = {
  state: "valid" | "used" | "invalid" | "unavailable";
  message?: string;
  redemption?: {
    id: string;
    code: string;
    status: string;
    pointsCost: number;
    createdAt: string;
    redeemedAt?: string | null;
    redeemedBy?: string | null;
    customerName: string;
    phone: string;
    rewardName: string;
  };
};

export function OwnersRedemptionDesk() {
  const [code, setCode] = useState("");
  const [result, setResult] = useState<LookupResult | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);

  function stopScanner() {
    if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setScanning(false);
  }

  useEffect(() => () => stopScanner(), []);

  async function lookup(value = code) {
    const normalized = value.replace(/\D/g, "").slice(0, 8);
    setCode(normalized);
    setMessage("");
    setResult(null);
    if (!/^\d{8}$/.test(normalized)) {
      setMessage("اكتب كود الاستبدال المكون من 8 أرقام");
      return;
    }
    setBusy(true);
    try {
      const response = await ownersAdminPost({ action: "lookup_redemption", code: normalized });
      setResult(response as LookupResult);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelivery() {
    if (!result?.redemption?.id || result.state !== "valid") return;
    if (!window.confirm(`تأكيد تسليم مكافأة «${result.redemption.rewardName}» للعميل ${result.redemption.customerName}؟`)) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await ownersAdminPost({ action: "confirm_redemption", code: result.redemption.code });
      setResult(response as LookupResult);
    } catch (error) {
      setMessage(errorMessage(error));
      await lookup(result.redemption.code).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function startScanner() {
    setMessage("");
    const BarcodeDetectorClass = (window as any).BarcodeDetector;
    if (!BarcodeDetectorClass || !navigator.mediaDevices?.getUserMedia) {
      setMessage("المتصفح لا يدعم مسح QR بالكاميرا. استخدم الكود الرقمي المكون من 8 أرقام.");
      return;
    }
    stopScanner();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      streamRef.current = stream;
      setScanning(true);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const video = videoRef.current;
      if (!video) throw new Error("تعذر تشغيل الكاميرا");
      video.srcObject = stream;
      await video.play();
      const detector = new BarcodeDetectorClass({ formats: ["qr_code"] });
      const scan = async () => {
        const currentVideo = videoRef.current;
        if (!currentVideo || !streamRef.current) return;
        try {
          const items = await detector.detect(currentVideo);
          const raw = String(items?.[0]?.rawValue || "").trim();
          const numeric = raw.replace(/\D/g, "");
          if (/^\d{8}$/.test(numeric)) {
            stopScanner();
            setCode(numeric);
            void lookup(numeric);
            return;
          }
        } catch {
          // Keep the scanner running; transient decode errors are expected between frames.
        }
        frameRef.current = requestAnimationFrame(() => void scan());
      };
      frameRef.current = requestAnimationFrame(() => void scan());
    } catch (error) {
      stopScanner();
      setMessage(error instanceof Error && /permission|denied|notallowed/i.test(error.message)
        ? "تعذر فتح الكاميرا. اسمح للمتصفح باستخدام الكاميرا أو اكتب كود الاستبدال."
        : errorMessage(error));
    }
  }

  const stateClass = result?.state === "valid" ? "valid" : result?.state === "used" ? "used" : "invalid";

  return (
    <div className="crm-page crm-owners-community-page" dir="rtl">
      <header className="crm-page-head">
        <div>
          <span className="crm-page-kicker"><QrCode size={18} /> MZJ Owners Community</span>
          <h1>استعلام استبدال المكافآت</h1>
        </div>
      </header>

      <section className="crm-panel crm-owners-redemption-lookup">
        <form onSubmit={(event) => { event.preventDefault(); void lookup(); }}>
          <label className="crm-owners-redemption-code-field">
            <span>كود الاستبدال</span>
            <div className="crm-owners-redemption-input-shell">
              <QrCode size={20} />
              <input
                inputMode="numeric"
                autoComplete="off"
                maxLength={8}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 8))}
                placeholder="00000000"
                dir="ltr"
              />
            </div>
          </label>
          <div className="crm-owners-redemption-actions">
            <button className="crm-primary-button" type="submit" disabled={busy || code.length !== 8}><MagnifyingGlass size={18} /> {busy ? "جاري الاستعلام..." : "استعلام"}</button>
            <button className="crm-secondary-button" type="button" disabled={busy} onClick={() => scanning ? stopScanner() : void startScanner()}>
              {scanning ? <StopCircle size={18} /> : <QrCode size={18} />}{scanning ? "إيقاف الكاميرا" : "مسح QR"}
            </button>
          </div>
        </form>
        {scanning ? <div className="crm-owners-qr-camera"><video ref={videoRef} muted playsInline /><span>وجّه الكاميرا إلى QR الخاص بالعميل</span></div> : null}
      </section>

      {message ? <div className="crm-owners-redemption-message"><WarningCircle size={19} /> {message}</div> : null}

      {result ? (
        <section className={`crm-panel crm-owners-redemption-result ${stateClass}`}>
          <header>
            {result.state === "valid" ? <CheckCircle size={30} weight="fill" /> : result.state === "used" ? <WarningCircle size={30} weight="fill" /> : <XCircle size={30} weight="fill" />}
            <div>
              <h2>{result.state === "valid" ? "الكود صحيح وجاهز للاستبدال" : result.state === "used" ? "تم استخدام هذا الكود مسبقًا" : result.message || "كود الاستبدال غير صالح"}</h2>
              {result.redemption ? <span>كود الاستبدال: <b dir="ltr">{result.redemption.code}</b></span> : null}
            </div>
          </header>
          {result.redemption ? (
            <div className="crm-owners-redemption-details">
              <article><span>العميل</span><strong>{result.redemption.customerName || "—"}</strong></article>
              <article><span>الجوال</span><strong dir="ltr">{result.redemption.phone || "—"}</strong></article>
              <article><span>المكافأة</span><strong>{result.redemption.rewardName || "—"}</strong></article>
              <article><span>قيمة الاستبدال</span><strong>{Number(result.redemption.pointsCost || 0).toLocaleString("ar-SA-u-nu-latn")} نقطة</strong></article>
              <article><span>تاريخ إنشاء الاستبدال</span><strong>{formatDate(result.redemption.createdAt)}</strong></article>
              {result.redemption.redeemedAt ? <article><span>تم التسليم</span><strong>{formatDate(result.redemption.redeemedAt)}</strong></article> : null}
              {result.redemption.redeemedBy ? <article><span>المندوب</span><strong>{result.redemption.redeemedBy}</strong></article> : null}
            </div>
          ) : null}
          {result.state === "valid" ? <button className="crm-primary-button crm-owners-confirm-delivery" type="button" disabled={busy} onClick={() => void confirmDelivery()}><CheckCircle size={19} /> {busy ? "جاري التأكيد..." : "تأكيد تسليم المكافأة"}</button> : null}
        </section>
      ) : null}
    </div>
  );
}
