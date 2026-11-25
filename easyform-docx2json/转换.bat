@echo off
rem ---------------------------------------------------------------
rem  Drag one or more .docx files onto this .bat to convert them
rem  into eaxy-form importable .json files (output goes to .\output)
rem  ASCII only on purpose: cmd reads .bat as GBK, Chinese breaks it.
rem ---------------------------------------------------------------
setlocal
cd /d "%~dp0"
if "%~1"=="" goto usage

node "%~dp0easyform-docx2json.js" %* --out "%~dp0output"
echo.
echo ================================================================
echo  Output folder: %~dp0output
echo  Next: open eaxy-form.html -^> "import json" -^> pick the .json
echo ================================================================
echo.
pause
exit /b 0

:usage
echo.
echo  Usage:
echo    1) Drag .docx file(s) onto this .bat
echo    2) Or run in a terminal:
echo         node easyform-docx2json.js "your-file.docx" --out output
echo.
echo  File naming (recommended): FormName__formCode__Hospital.docx
echo.
pause
exit /b 1
