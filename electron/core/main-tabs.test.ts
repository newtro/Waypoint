import { describe, expect, it } from "vitest";
import {
  chatTab,
  closeMainTabs,
  nextActiveMainTabId,
  viewTab,
} from "../../src/main-tabs.js";

describe("main content tabs", () => {
  const tabs = [chatTab("one"), viewTab("settings"), chatTab("two")];

  it("supports the standard editor close actions", () => {
    expect(closeMainTabs(tabs, "view:settings", "close").map((tab) => tab.id)).toEqual([
      "chat:one",
      "chat:two",
    ]);
    expect(closeMainTabs(tabs, "view:settings", "close-others")).toEqual([
      viewTab("settings"),
    ]);
    expect(closeMainTabs(tabs, "view:settings", "close-right").map((tab) => tab.id)).toEqual([
      "chat:one",
      "view:settings",
    ]);
    expect(closeMainTabs(tabs, "view:settings", "close-all")).toEqual([]);
  });

  it("selects the nearest surviving tab when the active tab closes", () => {
    const remaining = closeMainTabs(tabs, "view:settings", "close");
    expect(nextActiveMainTabId(tabs, remaining, "view:settings", "view:settings")).toBe(
      "chat:two",
    );
  });

  it("does not change an active tab that survives the close action", () => {
    const remaining = closeMainTabs(tabs, "chat:two", "close");
    expect(nextActiveMainTabId(tabs, remaining, "chat:two", "chat:one")).toBe("chat:one");
  });
});
