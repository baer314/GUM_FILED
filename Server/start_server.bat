@echo off
setlocal
chcp 65001 >nul

:: 1. 배치 파일이 위치한 폴더로 이동
cd /d "%~dp0"
if errorlevel 1 (
    echo [오류] 배치 파일이 위치한 폴더로 이동하는 데 실패했습니다.
    pause
    exit /b 1
)

:: 2. IP 주소 입력 받기 (실행 시 매개변수가 없으면 직접 입력 요청)
set "IP_ADDR=%~1"
if "%IP_ADDR%"=="" (
    set /p "IP_ADDR=ip입력 : "
)

:: 앞뒤/중간 공백 제거 후 미입력 여부 확인
if defined IP_ADDR set "IP_ADDR=%IP_ADDR: =%"
if "%IP_ADDR%"=="" (
    echo [오류] IP 주소가 입력되지 않았습니다.
    pause
    exit /b 1
)

:: 3. npm.cmd 존재 여부 확인
where npm.cmd >nul 2>&1
if errorlevel 1 (
    echo [오류] npm.cmd를 찾을 수 없습니다. Node.js 설치 및 환경 변수^(PATH^)를 확인해주세요.
    pause
    exit /b 1
)

:: 4. package.json 존재 여부 확인
if not exist "package.json" (
    echo [오류] 현재 폴더^(%CD%^)에 package.json 파일이 존재하지 않습니다.
    pause
    exit /b 1
)

:: 5. 환경 변수 설정
set "HOST=0.0.0.0"
set "PUBLIC_BASE_URL=http://%IP_ADDR%:8080"
set "TRANSPORT=relay"

echo ========================================
echo 실행 폴더      : %CD%
echo HOST           : %HOST%
echo PUBLIC_BASE_URL: %PUBLIC_BASE_URL%
echo TRANSPORT      : %TRANSPORT%
echo ========================================
echo 서버를 시작합니다...

:: 6. npm.cmd start 실행 (call을 사용해야 종료 후 오류 코드를 받을 수 있음)
call npm.cmd start
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
    echo.
    echo [오류] npm.cmd start 실행 중 오류가 발생했습니다. ^(오류 코드: %EXIT_CODE%^)
    pause
    exit /b %EXIT_CODE%
)

endlocal
exit /b 0
