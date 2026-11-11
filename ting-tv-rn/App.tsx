/**
 * Ting TV — нативный клиент зала (React Native / Android TV).
 *
 * Двухэкранная навигация без библиотеки роутера: экран входа и зал. Так меньше
 * зависимостей и предсказуемее фокус по D-pad на телевизоре.
 */
import React, { useCallback, useState } from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import JoinScreen from './src/JoinScreen';
import MeetingScreen from './src/MeetingScreen';
import { TOKENS } from './src/api';

type Screen = { name: 'join' } | { name: 'room'; code: string; pin: string };

function App(): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>({ name: 'join' });
  const [busy] = useState(false);
  const [error] = useState('');

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
        <JoinScreen onJoin={handleJoin} busy={busy} error={error} />
      ) : (
        <MeetingScreen code={screen.code} pin={screen.pin} onLeave={handleLeave} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: TOKENS.bg },
});

export default App;
