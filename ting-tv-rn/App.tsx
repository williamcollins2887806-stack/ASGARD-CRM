/**
 * Ting TV — нативный клиент зала (React Native / Android TV).
 *
 * Три экрана без библиотеки роутера: вход, замер скорости, зал. Так меньше
 * зависимостей и предсказуемее поведение фокуса по D-pad на телевизоре.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import JoinScreen from './src/JoinScreen';
import MeetingScreen from './src/MeetingScreen';
import SpeedScreen from './src/SpeedScreen';
import Backdrop from './src/Backdrop';
import { ensureMediaPermissions } from './src/permissions';
import { COLORS } from './src/theme';

type Screen =
  | { name: 'join' }
  | { name: 'speed'; code: string }
  | { name: 'room'; code: string; pin: string };

function App(): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>({ name: 'join' });
  /* Код нужен экрану замера, чтобы измерить отдачу на реальный эндпоинт
     комнаты, а не в пустоту. */
  const [lastCode, setLastCode] = useState('');

  /* D-405: спрашиваем камеру и микрофон сразу при запуске, а не в момент
     подключения. На телеке человек видит системный диалог и пультом даёт
     «Разрешить». Повторно диалог не покажется, если уже выдано. */
  useEffect(() => {
    ensureMediaPermissions().catch(() => {});
  }, []);

  const handleJoin = useCallback((code: string, pin: string) => {
    setLastCode(code);
    setScreen({ name: 'room', code, pin });
  }, []);

  const handleLeave = useCallback(() => setScreen({ name: 'join' }), []);

  return (
    <View style={styles.root}>
      <StatusBar hidden />
      <Backdrop>
        {screen.name === 'join' ? (
          <JoinScreen
            onJoin={handleJoin}
            busy={false}
            error=""
            onSpeed={() => setScreen({ name: 'speed', code: lastCode })}
          />
        ) : null}
        {screen.name === 'speed' ? (
          <SpeedScreen code={screen.code} onBack={handleLeave} />
        ) : null}
        {screen.name === 'room' ? (
          <MeetingScreen code={screen.code} pin={screen.pin} onLeave={handleLeave} />
        ) : null}
      </Backdrop>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg0 },
});

export default App;
