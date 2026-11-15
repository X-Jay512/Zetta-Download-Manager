@echo off
set ELECTRON_RUN_AS_NODE=1
"%~dp0..\..\node_modules\electron\dist\electron.exe" "%~dp0host.js" %*

