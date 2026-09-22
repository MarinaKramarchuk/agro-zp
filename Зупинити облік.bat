@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo Зупиняю Агро-Зарплату...
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*runtime\\node.exe*server.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"

echo Готово.
echo.
echo Це вікно закриється само за 3 секунди.
timeout /t 3 /nobreak >nul
