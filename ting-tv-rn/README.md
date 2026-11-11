# Тинг на ТВ: нативный клиент (React Native)

## Зачем это

На Android TV веб-клиент `/ting-tv/` физически не может работать с микрофоном.
Системный WebView открывает UVC-устройство, но получает **цифровую тишину**.
Логи с телека:

```
MIC published dev=?      ← публикация прошла
MIC level=0.0002 dev=?   ← уровень почти ноль
MIC level=0.0000 dev=?   ← ровно ноль
MIC no-device-with-signal
```

`label` пустой (`dev=?`) означает, что WebView не получил от Android метаданные
устройства. На том же ноутбуке эта камера работает — там обычный Chrome, а не
усечённый WebView телевизора. TrueConf работает, потому что берёт звук нативным
`AudioRecord`, минуя WebView.

Поэтому клиент зала переписан на React Native: это нативный процесс, звук идёт
через `AudioRecord`, камера через `Camera2` внутри `react-native-webrtc`.

## Два проекта

| Проект | Что это | Когда использовать |
|---|---|---|
| `ting-android/` | Старый APK на Capacitor + WebView | Пока RN-клиент не проверен. Плюс в нём живёт **зонд микрофона** |
| `ting-tv-rn/` | Новый нативный клиент на React Native | Целевой путь для зала |

## Шаг 1. Зонд микрофона (сделать первым)

Зонд отвечает на один вопрос: отдаёт ли UVC-микрофон данные через нативный
`AudioRecord`. Если нет — ни WebView, ни React Native не помогут, дело в
устройстве или прошивке телека.

Сборка:

```powershell
cd ting-android/android
$env:JAVA_HOME="C:\Java\jdk-17.0.2"
$env:ANDROID_HOME="C:\Android\sdk"
.\gradlew.bat assembleDebug
```

APK: `ting-android/android/app/build/outputs/apk/debug/app-debug.apk`

Запуск зонда на телеке (после установки APK):

```powershell
C:\Android\sdk\platform-tools\adb.exe connect <IP-телека>:5555
C:\Android\sdk\platform-tools\adb.exe install -r app-debug.apk
C:\Android\sdk\platform-tools\adb.exe shell am start -n com.asgard.ting.room/.AudioProbeActivity
```

Экран зонда показывает три цифры за 5 секунд: `peak`, `avg` и число
ненулевых сэмплов, затем вердикт:

| Вердикт | Что значит | Дальше |
|---|---|---|
| `ТИШИНА` | Устройство не отдаёт данные и нативно | Дело в камере или прошивке телека. RN не поможет, нужен другой микрофон |
| `ОЧЕНЬ ТИХО` | Данные есть, уровень мизерный | Возможен аппаратный дефект или сильное затухание. Проверить другую камеру |
| `ЗВУК ЕСТЬ` | Нативный путь работает | Идём в шаг 2 |

Открыть зонд можно и с пульта: он в списке приложений как «Зонд микрофона».

## Шаг 2. Клиент зала

```powershell
cd ting-tv-rn
npm install
```

Сборка APK:

```powershell
cd android
$env:JAVA_HOME="C:\Java\jdk-17.0.2"
$env:ANDROID_HOME="C:\Android\sdk"
.\gradlew.bat assembleDebug
```

**Первая сборка занимает 45–50 минут.** Это не зависание: Gradle сам
доустанавливает в SDK то, чего не хватало, и компилирует нативный WebRTC.

Что он скачивает при первом прогоне (проверено):

- NDK 27.1.12297006 (~1 ГБ)
- Android SDK Platform 37 (revision 2)
- CMake 3.22.1
- Build-Tools 37

Важная поправка к первоначальному выводу: `react-native-webrtc` берёт
**готовый** WebRTC из Maven (`io.github.webrtc-sdk:android-prefixed`), но
сборочный скрипт библиотеки всё равно требует NDK и CMake — их наличие
объявлено в `build.gradle`. То есть «NDK не понадобится» было неверно:
понадобится, но только как установленный компонент, а не для написания C++.

Готовый APK: `android/app/build/outputs/apk/debug/app-debug.apk`, ~166 МБ
(включает нативные библиотеки для arm64-v8a, armeabi-v7a, x86, x86_64).

Почему такой большой: WebRTC несёт `.so` под четыре архитектуры. Для телека
можно оставить только `arm64-v8a` — размер упадёт примерно до 60 МБ. Делается
через `reactNativeArchitectures=arm64-v8a` в `gradle.properties`.

Установка:

```powershell
C:\Android\sdk\platform-tools\adb.exe install -r android\app\build\outputs\apk\debug\app-debug.apk
```

## Что уже работает в клиенте

- экран входа: код комнаты и PIN, фокус по D-pad
- получение токена у бэкенда (`/api/thing/public/:code/guest-token`)
- подключение к LiveKit, аудиосессия Android
- раскладки зала: `wait`, `spot`, `dual`, `spot-rail`, `g3`, `g4`, `g5`
- плитки 16:9 без обрезки (`objectFit: contain`)
- индикатор речи рамкой, индикатор выключенного микрофона
- выход с отправкой `/leave`

## Что осталось

- проверка на реальном телеке (нужен `adb connect`)
- публикация камеры и микрофона — сейчас публикуется через `LiveKitRoom` с
  флагами `audio` и `video`; после проверки зонда надо убедиться, что камера
  берётся та, что встроена в UVC-устройство
- телеметрия с `surface='tv'` в новый клиент (в веб-версии уже есть)
- вывод `/ting-tv/` из эксплуатации после подтверждения

## Важное следствие

RN-клиент **не обновляется сам** с прода. Каждая правка требует пересборки APK
и установки на телек. Это цена за нативный микрофон: веб-версия обновлялась
сама через `server.url`, но именно этот путь и был причиной тишины.
