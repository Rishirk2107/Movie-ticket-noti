import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { COLORS, RADII, SHADOWS } from '../constants/theme';

export default function FloatingDock({
  activeTab,
  onSelectTab,
  watchCount = 0,
  isBackendHealthy = true,
}) {
  return (
    <View pointerEvents="box-none" style={styles.wrapper}>
      <View style={[styles.dock, SHADOWS.dock]}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'movies' && styles.tabActive]}
          onPress={() => onSelectTab('movies')}
          activeOpacity={0.85}
        >
          <Text style={[styles.tabLabel, activeTab === 'movies' && styles.tabLabelActive]}>
            Movies
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tab, activeTab === 'watches' && styles.tabActive]}
          onPress={() => onSelectTab('watches')}
          activeOpacity={0.85}
        >
          <Text style={[styles.tabLabel, activeTab === 'watches' && styles.tabLabelActive]}>
            Watches
          </Text>
          {watchCount > 0 && (
            <View
              style={[
                styles.countPill,
                activeTab === 'watches' && styles.countPillActive,
              ]}
            >
              <Text
                style={[
                  styles.countText,
                  activeTab === 'watches' && styles.countTextActive,
                ]}
              >
                {watchCount}
              </Text>
            </View>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tab, activeTab === 'activity' && styles.tabActive]}
          onPress={() => onSelectTab('activity')}
          activeOpacity={0.85}
        >
          <View
            style={[
              styles.liveDot,
              isBackendHealthy ? styles.liveDotOk : styles.liveDotWarn,
            ]}
          />
          <Text
            style={[
              styles.tabLabel,
              activeTab === 'activity' && styles.tabLabelActive,
            ]}
          >
            Activity
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 14,
    alignItems: 'center',
  },
  dock: {
    width: '100%',
    flexDirection: 'row',
    backgroundColor: COLORS.bgGlass,
    borderWidth: 1,
    borderColor: COLORS.borderGlass,
    borderRadius: RADII.full,
    padding: 6,
    gap: 6,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    paddingHorizontal: 10,
    borderRadius: RADII.full,
  },
  tabActive: {
    backgroundColor: COLORS.crimsonSubtle,
    borderWidth: 1,
    borderColor: COLORS.crimsonBorder,
  },
  tabLabel: {
    color: COLORS.textMuted,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  tabLabelActive: {
    color: COLORS.textMain,
  },
  countPill: {
    backgroundColor: COLORS.bgElevated,
    borderWidth: 1,
    borderColor: COLORS.borderGlass,
    borderRadius: RADII.full,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countPillActive: {
    backgroundColor: COLORS.crimson,
    borderColor: COLORS.crimson,
  },
  countText: {
    color: COLORS.textMain,
    fontSize: 11,
    fontWeight: '800',
  },
  countTextActive: {
    color: '#ffffff',
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  liveDotOk: {
    backgroundColor: COLORS.emerald,
  },
  liveDotWarn: {
    backgroundColor: COLORS.amber,
  },
});
