; Ganchos do instalador do Call dos Games (Tauri).

!macro NSIS_HOOK_PREINSTALL
  ; Tira a versão antiga (Electron) se ela ainda estiver no PC, sem perguntar nada.
  ; As opções e os jogos adicionados são trazidos pelo app novo na primeira vez que ele abre.
  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\06d0bb1b-e2a7-53ae-a7f3-02304238633b" "QuietUninstallString"
  StrCmp $0 "" +3
    nsExec::Exec '$0'
    Pop $1
  ; o "abrir com o Windows" do app antigo
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.calldosgames.app"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Atualização sem perguntar (feita pelo próprio app): abre o app de novo no fim.
  IfSilent 0 +2
    Exec '"$INSTDIR\${MAINBINARYNAME}.exe"'
!macroend
