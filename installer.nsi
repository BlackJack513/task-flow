Unicode true
ManifestDPIAware true

!include "MUI2.nsh"

!define PRODUCT_NAME "任务看板"
!define PRODUCT_NAME_EN "TaskFlow"
!define PRODUCT_VERSION "1.0.0"
!define PRODUCT_PUBLISHER "TaskFlow"
!define APP_EXE "任务看板.exe"
!define UNINST_EXE "Uninstall 任务看板.exe"
!define APP_SOURCE "${PROJECT_ROOT}\release-app"
!define APP_ICON "${PROJECT_ROOT}\build\icon.ico"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\TaskFlow"
!define PROJECT_ROOT "${__FILEDIR__}"

Name "${PRODUCT_NAME}"
OutFile "${PROJECT_ROOT}\release\TaskFlow-Setup-1.0.0.exe"
InstallDir "$LOCALAPPDATA\Programs\TaskFlow"
InstallDirRegKey HKCU "${UNINST_KEY}" "InstallLocation"
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 64
BrandingText "${PRODUCT_NAME} · ${PRODUCT_NAME_EN}"
ShowInstDetails hide
ShowUninstDetails show
XPStyle on
CRCCheck on

VIProductVersion "1.0.0.0"
VIAddVersionKey /LANG=2052 "ProductName" "${PRODUCT_NAME}"
VIAddVersionKey /LANG=2052 "FileDescription" "${PRODUCT_NAME} 安装程序"
VIAddVersionKey /LANG=2052 "FileVersion" "1.0.0.0"
VIAddVersionKey /LANG=2052 "ProductVersion" "1.0.0.0"
VIAddVersionKey /LANG=2052 "LegalCopyright" "TaskFlow"

!define MUI_ABORTWARNING
!define MUI_ICON "${APP_ICON}"
!define MUI_UNICON "${APP_ICON}"
!define MUI_WELCOMEPAGE_TITLE "安装 ${PRODUCT_NAME}"
!define MUI_WELCOMEPAGE_TEXT "一个安静、简单的三栏任务看板。$\r$\n$\r$\n安装到当前用户目录，不需要管理员权限。任务数据只保存在本机，不会上传。$\r$\n$\r$\n点击“下一步”开始安装。"
!define MUI_FINISHPAGE_TITLE "安装完成"
!define MUI_FINISHPAGE_TEXT "${PRODUCT_NAME} 已经安装到：$\r$\n$INSTDIR$\r$\n$\r$\n可以从开始菜单启动，也可以勾选下方选项立即启动。"
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "启动 ${PRODUCT_NAME}"
!define MUI_UNCONFIRMPAGE_TEXT_TOP "将卸载 ${PRODUCT_NAME}。默认保留任务数据，方便以后重新安装。"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH
!insertmacro MUI_LANGUAGE "SimpChinese"

Function .onInit
  SetShellVarContext current
FunctionEnd

Function un.onInit
  SetShellVarContext current
FunctionEnd

Section "Install"
  SetShellVarContext current
  CreateDirectory "$INSTDIR"
  SetOutPath "$INSTDIR"
  File /r "${APP_SOURCE}\*.*"
  WriteUninstaller "$INSTDIR\${UNINST_EXE}"

  CreateDirectory "$SMPROGRAMS\TaskFlow"
  CreateShortCut "$SMPROGRAMS\TaskFlow\${PRODUCT_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0 SW_SHOWNORMAL "" "任务看板：待开始 · 进行中 · 已完成"
  CreateShortCut "$SMPROGRAMS\TaskFlow\卸载${PRODUCT_NAME}.lnk" "$INSTDIR\${UNINST_EXE}"

  ClearErrors
  CreateShortCut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0 SW_SHOWNORMAL "" "任务看板：待开始 · 进行中 · 已完成"
  IfErrors 0 desktopDone
    DetailPrint "桌面快捷方式创建失败；请从开始菜单启动。"
  desktopDone:

  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${PRODUCT_NAME}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${PRODUCT_VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "${PRODUCT_PUBLISHER}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\${APP_EXE},0"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\${UNINST_EXE}"'
  WriteRegStr HKCU "${UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\${UNINST_EXE}" /S'
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
  WriteRegStr HKCU "Software\TaskFlow" "InstallPath" "$INSTDIR"
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\TaskFlow\${PRODUCT_NAME}.lnk"
  Delete "$SMPROGRAMS\TaskFlow\卸载${PRODUCT_NAME}.lnk"
  RMDir "$SMPROGRAMS\TaskFlow"
  DeleteRegKey HKCU "${UNINST_KEY}"
  DeleteRegKey HKCU "Software\TaskFlow"

  IfSilent keepData
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "是否同时删除任务看板的数据？$\r$\n$\r$\n选择“否”会保留任务，方便以后重新安装。" IDNO keepData
  RMDir /r "$APPDATA\taskflow-desktop"
  keepData:
  RMDir /r "$INSTDIR"
SectionEnd
