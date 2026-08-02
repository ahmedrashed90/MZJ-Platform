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
      folderPath: creative.folderPath || creative.creativeFolderPath || creative.path || "",
      folderUrl: creative.folderUrl || "",
      rawFolderPath: creative.rawFolderPath || creative.rawPath || "",
      outputFolderPath: creative.outputFolderPath || creative.outputPath || "",
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
 * Keep only the exact folder identities and paths returned by the RAW server.
 * Cars and other response payloads are deliberately excluded so campaign/agenda
 * creation does not duplicate a large amount of data in its request body.
 */
export function compactExecutionFolderCreation(request: RawFolderRequest, result: RawFolderResult): ExecutionFolderCreation {
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
      monthKey: result.monthKey,
      campaignCode: result.campaignCode,
      campaignFolderName: result.campaignFolderName,
      campaignFolderPath: result.campaignFolderPath,
      rawRoot: result.rawRoot,
      driveLetter: result.driveLetter,
      rootPath: result.rootPath,
      basePath: result.basePath,
      folderPath: result.folderPath,
      campaignPath: result.campaignPath,
      rawFolders: compactRawFolders(result.rawFolders),
    },
  };
}
