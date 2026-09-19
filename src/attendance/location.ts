export type BrowserAttendanceLocation = {
  latitude: number;
  longitude: number;
  accuracy: number;
};

type PermissionStateLike = PermissionState | "unknown";

const TARGET_ATTENDANCE_ACCURACY_M = 15;
const MAX_DESKTOP_ATTENDANCE_ACCURACY_M = 75;
const LOCATION_CAPTURE_TIMEOUT_MS = 15000;

function positionFromBrowser(position: GeolocationPosition): BrowserAttendanceLocation {
  const latitude = Number(position.coords.latitude);
  const longitude = Number(position.coords.longitude);
  const accuracy = Number(position.coords.accuracy);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error("المتصفح لم يرجع إحداثيات صالحة للموقع");
  }
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw new Error("المتصفح رجع إحداثيات غير صالحة للموقع");
  }
  if (!Number.isFinite(accuracy) || accuracy <= 0) {
    throw new Error("المتصفح لم يرجع دقة صالحة للموقع");
  }

  return { latitude, longitude, accuracy };
}

async function readGeolocationPermission(): Promise<PermissionStateLike> {
  try {
    if (!navigator.permissions?.query) return "unknown";
    const result = await navigator.permissions.query({ name: "geolocation" as PermissionName });
    return result.state;
  } catch {
    return "unknown";
  }
}

function geolocationErrorMessage(
  error: GeolocationPositionError | null,
  permission: PermissionStateLike,
  bestAccuracy: number | null,
) {
  if (permission === "denied" || error?.code === 1) {
    return "صلاحية الموقع مرفوضة لهذا الموقع. اسمح للمنصة بالوصول إلى اللوكيشن ثم أعد المحاولة.";
  }

  if (bestAccuracy !== null && bestAccuracy > MAX_DESKTOP_ATTENDANCE_ACCURACY_M) {
    return `أفضل دقة رجعها الكمبيوتر ±${Math.round(bestAccuracy)}م، وهي أضعف من الحد المقبول ±75م. تأكد من تشغيل Location وWi-Fi ثم أعد المحاولة.`;
  }

  if (error?.code === 2) {
    return "المتصفح لديه إذن الموقع لكن الجهاز لم يرجع إحداثيات دقيقة. تأكد من تشغيل خدمة Location ثم أعد المحاولة.";
  }
  if (error?.code === 3) {
    return "انتهت مهلة تحديد الموقع ولم يرجع الكمبيوتر قراءة موثوقة بما يكفي. تأكد من تشغيل Location وWi-Fi ثم أعد المحاولة.";
  }
  if (permission === "granted") {
    return "إذن اللوكيشن مفتوح لكن الكمبيوتر لم يرسل قراءة موثوقة بما يكفي. تأكد من تشغيل Location وWi-Fi ثم أعد المحاولة.";
  }
  return "تعذر تحديد موقع الحضور من الكمبيوتر بدقة مقبولة. تأكد من السماح بالموقع وتشغيل Location وWi-Fi ثم أعد المحاولة.";
}

export async function getBrowserAttendanceLocation() {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    throw new Error("المتصفح أو الجهاز لا يدعم تحديد الموقع");
  }

  if (
    typeof window !== "undefined"
    && !window.isSecureContext
    && !["localhost", "127.0.0.1"].includes(window.location.hostname)
  ) {
    throw new Error("تحديد الموقع يحتاج فتح المنصة من اتصال HTTPS آمن");
  }

  const permission = await readGeolocationPermission();
  if (permission === "denied") {
    throw new Error(geolocationErrorMessage(null, permission, null));
  }

  return new Promise<BrowserAttendanceLocation>((resolve, reject) => {
    let settled = false;
    let lastError: GeolocationPositionError | null = null;
    let bestLocation: BrowserAttendanceLocation | null = null;
    let hardTimeout = 0;
    let watchId: number | null = null;

    const cleanup = () => {
      window.clearTimeout(hardTimeout);
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    };

    const resolveLocation = (location: BrowserAttendanceLocation) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(location);
    };

    const rejectLocation = (error: GeolocationPositionError | null = lastError) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(geolocationErrorMessage(error, permission, bestLocation?.accuracy ?? null)));
    };

    const considerPosition = (position: GeolocationPosition) => {
      if (settled) return;

      let location: BrowserAttendanceLocation;
      try {
        location = positionFromBrowser(position);
      } catch {
        return;
      }

      if (!bestLocation || location.accuracy < bestLocation.accuracy) {
        bestLocation = location;
      }

      // 15 m or better is excellent even on desktop, so use it immediately.
      if (location.accuracy <= TARGET_ATTENDANCE_ACCURACY_M) {
        resolveLocation(location);
      }
      // For normal desktop readings (15–75 m), keep sampling until the hard timeout
      // so we save the best fresh reading instead of the first reading returned.
    };

    const handleError = (error: GeolocationPositionError) => {
      if (settled) return;
      lastError = error;
      if (error.code === 1) rejectLocation(error);
    };

    const options: PositionOptions = {
      enableHighAccuracy: true,
      timeout: LOCATION_CAPTURE_TIMEOUT_MS,
      maximumAge: 0,
    };

    // Only fresh high-accuracy providers are used. Never accept a fast cached/standard reading.
    navigator.geolocation.getCurrentPosition(considerPosition, handleError, options);
    watchId = navigator.geolocation.watchPosition(considerPosition, handleError, options);

    hardTimeout = window.setTimeout(() => {
      if (bestLocation && bestLocation.accuracy <= MAX_DESKTOP_ATTENDANCE_ACCURACY_M) {
        resolveLocation(bestLocation);
        return;
      }
      rejectLocation();
    }, LOCATION_CAPTURE_TIMEOUT_MS);
  });
}
