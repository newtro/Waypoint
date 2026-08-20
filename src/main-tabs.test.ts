import { describe, expect, it } from "vitest";
import {
  addMainTab,
  closeMainTabs,
  nextActiveMainTabId,
  viewTab,
} from "./main-tabs.js";

describe("workspace tabs", () => {
  it("opens the experimental office as an ordinary deduplicated workspace tab", () => {
    const office = viewTab("office");
    expect(office).toEqual({
      id: "view:office",
      kind: "view",
      view: "office",
    });
    expect(addMainTab([office], office)).toEqual([office]);
  });

  it("closes the office without disturbing neighboring chat tabs", () => {
    const tabs = [
      { id: "chat:first", kind: "chat", chatId: "first" } as const,
      viewTab("office"),
      { id: "chat:last", kind: "chat", chatId: "last" } as const,
    ];
    const remaining = closeMainTabs(tabs, "view:office", "close");
    expect(remaining.map((tab) => tab.id)).toEqual([
      "chat:first",
      "chat:last",
    ]);
    expect(
      nextActiveMainTabId(tabs, remaining, "view:office", "view:office"),
    ).toBe("chat:last");
  });
});
