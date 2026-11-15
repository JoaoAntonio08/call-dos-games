' Liga o banco do Call dos Games numa janela oculta e espera ele terminar.
' Quem chama: a tarefa agendada "Call dos Games - banco" (veja banco-tarefa.ps1).
Set fso = CreateObject("Scripting.FileSystemObject")
backend = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
pg = """C:\Program Files\PostgreSQL\15\bin\postgres.exe"" -D """ & backend & "\.pgdata"" -p 5433 -c listen_addresses=127.0.0.1"
cmd = "cmd.exe /c """ & pg & " >> """ & backend & "\logs\postgres.log"" 2>&1"""
' 0 = janela oculta; True = espera o banco terminar (se ele cair, a tarefa religa)
WScript.Quit CreateObject("WScript.Shell").Run(cmd, 0, True)
