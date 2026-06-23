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
  console.log(`[LumiHub TRACE] resolveSealedPresetBlock 被调用, blockKey: ${blockKey}`);
  console.log(`[LumiHub TRACE] 传入的 presetMetadata:`, JSON.stringify(presetMetadata, null, 2));

  if (!presetMetadata || !blockKey) {
    console.log("[LumiHub TRACE] 退出：缺少 metadata 或 blockKey");
    return "";
  }
  const hubPresetId = typeof presetMetadata._lumiverse_lumihub_id === "string"
    ? presetMetadata._lumiverse_lumihub_id
    : "";
  const manifest = isPlainObject(presetMetadata._lumiverse_sealed_preset)
    ? presetMetadata._lumiverse_sealed_preset as SealedManifest
    : null;
    
  if (!hubPresetId || !manifest?.blocks?.length) {
    console.log(`[LumiHub TRACE] 退出：hubPresetId (${hubPresetId}) 为空或 manifest 为空`);
    return "";
  }

  const expected = manifest.blocks.find((block) => block.key === blockKey)?.sha256;
  if (!expected) {
    console.log(`[LumiHub TRACE] 退出：在 manifest 中没找到 key 为 ${blockKey} 的哈希`);
    return "";
  }

  const version = typeof manifest.version === "string"
    ? manifest.version
    : typeof presetMetadata._lumiverse_preset_version === "string"
      ? presetMetadata._lumiverse_preset_version
      : null;
  const cacheKey = `${hubPresetId}:${version ?? ""}`;
  let pending = cache.get(cacheKey);
  if (!pending) {
    console.log(`[LumiHub TRACE] 触发拉取 sealed blocks, Preset ID: ${hubPresetId}, Version: ${version}`);
    pending = fetchSealedBlocks(hubPresetId, version, manifest);
    cache.set(cacheKey, pending);
  } else {
    console.log(`[LumiHub TRACE] 命中缓存，使用已存在的 Promise: ${cacheKey}`);
  }

  try {
    const blocks = await pending;
    console.log(`[LumiHub TRACE] 获取成功，返回 block 内容长度: ${blocks[blockKey]?.length || 0}`);
    return blocks[blockKey] || "";
  } catch (err) {
    cache.delete(cacheKey);
    console.warn("[LumiHub TRACE] 获取失败:", err);
    return "";
  }
}

export async function resolveSealedPresetBlocksForInstall(
  hubPresetId: string,
  version: string | null,
  manifest: SealedManifest,
): Promise<Record<string, string>> {
  console.log(`[LumiHub TRACE] resolveSealedPresetBlocksForInstall 被调用, ID: ${hubPresetId}`);
  if (!hubPresetId || !manifest.blocks?.length) {
    console.log("[LumiHub TRACE] install 退出：缺少参数");
    return {};
  }
  return fetchSealedBlocks(hubPresetId, version, manifest);
}

async function fetchSealedBlocks(
  hubPresetId: string,
  version: string | null,
  manifest: SealedManifest,
): Promise<Record<string, string>> {
  console.log("[LumiHub TRACE] fetchSealedBlocks 执行...");
  const config = await getLinkConfig();
  
  if (!config) {
    console.error("[LumiHub TRACE] 失败：没有找到 LumiHub 配置或 Token！");
    return {};
  }

  const base = config.lumihubUrl.replace(/\/+$/, "");
  const url = new URL(`${base}/api/v1/presets/${encodeURIComponent(hubPresetId)}/sealed-blocks`);
  if (version) url.searchParams.set("version", version);

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${config.linkToken}` },
    });
    
    if (!res.ok) {
      console.error(`[LumiHub TRACE] 请求失败，HTTP ${res.status}`);
      throw new Error(`HTTP ${res.status}`);
    }

    const json = await res.json() as { blocks?: Record<string, string> };
    const rawBlocks = isPlainObject(json.blocks) ? json.blocks : {};
    const out: Record<string, string> = {};

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
      console.warn("[LumiHub TRACE] 没有提取到任何内容！");
    }

    return out;
  } catch (error) {
    console.error("[LumiHub TRACE] 异常:", error);
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
