import type { ExecutionFolderCreation, RawFolderRequest, RawFolderResult } from "./types";

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

function compactServerUsers(value: unknown) {
  const users = asRecord(value);
  return Object.fromEntries(Object.entries(users).map(([key, raw]) => {
    const user = asRecord(raw);
    return [key, {
      uid: user.uid || user.id || user.userId || "",
      name: user.name || user.fullName || user.full_name || "",
      folderName: user.folderName || key,
      folderPath: user.folderPath || user.outputFolderPath || user.path || "",
      folderId: user.folderId || user.outputFolderId || "",
      outputFolderId: user.outputFolderId || user.folderId || "",
      outputWindowsPath: user.userOutputWindowsPath || user.outputWindowsPath || user.windowsPath || "",
      folderUrl: user.folderUrl || user.outputFolderUrl || "",
      outputFolderUrl: user.outputFolderUrl || user.folderUrl || "",
    }];
  }));
}

function compactRawFolders(value: unknown) {
  const rawFolders = asRecord(value);
  return Object.fromEntries(Object.entries(rawFolders).map(([key, raw]) => {
    const creative = asRecord(raw);
    const subFolders = asRecord(creative.subFolders);
    return [key, {
      name: creative.name || "",
      folderName: creative.folderName || key,
      creativeInstanceId: creative.creativeInstanceId || creative.id || "",
      creativeId: creative.creativeId || "",
      creativeIndex: creative.creativeIndex ?? null,
      storageProvider: creative.storageProvider || creative.storage_provider || "",
      type: creative.type || "",
      folderId: creative.folderId || creative.creativeFolderId || "",
      creativeFolderId: creative.creativeFolderId || creative.folderId || "",
      rawFolderId: creative.rawFolderId || "",
      outputFolderId: creative.outputFolderId || "",
      folderPath: creative.folderPath || creative.creativeFolderPath || creative.path || "",
      folderUrl: creative.folderUrl || "",
      rawFolderPath: creative.rawFolderPath || creative.rawPath || "",
      outputFolderPath: creative.outputFolderPath || creative.outputPath || "",
      rawWindowsPath: creative.rawWindowsPath || creative.windowsRawPath || "",
      outputWindowsPath: creative.outputWindowsPath || creative.windowsOutputPath || "",
      rawFolderUrl: creative.rawFolderUrl || subFolders.raw || "",
      outputFolderUrl: creative.outputFolderUrl || subFolders.output || "",
      subFolders: {
        raw: subFolders.raw || creative.rawFolderUrl || "",
        output: subFolders.output || creative.outputFolderUrl || "",
      },
      users: compactServerUsers(creative.users),
    }];
  }));
}

/**
 * Keep only the folder identities and paths returned by the storage service.
 * Cars and other response payloads are deliberately excluded so campaign/agenda
 * creation does not duplicate a large amount of data in its request body.
 */
export function compactExecutionFolderCreation(request: RawFolderRequest, result: RawFolderResult): ExecutionFolderCreation {
  const raw = result as Record<string, any>;
  return {
    request: {
      ...request,
      creatives: request.creatives.map((creative) => ({
        ...creative,
        cars: [],
        users: creative.users.map((user) => ({
          uid: user.uid,
          name: user.name,
          folderName: user.folderName,
        })),
      })),
    },
    result: {
      ok: result.ok,
      message: result.message,
      storageProvider: raw.storageProvider || raw.storage_provider || "",
      type: raw.type || "",
      monthKey: result.monthKey,
      campaignCode: result.campaignCode,
      campaignFolderName: result.campaignFolderName,
      campaignFolderPath: result.campaignFolderPath,
      campaignFolderId: raw.campaignFolderId || "",
      campaignFolderUrl: raw.campaignFolderUrl || "",
      monthFolderId: raw.monthFolderId || "",
      rootFolderId: raw.rootFolderId || "",
      rawRoot: result.rawRoot,
      rawBaseUrl: raw.rawBaseUrl,
      driveLetter: result.driveLetter,
      rootPath: raw.rootPath,
      basePath: raw.basePath,
      folderPath: raw.folderPath,
      campaignPath: raw.campaignPath,
      rawFolders: compactRawFolders(result.rawFolders),
    },
  };
}
