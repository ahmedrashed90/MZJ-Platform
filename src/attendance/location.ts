export type BrowserAttendanceLocation = {
  latitude: number;
  longitude: number;
  accuracy: number;
};

type PermissionStateLike = PermissionState | "unknown";

const TARGET_ATTENDANCE_ACCURACY_M = 15;
const LOCATION_CAPTURE_TIMEOUT_MS = 12000;
const BEST_READING_SETTLE_MS = 4000;

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

function geolocationErrorMessage(error: GeolocationPositionError | null, permission: PermissionStateLike) {
  if (permission === "denied" || error?.code === 1) {
    return "صلاحية الموقع مرفوضة لهذا الموقع. اسمح للمنصة بالوصول إلى اللوكيشن ثم أعد المحاولة.";
  }
  if (error?.code === 2) {
    return "خدمة الموقع في الكمبيوتر لم ترجع إحداثيات. سيتم استخدام شبكة الفرع تلقائيًا إذا كانت مفعلة في إعدادات الحضور.";
  }
  if (error?.code === 3) {
    return "انتهت مهلة تحديد الموقع من الكمبيوتر. سيتم استخدام شبكة الفرع تلقائيًا إذا كانت مفعلة في إعدادات الحضور.";
  }
  if (permission === "granted") {
    return "إذن اللوكيشن مفتوح لكن الكمبيوتر لم يرسل إحداثيات. سيتم استخدام شبكة الفرع تلقائيًا إذا كانت مفعلة.";
  }
  return "تعذر تحديد موقع الحضور من الكمبيوتر. سيتم استخدام شبكة الفرع تلقائيًا إذا كانت مفعلة.";
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
  if (permission === "denied") throw new Error(geolocationErrorMessage(null, permission));

  return new Promise<BrowserAttendanceLocation>((resolve, reject) => {
    let settled = false;
    let lastError: GeolocationPositionError | null = null;
    let bestLocation: BrowserAttendanceLocation | null = null;
    let hardTimeout = 0;
    let bestReadingTimer = 0;
    let watchId: number | null = null;

    const cleanup = () => {
      window.clearTimeout(hardTimeout);
      window.clearTimeout(bestReadingTimer);
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
      reject(new Error(geolocationErrorMessage(error, permission)));
    };

    const considerPosition = (position: GeolocationPosition) => {
      if (settled) return;
      let location: BrowserAttendanceLocation;
      try {
        location = positionFromBrowser(position);
      } catch {
        return;
      }

      if (!bestLocation || location.accuracy < bestLocation.accuracy) bestLocation = location;

      if (location.accuracy <= TARGET_ATTENDANCE_ACCURACY_M) {
        resolveLocation(location);
        return;
      }

      if (!bestReadingTimer) {
        bestReadingTimer = window.setTimeout(() => {
          if (bestLocation) resolveLocation(bestLocation);
        }, BEST_READING_SETTLE_MS);
      }
    };

    const handleError = (error: GeolocationPositionError) => {
      if (settled) return;
      lastError = error;
      if (error.code === 1) rejectLocation(error);
    };

    navigator.geolocation.getCurrentPosition(
      considerPosition,
      handleError,
      { enableHighAccuracy: true, timeout: LOCATION_CAPTURE_TIMEOUT_MS, maximumAge: 0 },
    );

    navigator.geolocation.getCurrentPosition(
      considerPosition,
      handleError,
      { enableHighAccuracy: false, timeout: Math.min(6000, LOCATION_CAPTURE_TIMEOUT_MS), maximumAge: 0 },
    );

    watchId = navigator.geolocation.watchPosition(
      considerPosition,
      handleError,
      { enableHighAccuracy: true, timeout: LOCATION_CAPTURE_TIMEOUT_MS, maximumAge: 0 },
    );

    hardTimeout = window.setTimeout(() => {
      if (bestLocation) {
        resolveLocation(bestLocation);
        return;
      }
      rejectLocation();
    }, LOCATION_CAPTURE_TIMEOUT_MS);
  });
}
