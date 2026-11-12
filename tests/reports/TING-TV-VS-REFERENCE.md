# ТВ-клиент против эталона LiveKit

Сверка `ting-tv-rn` с официальным примером
[`livekit-examples/react-native-meet`](https://github.com/livekit-examples/react-native-meet)
(далее — Эталон). Версия SDK у нас новее (`@livekit/react-native` 3.1.0,
RN 0.88), у Эталона — 2.1.0 / RN 0.73, поэтому сравниваем не версии, а
**решения**: какие вызовы обязательны и в каком порядке.

Дата сверки: 12.11.2026.

## Сводная таблица

| # | Решение | Эталон | У нас | Вывод |
|---|---|---|---|---|
| 1 | Инициализация аудиоустройства | `LiveKitReactNative.setup(this)` в `MainApplication.onCreate` | добавлено (D-414) | **ИСПРАВЛЕНО** |
| 2 | Регистрация WebRTC-глобалов | `registerGlobals()` в `index.tsx` до `registerComponent` | добавлено (D-404) | **ИСПРАВЛЕНО** |
| 3 | Явное включение камеры/микрофона | `localParticipant.setCameraEnabled()` из UI | добавлено (D-406) | **ИСПРАВЛЕНО** |
| 4 | Список треков | `withPlaceholder: true, onlySubscribed: false` | `useTracks([...])` без опций | **РАСХОЖДЕНИЕ** |
| 5 | Стабильность раскладки | `useVisualStableUpdate(tracks, 5)` | нет | **РАСХОЖДЕНИЕ** |
| 6 | Рендер видео | `<VideoTrack trackRef={...}>` | `RTCView` + `mediaStreamTrack.toURL()` | эквивалентно |
| 7 | Аудиосессия | `AudioSession.startAudioSession()` в `useEffect` | есть | соответствует |
| 8 | Разрешения Android | нет (пример не для ТВ) | `PermissionsAndroid.requestMultiple` | наше лучше |

## 1. Инициализация аудиоустройства — КРИТИЧНО

Эталон, `MainApplication.kt`:

```kotlin
override fun onCreate() {
  LiveKitReactNative.setup(this);
  super.onCreate()
  ...
}
```

У нас было — только `loadReactNative(this)`. Проверка в исходнике библиотеки:

```kotlin
val audioDeviceModule: JavaAudioDeviceModule
  get() = this.adm ?: throw IllegalStateException(
    "Audio device module is not initialized! " +
    "Did you remember to call LiveKitReactNative.setup in your Application.onCreate?")
```

Автолинкинг `setup` **не вызывает**: `LivekitReactNativePackage` создаёт
только нативный модуль. Аудиоустройство не было инициализировано никогда —
отсюда неработающие камера и микрофон при выданных разрешениях.

## 2. Список треков — расхождение

Эталон:

```tsx
const tracks = useTracks(
  [
    { source: Track.Source.Camera, withPlaceholder: true },
    { source: Track.Source.ScreenShare, withPlaceholder: false },
  ],
  { onlySubscribed: false }
);
```

`withPlaceholder: true` создаёт плитку **до** прихода медиа: участник виден
сразу, аватар сменяется видео по факту подписки. Без placeholder плитка
появляется только вместе с треком — участник «пропадает» на время
переподключения.

Важно: `onlySubscribed: false` у Эталона работает **вместе** с placeholder.
Раньше я убрал этот флаг, посчитав его причиной пустых плиток (D-406). Причина
была другая — отсутствие placeholder. Правильная комбинация: `false` + placeholder.

## 3. Стабильность раскладки — расхождение

Эталон:

```tsx
const stableTracks = useVisualStableUpdate(tracks, 5);
```

`useVisualStableUpdate` удерживает порядок элементов при обновлениях, чтобы
плитки не переезжали с места на место. У нас `Hall` пересобирает сетку на
каждое изменение массива треков — при подключении нового участника все
существующие плитки меняют позицию, видео «прыгает».

## 4. Рендер видео — эквивалентно

Эталон использует компонент `VideoTrack`, который внутри делает:

```tsx
streamURL={mediaStream?.toURL() ?? ''}
```

Наш [Tile.js](../ting-tv-rn/src/Tile.js) делает то же самое:

```js
const streamURL = stall.mediaStreamTrack.toURL();
<RTCView streamURL={streamURL} objectFit="contain" mirror={isLocal} />
```

Функциональной разницы нет. Переписывать на `VideoTrack` не нужно: наш
вариант даёт контроль над подписью, индикатором речи и состоянием «камера
выключена», которые в `Tile` реализованы вручную.

## 5. Что есть только у нас

Эталон — демо, в нём нет:

- кодов комнат и PIN (вход по коду из CRM);
- телевизионного фокуса по D-pad (у Эталона мобильные тапы);
- вёрстки под 1080p и плотность 2.0;
- рантайм-разрешений Android;
- телеметрии `surface='tv'` в `thing_client_metrics`;
- удалённого лога в journald.

Это не «отставание», это наш продуктовый слой поверх SDK.

## Приоритет исправлений

| Приоритет | Пункт | Последствие, если не исправить |
|---|---|---|
| Высокий | `withPlaceholder` + `onlySubscribed: false` | участник не появляется до прихода трека |
| Средний | `useVisualStableUpdate` | видео перескакивает при входе нового участника |
| Низкий | перевод на `VideoTrack` | нет последствий, разницы в поведении нет |
