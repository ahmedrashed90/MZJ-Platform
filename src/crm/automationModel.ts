import {
  normalizeAutomationSettingsResponse,
  type AutomationEndpoint,
  type AutomationSettings,
} from "../../shared/crmAutomationContract";

export type AutomationDraft = Omit<AutomationSettings, "triggerIntervalSeconds"> & {
  customValue: number;
  customUnit: "minute" | "hour" | "day";
};

export type AutomationDraftResult = {
  draft: AutomationDraft;
  endpoints: AutomationEndpoint[];
  message?: string;
};

export function secondsToAutomationDuration(seconds: number | null): Pick<AutomationDraft, "customValue" | "customUnit"> {
  const safeSeconds = Number.isFinite(Number(seconds)) && Number(seconds) > 0 ? Number(seconds) : 60;
  if (safeSeconds % 86400 === 0) return { customValue: safeSeconds / 86400, customUnit: "day" };
  if (safeSeconds % 3600 === 0) return { customValue: safeSeconds / 3600, customUnit: "hour" };
  return { customValue: Math.max(1, Math.round(safeSeconds / 60)), customUnit: "minute" };
}

export function automationDurationToSeconds(value: number, unit: AutomationDraft["customUnit"]): number {
  const safeValue = Math.max(1, Number.isFinite(Number(value)) ? Number(value) : 1);
  return safeValue * (unit === "day" ? 86400 : unit === "hour" ? 3600 : 60);
}

export function automationResponseToDraft(result: unknown): AutomationDraftResult {
  const response = normalizeAutomationSettingsResponse(result);
  const duration = secondsToAutomationDuration(response.automation.triggerIntervalSeconds);
  const { triggerIntervalSeconds: _triggerIntervalSeconds, ...automation } = response.automation;
  return {
    draft: { ...automation, ...duration },
    endpoints: response.endpoints,
    ...(response.message ? { message: response.message } : {}),
  };
}

export function automationDraftToSettings(draft: AutomationDraft): AutomationSettings {
  const { customValue, customUnit, ...automation } = draft;
  return {
    ...automation,
    triggerIntervalSeconds: draft.triggerPolicy === "custom_duration"
      ? automationDurationToSeconds(customValue, customUnit)
      : null,
  };
}
