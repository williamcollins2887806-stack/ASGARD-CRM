/**
 * Разрешения Android в рантайме.
 *
 * D-405: в AndroidManifest.xml камера и микрофон объявлены, но с Android 6
 * (API 23) этого мало: опасные разрешения нужно запрашивать в рантайме.
 * Раньше запроса не было вообще — приложение открывалось молча, без диалогов,
 * а LiveKit при публикации получал пустой поток. На телеке это выглядело как
 * «камера/микрофон не работают», хотя причина — невыданное разрешение.
 *
 * На Android TV диалог показывается тем же механизмом; пультом выбирается
 * «Разрешить».
 */
import { PermissionsAndroid, Platform } from 'react-native';

export const MEDIA_PERMISSIONS = [
  PermissionsAndroid.PERMISSIONS.CAMERA,
  PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
];

/**
 * Запросить камеру и микрофон.
 * @returns {Promise<{camera: boolean, mic: boolean}>} что в итоге выдано
 */
export async function ensureMediaPermissions() {
  const denied = { camera: false, mic: false };
  if (Platform.OS !== 'android') {
    /* iOS запрашивает сам при первом обращении к устройству. */
    return { camera: true, mic: true };
  }

  try {
    /* Уже выданы — диалог не показываем повторно. */
    const hasCam = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA);
    const hasMic = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
    if (hasCam && hasMic) return { camera: true, mic: true };

    const result = await PermissionsAndroid.requestMultiple(MEDIA_PERMISSIONS);
    return {
      camera: result[PermissionsAndroid.PERMISSIONS.CAMERA] === PermissionsAndroid.RESULTS.GRANTED,
      mic: result[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === PermissionsAndroid.RESULTS.GRANTED,
    };
  } catch (e) {
    /* Не роняем приложение: без разрешений зал откроется только со звуком
       или вовсе без медиа — но человек увидит причину на экране ошибки. */
    console.warn('[TingTV] permissions', e && e.message);
    return denied;
  }
}

/** Человеческое объяснение, чего не хватает. */
export function permissionHint(granted) {
  const miss = [];
  if (!granted.camera) miss.push('камера');
  if (!granted.mic) miss.push('микрофон');
  if (!miss.length) return '';
  return 'Нет доступа: ' + miss.join(', ') +
    '. Настройки телевизора → Приложения → Тинг Зал → Разрешения.';
}
