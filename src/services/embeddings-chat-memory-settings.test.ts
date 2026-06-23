import { describe, expect, test } from "bun:test";
import {
  DEFAULT_CHAT_MEMORY_SETTINGS,
  normalizeChatMemorySettings,
} from "./embeddings.service";

describe("normalizeChatMemorySettings", () => {
  test("upgrades legacy default memory templates", () => {
    const normalized = normalizeChatMemorySettings({
      memoryHeaderTemplate: "Relevant context from earlier in this conversation:\n{{memories}}",
      chunkTemplate: "{{content}}",
    });

    expect(normalized.memoryHeaderTemplate).toBe(DEFAULT_CHAT_MEMORY_SETTINGS.memoryHeaderTemplate);
    expect(normalized.chunkTemplate).toBe(DEFAULT_CHAT_MEMORY_SETTINGS.chunkTemplate);
  });

  test("preserves customized memory templates", () => {
    const normalized = normalizeChatMemorySettings({
      memoryHeaderTemplate: "Custom header\n{{memories}}",
      chunkTemplate: "Custom chunk: {{content}}",
    });

    expect(normalized.memoryHeaderTemplate).toBe("Custom header\n{{memories}}");
    expect(normalized.chunkTemplate).toBe("Custom chunk: {{content}}");
  });
});
