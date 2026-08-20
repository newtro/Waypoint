import {describe,expect,it} from "vitest";
import {canonicalWindowsUserData} from "./windows-canonical-profile.js";

describe("canonical Windows Waypoint profile",()=>{
  it("ignores redirected APPDATA and uses the stable user profile",()=>{expect(canonicalWindowsUserData({USERPROFILE:"C:\\Users\\scott",APPDATA:"C:\\Virtualized\\Roaming"},"C:\\fallback")).toBe("C:\\Users\\scott\\AppData\\Roaming\\waypoint")});
  it("uses the Electron home fallback when USERPROFILE is absent",()=>{expect(canonicalWindowsUserData({APPDATA:"C:\\Virtualized"},"C:\\Users\\scott")).toBe("C:\\Users\\scott\\AppData\\Roaming\\waypoint")});
  it("fails closed for a relative profile",()=>{expect(()=>canonicalWindowsUserData({USERPROFILE:"relative"},"also-relative")).toThrow(/canonical Windows user profile/)});
});
