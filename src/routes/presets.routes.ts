import { Hono } from "hono";
import * as svc from "../services/presets.service";
import { parsePagination } from "../services/pagination";
import { REVALIDATE_PRIVATE, ifNoneMatchSatisfies } from "../utils/http-cache";

const app = new Hono();

app.get("/", (c) => {
  const userId = c.get("userId");
  const pagination = parsePagination(c.req.query("limit"), c.req.query("offset"));
  return c.json(svc.listPresets(userId, pagination));
});

app.get("/registry", (c) => {
  const userId = c.get("userId");
  const pagination = parsePagination(c.req.query("limit"), c.req.query("offset"));
  const provider = c.req.query("provider") || undefined;
  const engine = c.req.query("engine") || undefined;

  const sig = svc.getPresetRegistrySignature(userId, provider, engine);
  const etag = `"presets-reg-${sig.count}-${sig.maxUpdatedAt}-${provider ?? ""}-${engine ?? ""}-${pagination.limit}-${pagination.offset}"`;
  if (ifNoneMatchSatisfies(c.req.header("if-none-match"), etag)) {
    return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": REVALIDATE_PRIVATE } });
  }
  c.header("ETag", etag);
  c.header("Cache-Control", REVALIDATE_PRIVATE);
  return c.json(svc.listPresetRegistry(userId, pagination, provider, engine));
});

app.post("/", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json();

  // ==========================================
  // 【终极拦截】自动解封并替换明文
  // ==========================================
  try {
    const sealedPreset = body?.metadata?._lumiverse_sealed_preset;
    const lumihubId = body?.metadata?._lumiverse_lumihub_id;
    const presetVersion = body?.metadata?._lumiverse_preset_version;

    if (sealedPreset && lumihubId && Array.isArray(body.prompt_order)) {
      // 动态导入 LumiHub 的解封服务
      const { resolveSealedPresetBlocksForInstall } = await import("../lumihub/sealed-presets");
      
      // 找出 JSON 里所有需要解封的 Key
      const usedKeys = new Set<string>();
      for (const block of body.prompt_order) {
        const content = typeof block?.content === "string" ? block.content.trim() : "";
        const match = content.match(/^\{\{(?:presetBlock|pblock)::([^}]+)\}\}$/);
        if (match?.[1]) usedKeys.add(match[1].trim());
      }

      if (usedKeys.size > 0) {
        console.log("\n========== [AUTO UNSEAL PRESET START] ==========");
        console.log(`检测到密封预设 ID: ${lumihubId}，准备解封 ${usedKeys.size} 个块...`);
        
        // 调用 LumiHub API 拉取明文
        const resolved = await resolveSealedPresetBlocksForInstall(lumihubId, presetVersion, sealedPreset);
        
        // 遍历预设块，打印明文并直接替换 JSON 里的占位符
        for (const block of body.prompt_order) {
          const content = typeof block?.content === "string" ? block.content.trim() : "";
          const match = content.match(/^\{\{(?:presetBlock|pblock)::([^}]+)\}\}$/);
          const key = match?.[1]?.trim();
          
          if (key && resolved[key]) {
            console.log(`\n--- [${key}] 解封成功 ---`);
            console.log(resolved[key]);
            console.log(`--- 结束 ---\n`);
            
            // 核心操作：把占位符替换成真实的明文！
            block.content = resolved[key];
          } else if (key) {
            console.warn(`\n--- [${key}] 解封失败或未找到 ---\n`);
          }
        }
        console.log("========== [AUTO UNSEAL PRESET END] ==========\n");
      }
    }
  } catch (err) {
    console.error("[AUTO UNSEAL] 自动解封过程出错:", err);
  }
  // ==========================================

  if (!body.name || !body.provider) return c.json({ error: "name and provider are required" }, 400);
  return c.json(svc.createPreset(userId, body), 201);
});

app.get("/:id", (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");

  const updatedAt = svc.getPresetUpdatedAt(userId, id);
  if (updatedAt == null) return c.json({ error: "Not found" }, 404);

  const etag = `"preset-${id}-${updatedAt}"`;
  if (ifNoneMatchSatisfies(c.req.header("if-none-match"), etag)) {
    return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": REVALIDATE_PRIVATE } });
  }

  const preset = svc.getPreset(userId, id);
  if (!preset) return c.json({ error: "Not found" }, 404);

  c.header("ETag", etag);
  c.header("Cache-Control", REVALIDATE_PRIVATE);
  return c.json(preset);
});

app.put("/:id", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json();
  const preset = svc.updatePreset(userId, c.req.param("id"), body);
  if (!preset) return c.json({ error: "Not found" }, 404);
  return c.json(preset);
});

app.delete("/:id", (c) => {
  const userId = c.get("userId");
  if (!svc.deletePreset(userId, c.req.param("id"))) return c.json({ error: "Not found" }, 404);
  return c.json({ success: true });
});

export { app as presetsRoutes };
