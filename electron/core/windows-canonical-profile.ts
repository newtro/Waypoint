import path from "node:path";

/** Stable Waypoint profile root that ignores inherited APPDATA virtualization. */
export function canonicalWindowsUserData(environment:NodeJS.ProcessEnv,fallbackHome:string):string{
  const profile=environment.USERPROFILE||fallbackHome;
  if(!profile||!path.win32.isAbsolute(profile))throw new Error("A canonical Windows user profile path is unavailable");
  return path.win32.join(profile,"AppData","Roaming","waypoint");
}
