; jEditor's installer (Inno Setup 6). Built by scripts/build.ps1:
;   iscc /DAppVersion=1.18.1 /DPublishDir=..\dist\publish /DOutputDir=..\dist installer\jEditor.iss
;
; Installs for the current user only, so it never asks for admin rights:
; the app goes in %LOCALAPPDATA%\Programs\jEditor, the shortcut in the
; user's Start menu, and the uninstall entry in HKCU. jEditor's own data
; (%LOCALAPPDATA%\jEditor: settings, recent orders, caches) is kept when
; uninstalling or updating.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef PublishDir
  #define PublishDir "..\dist\publish"
#endif
#ifndef OutputDir
  #define OutputDir "..\dist"
#endif

[Setup]
; Never change AppId: it's how an update finds the installed copy
AppId={{3DE12F63-EDF7-4FD0-B174-E0BD0FA2421E}
AppName=jEditor
AppVersion={#AppVersion}
AppVerName=jEditor {#AppVersion}
AppPublisher=jEditor
VersionInfoVersion={#AppVersion}
PrivilegesRequired=lowest
DefaultDirName={autopf}\jEditor
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableReadyPage=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
OutputDir={#OutputDir}
OutputBaseFilename=jEditor-Setup-{#AppVersion}
SetupIconFile=..\src\jEditor.ico
UninstallDisplayIcon={app}\jEditor.exe
UninstallDisplayName=jEditor
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; Asks to close jEditor first if it's running (the mutex is in Program.cs)
AppMutex=jEditor.Windows.App
CloseApplications=yes

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[InstallDelete]
; The UI is replaced as a whole on update, so no old file lingers
Type: filesandordirs; Name: "{app}\app"

[Files]
Source: "{#PublishDir}\jEditor.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#PublishDir}\app\*"; DestDir: "{app}\app"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\jEditor"; Filename: "{app}\jEditor.exe"
Name: "{autodesktop}\jEditor"; Filename: "{app}\jEditor.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\jEditor.exe"; Description: "{cm:LaunchProgram,jEditor}"; Flags: nowait postinstall skipifsilent
