import React, { useMemo } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Tile from './Tile';
import { COLORS, FONT, RADIUS, textShadow } from './theme';
import { gridFor } from './api';
import { People } from './icons';

const MARK = require('./assets/mark-round.png');

/**
 * Верхняя панель зала: логотип, название комнаты, таймер, счётчик участников.
 * Подложка — линейный градиент сверху, чтобы текст читался на любом видео.
 */
function TopBar({ title, timer, count, stateLabel }) {
  return (
    <View style={styles.topWrap} pointerEvents="none">
      <View style={styles.topLeft}>
        <Image source={MARK} style={styles.topMark} resizeMode="contain" />
        <View>
          <Text style={styles.topTitle} numberOfLines={1}>{title || 'Тинг'}</Text>
          <Text style={styles.topMeta}>{timer || '00:00'} · {stateLabel}</Text>
        </View>
      </View>
      <View style={styles.topRight}>
        <View style={styles.countPill}>
          <People size={20} color={COLORS.t1} />
          <Text style={styles.countText}>{count}</Text>
        </View>
      </View>
    </View>
  );
}

/** Правая панель участников: открывается по кнопке дока. */
export function PeopleDrawer({ tiles }) {
  return (
    <View style={styles.drawer}>
      <Text style={styles.drawerTitle}>Участники</Text>
      {tiles.map((t) => (
        <View key={t.id} style={styles.drawerRow}>
          <Image source={MARK} style={styles.drawerMark} resizeMode="contain" />
          <Text style={styles.drawerName} numberOfLines={1}>{t.label || 'Участник'}</Text>
          {t.muted ? <Text style={styles.drawerMuted}>выкл</Text> : null}
        </View>
      ))}
    </View>
  );
}

/**
 * Сцена зала. Раскладка повторяет веб-версию: 1 — крупно, 2 — рядом,
 * до 7 — крупный и полоса, дальше сетки 3×3, 4×3, 5×3.
 */
export default function Hall({ tiles, title, timer, stateLabel, mode, peopleOpen, connecting }) {
  const { cols } = gridFor(mode);

  const rows = useMemo(() => {
    if (cols <= 1) return tiles.length ? [tiles] : [];
    const out = [];
    for (let i = 0; i < tiles.length; i += cols) out.push(tiles.slice(i, i + cols));
    return out;
  }, [cols, tiles]);

  if (connecting) {
    return (
      <View style={styles.center}>
        <Image source={MARK} style={styles.bigMark} resizeMode="contain" />
        <Text style={styles.waitTitle}>Подключаемся к залу</Text>
        <Text style={styles.waitSub}>{title || ''}</Text>
      </View>
    );
  }

  if (!tiles.length) {
    return (
      <View style={styles.center}>
        <Image source={MARK} style={styles.bigMark} resizeMode="contain" />
        <Text style={styles.waitTitle}>Ожидание участников</Text>
        <Text style={styles.waitSub}>{title || 'Комната открыта'}</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <TopBar title={title} timer={timer} count={tiles.length} stateLabel={stateLabel} />
      <View style={[styles.stage, peopleOpen && styles.stageWithDrawer]}>
        {rows.map((row, ri) => (
          <View key={'r' + ri} style={styles.row}>
            {row.map((t) => (
              <Tile
                key={t.id}
                stall={t.track}
                isLocal={t.isLocal}
                isSpeaking={t.isSpeaking}
                label={t.label}
                muted={t.muted}
              />
            ))}
          </View>
        ))}
      </View>
      {peopleOpen ? <PeopleDrawer tiles={tiles} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 26,
    paddingTop: 18,
    paddingBottom: 14,
  },
  topLeft: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  topMark: { width: 46, height: 46, opacity: 0.95 },
  topTitle: {
    color: COLORS.t1,
    fontSize: FONT.h2,
    fontWeight: '800',
    letterSpacing: 0.2,
    ...textShadow,
  },
  topMeta: { color: COLORS.t2, fontSize: FONT.tiny, marginTop: 3, ...textShadow },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  countPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: RADIUS.pill,
    backgroundColor: 'rgba(10,13,18,0.78)',
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  countText: { color: COLORS.t1, fontSize: FONT.small, fontWeight: '700' },
  stage: { flex: 1, justifyContent: 'center', paddingHorizontal: 14, paddingTop: 74, paddingBottom: 108 },
  stageWithDrawer: { paddingRight: 340 },
  row: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  bigMark: { width: 132, height: 132, opacity: 0.85, marginBottom: 26 },
  waitTitle: { color: COLORS.t1, fontSize: FONT.h1, fontWeight: '800', ...textShadow },
  waitSub: { color: COLORS.t2, fontSize: FONT.body, marginTop: 10, textAlign: 'center' },
  drawer: {
    position: 'absolute',
    top: 74,
    right: 16,
    bottom: 108,
    width: 308,
    borderRadius: RADIUS.lg,
    backgroundColor: COLORS.panel,
    borderWidth: 1,
    borderColor: COLORS.line,
    padding: 18,
  },
  drawerTitle: { color: COLORS.t1, fontSize: FONT.h3, fontWeight: '800', marginBottom: 14 },
  drawerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  drawerMark: { width: 30, height: 30, opacity: 0.8 },
  drawerName: { color: COLORS.t1, fontSize: FONT.small, flex: 1 },
  drawerMuted: { color: COLORS.danger, fontSize: FONT.tiny, fontWeight: '700' },
});
