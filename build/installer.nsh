!macro preInit
  ; Suppress electron-builder's elevated HKCU uninstaller execution path.
  ; The new unelevated Waypoint process removes the legacy binary directory safely.
  SetShellVarContext current
  ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  StrCmp $0 "" legacy_registration_done
  Delete "$DESKTOP\Waypoint.lnk"
  Delete "$SMPROGRAMS\Waypoint.lnk"
  Delete "$APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\Waypoint.lnk"
  DeleteRegKey HKCU "${UNINSTALL_REGISTRY_KEY}"
  DeleteRegKey HKCU "${INSTALL_REGISTRY_KEY}"
legacy_registration_done:
  SetShellVarContext all
!macroend
