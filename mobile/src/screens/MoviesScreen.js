import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { COLORS, MONO_FONT, RADII, SHADOWS } from '../constants/theme';
import { getMovies } from '../services/api';
import { isValidHttpUrl } from '../utils/dateHelpers';
import WatchBuilderModal from './WatchBuilderModal';

const LANGUAGE_FILTERS = ['All', 'Tamil', 'English', 'Hindi', 'Telugu'];

function firstGenre(genreStr) {
  if (!genreStr) return '';
  return genreStr.split(/[|,/]+/).map((g) => g.trim()).filter(Boolean)[0] || '';
}

export default function MoviesScreen({
  backendUrl,
  pushToken,
  onWatchCreated,
  onOpenActivity,
}) {
  const [movies, setMovies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLang, setSelectedLang] = useState('All');

  const [showCodeEntry, setShowCodeEntry] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [manualError, setManualError] = useState('');

  const [builderMovie, setBuilderMovie] = useState(null);

  const loadMovies = useCallback(
    async ({ isPullRefresh = false } = {}) => {
      if (!isValidHttpUrl(backendUrl)) {
        setError('Configure a valid Backend Base URL in the Activity tab.');
        setLoading(false);
        setRefreshing(false);
        return;
      }

      if (isPullRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      try {
        const res = await getMovies(backendUrl);
        setMovies(Array.isArray(res?.movies) ? res.movies : []);
      } catch (err) {
        setError(err.message || 'Unable to load movies from BookMyShow.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [backendUrl]
  );

  useEffect(() => {
    loadMovies();
  }, [loadMovies]);

  const filteredMovies = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return movies.filter((m) => {
      if (selectedLang !== 'All') {
        const lang = (m.language || '').toLowerCase();
        if (!lang.includes(selectedLang.toLowerCase())) return false;
      }
      if (!q) return true;
      return (
        (m.title && m.title.toLowerCase().includes(q)) ||
        (m.language && m.language.toLowerCase().includes(q)) ||
        (m.genre && m.genre.toLowerCase().includes(q)) ||
        (m.event_code && m.event_code.toLowerCase().includes(q))
      );
    });
  }, [movies, searchQuery, selectedLang]);

  const movieRows = useMemo(() => {
    const rows = [];
    for (let i = 0; i < filteredMovies.length; i += 2) {
      rows.push(filteredMovies.slice(i, i + 2));
    }
    return rows;
  }, [filteredMovies]);

  const handleOpenManualCode = () => {
    const clean = manualCode.trim().toUpperCase();
    if (!/^ET\d{8}$/i.test(clean)) {
      setManualError('Enter a valid code like ET00491771.');
      return;
    }
    setManualError('');
    setShowCodeEntry(false);
    setBuilderMovie({ event_code: clean, title: clean });
  };

  return (
    <View style={styles.screen}>
      {/* Pinned Glassmorphic Header & Search */}
      <View style={styles.pinnedHeader}>
        <View style={styles.titleRow}>
          <View style={styles.titleWrap}>
            <Text style={styles.kicker}>CHENNAI LIVE CATALOG</Text>
            <Text style={styles.pageTitle}>Movies</Text>
          </View>
          <TouchableOpacity
            style={styles.etTriggerBtn}
            onPress={() => setShowCodeEntry((prev) => !prev)}
          >
            <Text style={styles.etTriggerText}>
              {showCodeEntry ? 'Hide Code' : 'Enter Event Code (ET...)'}
            </Text>
          </TouchableOpacity>
        </View>

        {showCodeEntry && (
          <View style={styles.etEntryCard}>
            <View style={styles.etRow}>
              <TextInput
                style={styles.etInput}
                value={manualCode}
                onChangeText={setManualCode}
                placeholder="ET00491771"
                placeholderTextColor={COLORS.textDim}
                autoCapitalize="characters"
                autoCorrect={false}
              />
              <TouchableOpacity style={styles.etGoBtn} onPress={handleOpenManualCode}>
                <Text style={styles.etGoText}>Open</Text>
              </TouchableOpacity>
            </View>
            {Boolean(manualError) && (
              <Text style={styles.etError}>{manualError}</Text>
            )}
          </View>
        )}

        <View style={styles.searchBar}>
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search movies, languages, genres, or ET codes..."
            placeholderTextColor={COLORS.textDim}
            autoCapitalize="none"
          />
          {Boolean(searchQuery) && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Text style={styles.clearText}>Clear</Text>
            </TouchableOpacity>
          )}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.langRow}
        >
          {LANGUAGE_FILTERS.map((lang) => {
            const active = selectedLang === lang;
            return (
              <TouchableOpacity
                key={lang}
                style={[styles.langPill, active && styles.langPillActive]}
                onPress={() => setSelectedLang(lang)}
              >
                <Text
                  style={[styles.langPillText, active && styles.langPillTextActive]}
                >
                  {lang}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Poster Grid */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.gridContainer}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadMovies({ isPullRefresh: true })}
            tintColor={COLORS.crimson}
            colors={[COLORS.crimson]}
          />
        }
      >
        {loading && movies.length === 0 ? (
          <View style={styles.centerCard}>
            <ActivityIndicator color={COLORS.crimson} size="small" />
            <Text style={styles.mutedText}>Fetching Chennai theatrical releases...</Text>
          </View>
        ) : error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
            <View style={styles.errorActions}>
              <TouchableOpacity
                style={styles.retryBtn}
                onPress={() => loadMovies()}
              >
                <Text style={styles.retryBtnText}>Retry</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.activityBtn}
                onPress={onOpenActivity}
              >
                <Text style={styles.activityBtnText}>Check Connection</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : filteredMovies.length === 0 ? (
          <View style={styles.centerCard}>
            <Text style={styles.emptyTitle}>No Movies Found</Text>
            <Text style={styles.mutedText}>
              Try another search term or tap Enter Event Code above.
            </Text>
          </View>
        ) : (
          <View style={styles.posterGrid}>
            {movieRows.map((row, rowIdx) => (
              <View key={`row-${rowIdx}`} style={styles.posterRow}>
                {row.map((m) => {
                  const genre = firstGenre(m.genre);
                  return (
                    <TouchableOpacity
                      key={m.event_code}
                      style={[styles.posterCard, SHADOWS.card]}
                      activeOpacity={0.86}
                      onPress={() => setBuilderMovie(m)}
                    >
                      <View style={styles.posterFrame}>
                        {m.poster ? (
                          <Image
                            source={{ uri: m.poster }}
                            style={styles.posterImg}
                            resizeMode="cover"
                          />
                        ) : (
                          <View style={styles.posterFallback}>
                            <Text style={styles.posterFallbackText}>BMS</Text>
                          </View>
                        )}
                        <View style={styles.codeBadge}>
                          <Text style={styles.codeBadgeText}>{m.event_code}</Text>
                        </View>
                      </View>

                      <View style={styles.cardBody}>
                        <Text numberOfLines={2} style={styles.movieTitle}>
                          {m.title}
                        </Text>
                        <View style={styles.pillsMeta}>
                          {Boolean(m.language) && (
                            <View style={styles.metaLangPill}>
                              <Text numberOfLines={1} style={styles.metaLangText}>
                                {m.language}
                              </Text>
                            </View>
                          )}
                          {Boolean(genre) && (
                            <View style={styles.metaGenrePill}>
                              <Text numberOfLines={1} style={styles.metaGenreText}>
                                {genre}
                              </Text>
                            </View>
                          )}
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                })}
                {row.length === 1 && <View style={styles.posterSpacer} />}
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <WatchBuilderModal
        visible={Boolean(builderMovie)}
        movie={builderMovie}
        backendUrl={backendUrl}
        pushToken={pushToken}
        onClose={() => setBuilderMovie(null)}
        onCreated={() => {
          setBuilderMovie(null);
          onWatchCreated();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: COLORS.bgBase,
  },
  pinnedHeader: {
    backgroundColor: COLORS.bgGlass,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderGlass,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    gap: 10,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  titleWrap: {
    flex: 1,
  },
  kicker: {
    color: COLORS.crimson,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.1,
  },
  pageTitle: {
    color: COLORS.textMain,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  etTriggerBtn: {
    backgroundColor: COLORS.bgElevated,
    borderWidth: 1,
    borderColor: COLORS.borderGlass,
    borderRadius: RADII.full,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  etTriggerText: {
    color: COLORS.textMain,
    fontSize: 11,
    fontWeight: '700',
  },
  etEntryCard: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderGlass,
    borderRadius: RADII.sm,
    padding: 10,
    gap: 6,
  },
  etRow: {
    flexDirection: 'row',
    gap: 8,
  },
  etInput: {
    flex: 1,
    backgroundColor: COLORS.bgInput,
    borderWidth: 1,
    borderColor: COLORS.borderGlass,
    borderRadius: RADII.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: COLORS.textMain,
    fontFamily: MONO_FONT,
    fontSize: 13,
  },
  etGoBtn: {
    backgroundColor: COLORS.crimson,
    borderRadius: RADII.sm,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  etGoText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  etError: {
    color: COLORS.danger,
    fontSize: 11,
    fontWeight: '600',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.bgInput,
    borderWidth: 1,
    borderColor: COLORS.borderGlass,
    borderRadius: RADII.md,
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    color: COLORS.textMain,
    fontSize: 14,
    paddingVertical: 9,
  },
  clearText: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '600',
    paddingLeft: 8,
  },
  langRow: {
    gap: 8,
  },
  langPill: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderGlass,
    borderRadius: RADII.full,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  langPillActive: {
    backgroundColor: COLORS.crimson,
    borderColor: COLORS.crimson,
  },
  langPillText: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  langPillTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  scroll: {
    flex: 1,
  },
  gridContainer: {
    padding: 14,
    paddingBottom: 96,
  },
  posterGrid: {
    gap: 12,
  },
  posterRow: {
    flexDirection: 'row',
    gap: 12,
  },
  posterCard: {
    flex: 1,
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderGlass,
    borderRadius: RADII.md,
    overflow: 'hidden',
  },
  posterSpacer: {
    flex: 1,
  },
  posterFrame: {
    position: 'relative',
    width: '100%',
    aspectRatio: 2 / 3,
    backgroundColor: COLORS.bgInput,
  },
  posterImg: {
    width: '100%',
    height: '100%',
  },
  posterFallback: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.bgElevated,
  },
  posterFallbackText: {
    color: COLORS.textDim,
    fontSize: 18,
    fontWeight: '800',
  },
  codeBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(9, 13, 22, 0.84)',
    borderWidth: 1,
    borderColor: COLORS.borderGlass,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  codeBadgeText: {
    color: COLORS.textMain,
    fontFamily: MONO_FONT,
    fontSize: 10,
    fontWeight: '700',
  },
  cardBody: {
    padding: 10,
    gap: 6,
  },
  movieTitle: {
    color: COLORS.textMain,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  pillsMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  metaLangPill: {
    backgroundColor: COLORS.crimsonSubtle,
    borderWidth: 1,
    borderColor: COLORS.crimsonBorder,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  metaLangText: {
    color: '#FCA5A5',
    fontSize: 10,
    fontWeight: '700',
  },
  metaGenrePill: {
    backgroundColor: COLORS.bgElevated,
    borderWidth: 1,
    borderColor: COLORS.borderGlass,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    maxWidth: 96,
  },
  metaGenreText: {
    color: COLORS.textMuted,
    fontSize: 10,
    fontWeight: '600',
  },
  centerCard: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderGlass,
    borderRadius: RADII.md,
    padding: 28,
    alignItems: 'center',
    gap: 10,
  },
  emptyTitle: {
    color: COLORS.textMain,
    fontSize: 16,
    fontWeight: '700',
  },
  mutedText: {
    color: COLORS.textMuted,
    fontSize: 13,
    textAlign: 'center',
  },
  errorCard: {
    backgroundColor: COLORS.dangerSubtle,
    borderWidth: 1,
    borderColor: COLORS.dangerBorder,
    borderRadius: RADII.md,
    padding: 16,
    gap: 12,
  },
  errorText: {
    color: COLORS.danger,
    fontSize: 13,
    fontWeight: '600',
  },
  errorActions: {
    flexDirection: 'row',
    gap: 10,
  },
  retryBtn: {
    backgroundColor: COLORS.crimson,
    borderRadius: RADII.sm,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  retryBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  activityBtn: {
    backgroundColor: COLORS.bgElevated,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    borderRadius: RADII.sm,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  activityBtnText: {
    color: COLORS.textMain,
    fontSize: 12,
    fontWeight: '700',
  },
});
