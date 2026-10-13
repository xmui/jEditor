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
; Always a log (%TEMP%\Setup Log …, or /LOG=), for an update that goes wrong
SetupLogging=yes
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
; Scanning (NAPS2.Sdk, LGPL-2.1): its DLLs, its 32-bit TWAIN helper and licence, beside the exe
Source: "{#PublishDir}\NAPS2.*"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#PublishDir}\licenses\*"; DestDir: "{app}\licenses"; Flags: ignoreversion

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

// jEditor lets go of its mutex a moment before it has really exited, and
// a running exe or a loaded DLL can't be replaced: an update that started
// copying then failed and rolled back. So the files are waited for too.
// A file is free once it can be opened by us alone.
function IsFree(const Path: String): Boolean;
var
  S: TFileStream;
begin
  Result := True;
  if not FileExists(Path) then exit;
  try
    S := TFileStream.Create(Path, fmOpenReadWrite or fmShareExclusive);
    S.Free;
  except
    Result := False;
  end;
end;

// jEditor.exe and the scanning files (NAPS2.*)
function BusyFile(const Dir: String): String;
var
  F: TFindRec;
begin
  Result := '';
  if not IsFree(Dir + '\jEditor.exe') then begin Result := 'jEditor.exe'; exit; end;
  if FindFirst(Dir + '\NAPS2.*', F) then
  try
    repeat
      if not IsFree(Dir + '\' + F.Name) then begin Result := F.Name; exit; end;
    until not FindNext(F);
  finally
    FindClose(F);
  end;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Dir, Busy: String;
  Waited: Integer;
begin
  Result := '';
  Dir := ExpandConstant('{app}');
  if not DirExists(Dir) then exit;
  Waited := 0;
  Busy := BusyFile(Dir);
  while (Busy <> '') and (Waited < 60) do
  begin
    Sleep(500);
    Waited := Waited + 1;
    Busy := BusyFile(Dir);
  end;
  if Busy <> '' then
  begin
    Log('Still in use after 30 s: ' + Busy);
    Result := 'jEditor is still running (' + Busy + ' is in use). Close it and try again.';
  end;
end;

var
  Installed: Boolean;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then Installed := True;
end;

// An update from jEditor that didn't install: jEditor (the version that was
// there) opens again and says so, with this log
procedure DeinitializeSetup();
var
  Code: Integer;
  Exe: String;
begin
  if Installed or not Relaunch() then exit;
  try
    Exe := ExpandConstant('{app}\jEditor.exe');
    if FileExists(Exe) then
      Exec(Exe, '--update-failed "' + ExpandConstant('{log}') + '"', '', SW_SHOWNORMAL, ewNoWait, Code);
  except
    // Not far enough to know where jEditor is: nothing to open
  end;
end;
