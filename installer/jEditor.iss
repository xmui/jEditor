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
; An update started from jEditor (/RELAUNCH=1) opens it again when done
Filename: "{app}\jEditor.exe"; Flags: nowait; Check: Relaunch

[Code]
// jEditor holds this mutex while it runs (Program.cs). An update started
// from jEditor runs silently while jEditor closes itself, so it waits for
// it; run by hand, it asks for jEditor to be closed.
function WaitForJEditor(Silent: Boolean): Boolean;
var
  Waited: Integer;
begin
  Result := True;
  Waited := 0;
  while CheckForMutexes('jEditor.Windows.App') do
  begin
    if Silent then
    begin
      if Waited >= 60 then begin Result := False; exit; end;
      Sleep(500);
      Waited := Waited + 1;
    end
    else if MsgBox('jEditor is open. Close it, then click OK.', mbInformation, MB_OKCANCEL) = IDCANCEL then
    begin
      Result := False;
      exit;
    end;
  end;
end;

function InitializeSetup(): Boolean;
begin
  Result := WaitForJEditor(WizardSilent);
end;

function InitializeUninstall(): Boolean;
begin
  Result := WaitForJEditor(UninstallSilent);
end;

function Relaunch(): Boolean;
begin
  Result := WizardSilent and (ExpandConstant('{param:RELAUNCH|0}') = '1');
end;
