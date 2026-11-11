/**
 * Ting TV — нативный клиент зала (React Native / Android TV).
 *
 * Два экрана без библиотеки роутера: вход и зал. Так меньше зависимостей и
 * предсказуемее поведение фокуса по D-pad на телевизоре.
 */
import React, { useCallback, useState } from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import JoinScreen from './src/JoinScreen';
import MeetingScreen from './src/MeetingScreen';
import Backdrop from './src/Backdrop';
import { COLORS } from './src/theme';

type Screen = { name: 'join' } | { name: 'room'; code: string; pin: string };

function App(): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>({ name: 'join' });

  const handleJoin = useCallback((code: string, pin: string) => {
    setScreen({ name: 'room', code, pin });
  }, []);

  const handleLeave = useCallback(() => {
    setScreen({ name: 'join' });
  }, []);

  return (
    <View style={styles.root}>
      <StatusBar hidden />
      {screen.name === 'join' ? (
        <Backdrop>
          <JoinScreen onJoin={handleJoin} busy={false} error="" />
        </Backdrop>
      ) : (
        <MeetingScreen code={screen.code} pin={screen.pin} onLeave={handleLeave} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg0 },
});

export default App;
