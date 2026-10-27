export type AutomationTriggerPolicy = "every_message" | "once_24_hours" | "custom_duration";
export type AutomationStepType = "message" | "text" | "phone" | "choice";
export type AutomationServiceKey = "cash" | "finance" | "service";
export type AutomationBranchPolicy = "system" | "fixed";
export type AutomationReplyType = "text" | "number" | "payload";

export type AutomationFinalAction = {
  createOrUpdateCustomer: boolean;
  classifyService: boolean;
  requestDistribution: boolean;
  assignSales: boolean;
  assignCallCenter: boolean;
  assignCustomerService: boolean;
  sendFinalMessage: boolean;
};

export type AutomationPlatform = {
  id: string;
  sourceCode: string;
  workerCode: string;
  isEnabled: boolean;
  workerName: string;
  workerIsActive: boolean;
  workerSendUrl: string;
  healthUrl: string;
  lastHealthStatus: string;
  lastHealthAt: string;
  lastSuccessAt: string;
  lastError: string;
};

export type AutomationStartMessage = {
  id: string;
  messageCode: string;
  body: string;
  isActive: boolean;
};

export type AutomationChoiceReply = {
  id: string;
  replyType: AutomationReplyType;
  replyValue: string;
};

export type AutomationStepOption = {
  id: string;
  optionCode: string;
  label: string;
  acceptedReplies: string[];
  isActive: boolean;
};

export type AutomationStep = {
  id: string;
  stepCode: string;
  name: string;
  prompt: string;
  stepType: AutomationStepType;
  customerFieldKey: string;
  isRequired: boolean;
  validationRules: Record<string, unknown>;
  validationErrorMessage: string;
  maxAttempts: number | null;
  isActive: boolean;
  options: AutomationStepOption[];
};

export type AutomationChoice = {
  id: string;
  choiceCode: string;
  displayName: string;
  emoji: string;
  departmentCode: string;
  serviceKey: AutomationServiceKey;
  branchPolicy: AutomationBranchPolicy;
  branchCode: string;
  finalAction: AutomationFinalAction;
  finalMessage: string;
  isActive: boolean;
  replies: AutomationChoiceReply[];
  steps: AutomationStep[];
};

export type AutomationSettings = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  triggerPolicy: AutomationTriggerPolicy;
  triggerIntervalSeconds: number | null;
  version: number;
  platforms: AutomationPlatform[];
  startMessages: AutomationStartMessage[];
  choices: AutomationChoice[];
};

export type AutomationEndpoint = {
  sourceCode: string;
  displayName: string;
  isActive: boolean;
  sendUrl: string;
  healthUrl: string;
  updatedAt: string;
};

export type AutomationSettingsResponse = {
  ok: true;
  automation: AutomationSettings;
  endpoints: AutomationEndpoint[];
  message?: string;
};

const defaultFinalAction: AutomationFinalAction = {
  createOrUpdateCustomer: true,
  classifyService: true,
  requestDistribution: true,
  assignSales: true,
  assignCallCenter: false,
  assignCustomerService: false,
  sendFinalMessage: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : value == null ? fallback : String(value);
}

function flag(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function finiteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullablePositiveInteger(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
}

function enumValue<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  return values.includes(value as T) ? value as T : fallback;
}

function objectValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => text(item).trim()).filter(Boolean) : [];
}

function normalizeFinalAction(value: unknown): AutomationFinalAction {
  const input = objectValue(value);
  return {
    createOrUpdateCustomer: flag(input.createOrUpdateCustomer, defaultFinalAction.createOrUpdateCustomer),
    classifyService: flag(input.classifyService, defaultFinalAction.classifyService),
    requestDistribution: flag(input.requestDistribution, defaultFinalAction.requestDistribution),
    assignSales: flag(input.assignSales, defaultFinalAction.assignSales),
    assignCallCenter: flag(input.assignCallCenter, defaultFinalAction.assignCallCenter),
    assignCustomerService: flag(input.assignCustomerService, defaultFinalAction.assignCustomerService),
    sendFinalMessage: flag(input.sendFinalMessage, defaultFinalAction.sendFinalMessage),
  };
}

export function normalizeAutomationSettings(value: unknown): AutomationSettings {
  if (!isRecord(value)) throw new Error("عقد بيانات الأوتوميشن غير موجود في استجابة الخادم");

  return {
    id: text(value.id),
    code: text(value.code, "default_customer_entry"),
    name: text(value.name, "أوتوميشن استقبال وتوزيع العملاء"),
    isActive: flag(value.isActive, true),
    triggerPolicy: enumValue(value.triggerPolicy, ["every_message", "once_24_hours", "custom_duration"] as const, "every_message"),
    triggerIntervalSeconds: nullablePositiveInteger(value.triggerIntervalSeconds),
    version: Math.max(1, Math.round(finiteNumber(value.version, 1))),
    platforms: records(value.platforms).map((item) => ({
      id: text(item.id),
      sourceCode: text(item.sourceCode),
      workerCode: text(item.workerCode),
      isEnabled: flag(item.isEnabled),
      workerName: text(item.workerName),
      workerIsActive: flag(item.workerIsActive),
      workerSendUrl: text(item.workerSendUrl),
      healthUrl: text(item.healthUrl),
      lastHealthStatus: text(item.lastHealthStatus),
      lastHealthAt: text(item.lastHealthAt),
      lastSuccessAt: text(item.lastSuccessAt),
      lastError: text(item.lastError),
    })),
    startMessages: records(value.startMessages).map((item) => ({
      id: text(item.id),
      messageCode: text(item.messageCode),
      body: text(item.body),
      isActive: flag(item.isActive, true),
    })),
    choices: records(value.choices).map((choice) => ({
      id: text(choice.id),
      choiceCode: text(choice.choiceCode),
      displayName: text(choice.displayName),
      emoji: text(choice.emoji),
      departmentCode: text(choice.departmentCode),
      serviceKey: enumValue(choice.serviceKey, ["cash", "finance", "service"] as const, "cash"),
      branchPolicy: enumValue(choice.branchPolicy, ["system", "fixed"] as const, "system"),
      branchCode: text(choice.branchCode),
      finalAction: normalizeFinalAction(choice.finalAction),
      finalMessage: text(choice.finalMessage),
      isActive: flag(choice.isActive, true),
      replies: records(choice.replies).map((reply) => ({
        id: text(reply.id),
        replyType: enumValue(reply.replyType, ["text", "number", "payload"] as const, "text"),
        replyValue: text(reply.replyValue),
      })),
      steps: records(choice.steps).map((step) => ({
        id: text(step.id),
        stepCode: text(step.stepCode),
        name: text(step.name),
        prompt: text(step.prompt),
        stepType: enumValue(step.stepType, ["message", "text", "phone", "choice"] as const, "text"),
        customerFieldKey: text(step.customerFieldKey),
        isRequired: flag(step.isRequired, true),
        validationRules: objectValue(step.validationRules),
        validationErrorMessage: text(step.validationErrorMessage),
        maxAttempts: nullablePositiveInteger(step.maxAttempts),
        isActive: flag(step.isActive, true),
        options: records(step.options).map((option) => ({
          id: text(option.id),
          optionCode: text(option.optionCode),
          label: text(option.label),
          acceptedReplies: stringList(option.acceptedReplies),
          isActive: flag(option.isActive, true),
        })),
      })),
    })),
  };
}

export function normalizeAutomationEndpoints(value: unknown): AutomationEndpoint[] {
  return records(value).map((item) => ({
    sourceCode: text(item.sourceCode),
    displayName: text(item.displayName),
    isActive: flag(item.isActive),
    sendUrl: text(item.sendUrl),
    healthUrl: text(item.healthUrl),
    updatedAt: text(item.updatedAt),
  }));
}

export function normalizeAutomationSettingsResponse(value: unknown): AutomationSettingsResponse {
  if (!isRecord(value) || value.ok !== true) throw new Error("استجابة إعدادات الأوتوميشن غير صحيحة");
  return {
    ok: true,
    automation: normalizeAutomationSettings(value.automation),
    endpoints: normalizeAutomationEndpoints(value.endpoints),
    message: text(value.message) || undefined,
  };
}
