@echo off
title Nest app: read the phone's log
cd /d "%~dp0"
set ADB=%USERPROFILE%\.bubblewrap\android_sdk\platform-tools\adb.exe
if not exist "%ADB%" ( echo The Android tools are not installed. & pause & exit /b )
echo.
echo  ==== Read why the Nest app does not open ====
echo.
echo  On the phone, once:
echo   1. Settings ^> About phone ^> Software information ^> tap "Build number" 7 times (Developer options on).
echo   2. Settings ^> Developer options ^> switch on "USB debugging".
echo   3. Connect the phone with a USB cable, unlock it, and tap "Allow" on "Allow USB debugging?".
echo.
pause
"%ADB%" devices
"%ADB%" logcat -c
echo.
echo Starting the Nest app on the phone...
> phone-log.txt (
  echo ===== devices =====
  "%ADB%" devices -l
  echo ===== phone =====
  "%ADB%" shell getprop ro.product.model
  "%ADB%" shell getprop ro.build.version.release
  echo ===== nest app =====
  "%ADB%" shell dumpsys package za.co.stewartza.nest | findstr /i "versionName versionCode"
  echo ===== chrome =====
  "%ADB%" shell dumpsys package com.android.chrome | findstr /i "versionName"
  echo ===== default browser =====
  "%ADB%" shell cmd role get-role-holders android.app.role.BROWSER
  echo ===== launch =====
  "%ADB%" shell am start -W -n za.co.stewartza.nest/za.co.stewartza.nest.LauncherActivity
)
timeout /t 8 >nul
>> phone-log.txt (
  echo ===== log =====
  "%ADB%" logcat -d -v time
)
echo.
echo Done. The log is saved as phone-log.txt in the app folder. Tell Claude "log saved".
pause
