# ASGARD Ting TV APK builder (same toolchain as build_apk.ps1)
# Requires: C:\Java\jdk-17.0.2 + C:\Android\sdk
$ErrorActionPreference = "Stop"
$env:JAVA_HOME = "C:\Java\jdk-17.0.2"
$env:ANDROID_HOME = "C:\Android\sdk"
$env:PATH = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\cmdline-tools\latest\bin;$env:ANDROID_HOME\platform-tools;$env:PATH"
$Root = "C:\Users\Nikita-ASGARD\ASGARD-CRM\ting-android"
$Repo = "C:\Users\Nikita-ASGARD\ASGARD-CRM"

if (!(Test-Path "$env:JAVA_HOME\bin\java.exe")) { throw "JDK 17 not found at $env:JAVA_HOME" }
if (!(Test-Path "$env:ANDROID_HOME\platforms\android-34")) { throw "Android SDK incomplete at $env:ANDROID_HOME" }

# Пересобрать PNG-иконки (full-bleed, без плитки в круге)
python "$Repo\tools\gen_ting_tv_icons.py"
Copy-Item -Force "$Root\android\app\src\main\res\drawable-xhdpi\tv_banner.png" `
  "$Root\android\app\src\main\res\drawable\tv_banner.png"

Set-Location $Root
npx cap sync android
Set-Content -Path "$Root\android\local.properties" -Value "sdk.dir=C\:\\Android\\sdk" -Encoding Ascii

# restore TV native bits if sync wiped them (НЕ трогаем иконки/banner PNG)
$bak = Join-Path $Root "_native_bak"
if (Test-Path "$bak\AndroidManifest.xml") {
  Copy-Item "$bak\AndroidManifest.xml" "$Root\android\app\src\main\AndroidManifest.xml" -Force
}
if (Test-Path "$bak\MainActivity.java") {
  Copy-Item "$bak\MainActivity.java" "$Root\android\app\src\main\java\com\asgard\ting\room\MainActivity.java" -Force
}

Set-Location "$Root\android"
.\gradlew.bat assembleDebug --no-daemon
$apk = "$Root\android\app\build\outputs\apk\debug\app-debug.apk"
if (!(Test-Path $apk)) { throw "APK not produced" }
Copy-Item $apk "$env:USERPROFILE\Desktop\asgard-ting-tv.apk" -Force
Copy-Item $apk "$Repo\public\asgard-ting-tv.apk" -Force
$mb = [math]::Round((Get-Item $apk).Length / 1MB, 2)
Write-Host "OK asgard-ting-tv.apk ($mb MB) -> Desktop + public/" -ForegroundColor Green
