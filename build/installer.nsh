; The tray app hides on WM_CLOSE, so the default "app is running" taskkill
; (which posts WM_CLOSE) does not exit it and the installer waits forever.
; --quit is a real exit and does not install a pending update (that would
; spawn a second installer on top of this one). taskkill is the fallback.

!macro customCheckAppRunning
  !insertmacro _QonoCloseRunning ${__COUNTER__}
!macroend

!macro _QonoCloseRunning ID
  StrCpy $R8 0
  qono_check_${ID}:
    !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
    ${if} $R0 != 0
      Goto qono_done_${ID}
    ${endIf}

    ${if} $R8 == 0
      ${if} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
        DetailPrint `Asking running "${PRODUCT_NAME}" to quit...`
        nsExec::Exec `"$INSTDIR\${APP_EXECUTABLE_FILENAME}" --quit`
        Pop $R9
      ${endIf}
    ${endIf}

    ${if} $R8 == 8
      DetailPrint `Closing running "${PRODUCT_NAME}"...`
      !ifdef INSTALL_MODE_PER_ALL_USERS
        nsExec::Exec `taskkill /im "${APP_EXECUTABLE_FILENAME}"`
      !else
        nsExec::Exec `"$SYSDIR\cmd.exe" /c taskkill /im "${APP_EXECUTABLE_FILENAME}" /fi "USERNAME eq %USERNAME%"`
      !endif
      Pop $R9
    ${endIf}

    ${if} $R8 == 12
      DetailPrint `Force closing running "${PRODUCT_NAME}"...`
      !ifdef INSTALL_MODE_PER_ALL_USERS
        nsExec::Exec `taskkill /f /im "${APP_EXECUTABLE_FILENAME}"`
      !else
        nsExec::Exec `"$SYSDIR\cmd.exe" /c taskkill /f /im "${APP_EXECUTABLE_FILENAME}" /fi "USERNAME eq %USERNAME%"`
      !endif
      Pop $R9
    ${endIf}

    IntOp $R8 $R8 + 1
    ${if} $R8 >= 18
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY qono_retry_${ID}
      Quit
      qono_retry_${ID}:
        StrCpy $R8 8
    ${else}
      Sleep 500
    ${endIf}
    Goto qono_check_${ID}
  qono_done_${ID}:
!macroend
