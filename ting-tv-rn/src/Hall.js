import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Tile from './Tile';
import { TOKENS, TYPE, gridFor } from '../api';

/**
 * Сцена зала. Плитки раскладываются по числу участников той же логикой, что
 * в веб-версии: 1 → spot, 2 → dual, до 7 → spot-rail, дальше сетки g3/g4/g5.
 */
export default function Hall({ mode, tiles, title, connecting }) {
  const { cols } = gridFor(mode);

  const rowsGroups = useMemo(() => {
    if (cols <= 1) return [tiles];
    const out = [];
    for (let i = 0; i < tiles.length; i += cols) out.push(tiles.slice(i, i + cols));
    return out;
  }, [cols, tiles]);

  if (connecting) {
    return (
      <View style={styles.center}>
        <Text style={styles.wait}>Подключаемся к залу…</Text>
      </View>
    );
  }

  if (mode === 'wait' || !tiles.length) {
    return (
      <View style={styles.center}>
        <Text style={styles.wait}>Ожидание участников</Text>
        {title ? <Text style={styles.sub}>{title}</Text> : null}
      </View>
    );
  }

  return (
    <View style={styles.stage}>
      {rowsGroups.map((row, ri) => (
        <View key={'r' + ri} style={styles.row}>
          {row.map((t) => (
            <Tile
              key={t.id}
              participant={t.participant}
              track={t.track}
              isLocal={t.isLocal}
              isSpeaking={t.isSpeaking}
              label={t.label}
              muted={t.muted}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1, justifyContent: 'center', padding: 12 },
  row: { flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  wait: { color: TOKENS.text, fontSize: TYPE.h1, fontWeight: '700' },
  sub: { color: TOKENS.textMuted, fontSize: TYPE.body, marginTop: 12 },
});
