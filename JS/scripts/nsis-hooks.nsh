!macro customInstall
  ; Register native messaging host for Chrome
  WriteRegStr HKCU "Software\Google\Chrome\NativeMessagingHosts\com.xjay5.flash_dm" "" "$INSTDIR\resources\native-host-manifest.json"
  ; Register native messaging host for Edge
  WriteRegStr HKCU "Software\Microsoft\Edge\NativeMessagingHosts\com.xjay5.flash_dm" "" "$INSTDIR\resources\native-host-manifest.json"
  ; Register native messaging host for Brave
  WriteRegStr HKCU "Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.xjay5.flash_dm" "" "$INSTDIR\resources\native-host-manifest.json"

  ; Write native host manifest JSON
  FileOpen $0 "$INSTDIR\resources\native-host-manifest.json" w
  FileWrite $0 '{$\r$\n'
  FileWrite $0 '  "name": "com.xjay5.flash_dm",$\r$\n'
  FileWrite $0 '  "description": "Zetta Download Manager",$\r$\n'
  FileWrite $0 '  "path": "$INSTDIR\Zetta Download Manager.exe",$\r$\n'
  FileWrite $0 '  "type": "stdio",$\r$\n'
  FileWrite $0 '  "allowed_origins": []$\r$\n'
  FileWrite $0 '}$\r$\n'
  FileClose $0

  ; Register extension for Chrome via External Extensions
  CreateDirectory "$LOCALAPPDATA\Google\Chrome\User Data\Default\External Extensions"
  ; Note: User still needs to manually load unpacked extension or install from CRX
  ; The ext folder is shipped at: $INSTDIR\resources\ext

!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\com.xjay5.flash_dm"
  DeleteRegKey HKCU "Software\Microsoft\Edge\NativeMessagingHosts\com.xjay5.flash_dm"
  DeleteRegKey HKCU "Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.xjay5.flash_dm"
  Delete "$INSTDIR\resources\native-host-manifest.json"
!macroend
