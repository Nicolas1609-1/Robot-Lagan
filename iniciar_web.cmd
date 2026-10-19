@echo off
setlocal
cd /d "%~dp0tools"
where npm.cmd >nul 2>nul
if errorlevel 1 (
 echo Instala Node.js 22.12 o superior y vuelve a abrir este archivo.
 pause
 exit /b 1
)
node -e "fetch('http://127.0.0.1:5173/',{signal:AbortSignal.timeout(1500)}).then(async r=>process.exit(r.ok&&(await r.text()).includes('Estudio de movimiento')?0:1)).catch(()=>process.exit(1))" >nul 2>nul
if not errorlevel 1 (
 start "" "http://127.0.0.1:5173/"
 exit /b 0
)
if not exist "node_modules\vite\bin\vite.js" (
 call npm.cmd ci --ignore-scripts
 if errorlevel 1 goto error
)
call npm.cmd run prepare
if errorlevel 1 goto error
echo.
echo Samurai web: http://127.0.0.1:5173/
echo Deja esta ventana abierta mientras uses la pagina.
call npm.cmd run dev -- --open
if errorlevel 1 goto error
exit /b 0
:error
echo.
echo No se pudo iniciar la pagina. Revisa el mensaje anterior.
pause
exit /b 1
