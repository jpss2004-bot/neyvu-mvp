@echo off
setlocal
cd /d "%~dp0"
if not exist "%~dp0runtime\node.exe" (
 echo SchoolVault needs the extracted folder, not the ZIP preview.
 echo Close this window. Right-click the downloaded ZIP and choose Extract all.
 echo Then open Start SchoolVault.cmd from the extracted folder.
 echo If you already extracted it, check whether Windows Security removed a file.
 echo Do not disable Windows protection. Report the block in SchoolVault instead.
 pause
 exit /b 1
)
if "%~1"=="--verify" (
 "%~dp0runtime\node.exe" --version
 exit /b
)
"%~dp0runtime\node.exe" "%~dp0companion.mjs"
pause
