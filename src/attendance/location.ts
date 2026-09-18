export type BrowserAttendanceLocation = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
};

type PermissionStateLike = PermissionState | "unknown";

function positionFromBrowser(position: GeolocationPosition): BrowserAttendanceLocation {
  const latitude = Number(position.coords.latitude);
  const longitude = Number(position.coords.longitude);
  const accuracy = Number(position.coords.accuracy);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error("المتصفح لم يرجع إحداثيات صالحة للموقع");
  }
  return {
    latitude,
    longitude,
    accuracy: Number.isFinite(accuracy) ? accuracy : null,
  };
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
    return "خدمة الموقع مفعلة لكن الجهاز لم يرجع إحداثيات. تأكد من تشغيل Location Services ثم أعد المحاولة.";
  }
  if (error?.code === 3) {
    return "انتهت مهلة تحديد الموقع بدون إحداثيات. أعد المحاولة بعد التأكد من تشغيل خدمة الموقع.";
  }
  if (permission === "granted") {
    return "المتصفح لديه إذن الموقع لكن لم يستطع الحصول على الإحداثيات. أعد المحاولة بعد تحديث الصفحة.";
  }
  return "تعذر تحديد موقع الحضور من الجهاز. تأكد من السماح بالموقع وتشغيل خدمة Location ثم أعد المحاولة.";
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
    throw new Error(geolocationErrorMessage(null, permission));
  }

  return new Promise<BrowserAttendanceLocation>((resolve, reject) => {
    let settled = false;
    let failedAttempts = 0;
    let lastError: GeolocationPositionError | null = null;
    let hardTimeout = 0;

    const finishSuccess = (position: GeolocationPosition) => {
      if (settled) return;
      try {
        const normalized = positionFromBrowser(position);
        settled = true;
        window.clearTimeout(hardTimeout);
        resolve(normalized);
      } catch (error) {
        settled = true;
        window.clearTimeout(hardTimeout);
        reject(error);
      }
    };

    const finishFailure = (error: GeolocationPositionError) => {
      if (settled) return;
      lastError = error;
      failedAttempts += 1;
      if (error.code === 1 || failedAttempts >= 2) {
        settled = true;
        window.clearTimeout(hardTimeout);
        reject(new Error(geolocationErrorMessage(error, permission)));
      }
    };

    // Two independent requests are intentional: on Windows/desktop Chromium the
    // high-accuracy request can stall while the standard provider is already able
    // to return a valid system location. The first valid position wins.
    navigator.geolocation.getCurrentPosition(
      finishSuccess,
      finishFailure,
      { enableHighAccuracy: false, timeout: 7000, maximumAge: 120000 },
    );

    navigator.geolocation.getCurrentPosition(
      finishSuccess,
      finishFailure,
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );

    hardTimeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(geolocationErrorMessage(lastError, permission)));
    }, 12000);
  });
}
