import { getLinkConfig } from "../services/lumihub-link.service";

export type SealedManifest = {
  version?: string | null;
  blocks?: Array<{ key?: string; sha256?: string }>;
};

const cache = new Map<string, Promise<Record<string, string>>>();

export async function resolveSealedPresetBlock(
  presetMetadata: Record<string, any> | undefined,
  blockKey: string,
): Promise<string> {
  if (!presetMetadata || !blockKey) return "";
  const hubPresetId = typeof presetMetadata._lumiverse_lumihub_id === "string"
    ? presetMetadata._lumiverse_lumihub_id
    : "";
  const manifest = isPlainObject(presetMetadata._lumiverse_sealed_preset)
    ? presetMetadata._lumiverse_sealed_preset as SealedManifest
    : null;
  if (!hubPresetId || !manifest?.blocks?.length) return "";

  const expected = manifest.blocks.find((block) => block.key === blockKey)?.sha256;
  if (!expected) return "";

  const version = typeof manifest.version === "string"
    ? manifest.version
    : typeof presetMetadata._lumiverse_preset_version === "string"
      ? presetMetadata._lumiverse_preset_version
      : null;
  const cacheKey = `${hubPresetId}:${version ?? ""}`;
  let pending = cache.get(cacheKey);
  if (!pending) {
    console.log(`[LumiHub Debug] 触发拉取 sealed blocks, Preset ID: ${hubPresetId}, Version: ${version}`);
    pending = fetchSealedBlocks(hubPresetId, version, manifest);
    cache.set(cacheKey, pending);
  } else {
    console.log(`[LumiHub Debug] 命中缓存，使用已存在的 Promise: ${cacheKey}`);
  }

  try {
    const blocks = await pending;
    return blocks[blockKey] || "";
  } catch (err) {
    cache.delete(cacheKey);
    console.warn("[LumiHub] Failed to resolve sealed preset block:", err);
    return "";
  }
}

export async function resolveSealedPresetBlocksForInstall(
  hubPresetId: string,
  version: string | null,
  manifest: SealedManifest,
): Promise<Record<string, string>> {
  if (!hubPresetId || !manifest.blocks?.length) return {};
  return fetchSealedBlocks(hubPresetId, version, manifest);
}

async function fetchSealedBlocks(
  hubPresetId: string,
  version: string | null,
  manifest: SealedManifest,
): Promise<Record<string, string>> {
  console.log("[LumiHub Debug] 1. 进入 fetchSealedBlocks 函数...");
  const config = await getLinkConfig();
  
  if (!config) {
    console.error("[LumiHub Debug] 2. 失败：没有找到 LumiHub 配置或 Token，请先在前端绑定账号！");
    return {};
  }
  console.log("[LumiHub Debug] 2. 成功获取配置，Token 存在。准备发起网络请求...");

  const base = config.lumihubUrl.replace(/\/+$/, "");
  const url = new URL(`${base}/api/v1/presets/${encodeURIComponent(hubPresetId)}/sealed-blocks`);
  if (version) url.searchParams.set("version", version);

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${config.linkToken}` },
    });
    
    if (!res.ok) {
      console.error(`[LumiHub Debug] 3. 网络请求失败，服务器返回状态码: HTTP ${res.status}`);
      throw new Error(`HTTP ${res.status}`);
    }
    console.log("[LumiHub Debug] 3. 网络请求成功 (200 OK)，正在解析 JSON...");

    const json = await res.json() as { blocks?: Record<string, string> };
    const rawBlocks = isPlainObject(json.blocks) ? json.blocks : {};
    const out: Record<string, string> = {};

    console.log(`[LumiHub Debug] 4. 收到 ${Object.keys(rawBlocks).length} 个原始 blocks，开始校验 Hash...`);

    for (const entry of manifest.blocks || []) {
      if (typeof entry.key !== "string" || typeof entry.sha256 !== "string") continue;
      const content = rawBlocks[entry.key];
      if (typeof content !== "string") continue;
      if (await sha256(content) !== entry.sha256) continue;
      out[entry.key] = content;
    }

    if (Object.keys(out).length > 0) {
      console.log("\n========== [SEALED PRESET EXTRACTED] ==========");
      console.log(`Hub Preset ID: ${hubPresetId}`);
      console.log(`Version: ${version ?? "latest"}\n`);
      for (const [key, content] of Object.entries(out)) {
        console.log(`--- Block Key: ${key} ---`);
        console.log(content);
        console.log("-------------------------------------------\n");
      }
      console.log("==============================================\n");
    } else {
      console.warn("[LumiHub Debug] 5. 没有提取到任何内容，可能是 Hash 校验全部失败！");
    }

    return out;
  } catch (error) {
    console.error("[LumiHub Debug] fetchSealedBlocks 发生异常:", error);
    throw error;
  }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Buffer.from(digest).toString("hex");
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
