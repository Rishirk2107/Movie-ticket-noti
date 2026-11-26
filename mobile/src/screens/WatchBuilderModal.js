import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { COLORS, MONO_FONT, RADII, SHADOWS } from '../constants/theme';
import { createWatch, getSynopsis, linkDevice } from '../services/api';
import {
  addDays,
  daysBetween,
  fmt8toISO,
  formatDateCode,
  isValidHttpUrl,
  isValidIsoDate,
  MAX_DATE_RANGE_DAYS,
  todayIST,
} from '../utils/dateHelpers';

export default function WatchBuilderModal({
  visible,
  movie,
  backendUrl,
  pushToken,
  onClose,
  onCreated,
}) {
  const [step, setStep] = useState(1);

  const [synopsis, setSynopsis] = useState(null);
  const [loadingSynopsis, setLoadingSynopsis] = useState(false);
  const [synopsisError, setSynopsisError] = useState(null);
  const [selectedOption, setSelectedOption] = useState(null);

  const [label, setLabel] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [includePreview, setIncludePreview] = useState(false);
  const [intervalMinutes, setIntervalMinutes] = useState('10');
  const [emailInput, setEmailInput] = useState('');
  const [emails, setEmails] = useState([]);
  const [enableAlarmNow, setEnableAlarmNow] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const eventCode = movie?.event_code || '';
  const fallbackTitle = movie?.title || eventCode;

  const fetchSynopsisData = async (code) => {
    setLoadingSynopsis(true);
    setSynopsisError(null);
    setSynopsis(null);
    setSelectedOption(null);

    try {
      const data = await getSynopsis(backendUrl, code);
      setSynopsis(data);

      const movieName = data?.movie_name || fallbackTitle || code;
      const opts = Array.isArray(data?.options) ? data.options : [];
      if (opts.length > 0) {
        setSelectedOption(opts[0]);
        const suffix = opts[0].label || `${opts[0].language} - ${opts[0].dimension}`;
        setLabel(`${movieName} - ${suffix}`);
      } else {
        setLabel(movieName);
      }

      const today = todayIST();
      const effectiveStart =
        data?.opening_date_iso || data?.release_date_iso || today;
      const initialStart = effectiveStart >= today ? effectiveStart : today;
      setStartDate(initialStart);
      setEndDate(initialStart);
    } catch (err) {
      setSynopsisError(err.message || 'Failed to load formats and release dates.');
    } finally {
      setLoadingSynopsis(false);
    }
  };

  useEffect(() => {
    if (!visible || !eventCode) return;
    setStep(1);
    setIncludePreview(false);
    setIntervalMinutes('10');
    setEmails([]);
    setEmailInput('');
    setEnableAlarmNow(true);
    setSubmitError(null);
    fetchSynopsisData(eventCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, eventCode]);

  const handleSelectOption = (opt) => {
    setSelectedOption(opt);
    const movieName = synopsis?.movie_name || fallbackTitle || eventCode;
    const suffix = opt.label || `${opt.language} - ${opt.dimension}`;
    setLabel(`${movieName} - ${suffix}`);
  };

  const applyStartDateChange = (newStart) => {
    setStartDate(newStart);
    if (!isValidIsoDate(newStart)) return;
    const maxEnd = addDays(newStart, MAX_DATE_RANGE_DAYS);
    if (!isValidIsoDate(endDate) || endDate < newStart || endDate > maxEnd) {
      setEndDate(newStart);
    }
  };

  const handleStepDate = (which, delta) => {
    const current = which === 'start' ? startDate : endDate;
    const base = isValidIsoDate(current) ? current : todayIST();
    const next = addDays(base, delta);

    if (which === 'start') {
      if (next < todayIST()) return;
      applyStartDateChange(next);
    } else {
      if (isValidIsoDate(startDate)) {
        const diff = daysBetween(startDate, next);
        if (diff === null || diff < 0 || diff > MAX_DATE_RANGE_DAYS) return;
      }
      setEndDate(next);
    }
  };

  const handleTogglePreview = (checked) => {
    setIncludePreview(checked);
    if (!checked) return;
    const releaseIso =
      synopsis?.release_date_iso ||
      (synopsis?.release_date_8digit ? fmt8toISO(synopsis.release_date_8digit) : null);

    if (releaseIso && isValidIsoDate(releaseIso)) {
      const previewIso = addDays(releaseIso, -1);
      const today = todayIST();
      if (previewIso >= today && previewIso < startDate) {
        applyStartDateChange(previewIso);
      }
    }
  };

  const handleAddEmail = () => {
    const trimmed = emailInput.trim();
    if (!trimmed) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setSubmitError('Enter a valid email address.');
      return;
    }
    setSubmitError(null);
    if (!emails.includes(trimmed)) {
      setEmails((prev) => [...prev, trimmed]);
    }
    setEmailInput('');
  };

  const handleCreate = async () => {
    setSubmitError(null);

    if (!isValidHttpUrl(backendUrl)) {
      setSubmitError('Backend URL is invalid. Check the Activity tab.');
      return;
    }
    if (!label.trim()) {
      setSubmitError('Watch label is required.');
      return;
    }
    if (!isValidIsoDate(startDate)) {
      setSubmitError('Start date must be YYYY-MM-DD.');
      return;
    }
    const effectiveEnd = endDate.trim() || startDate;
    if (!isValidIsoDate(effectiveEnd)) {
      setSubmitError('End date must be YYYY-MM-DD.');
      return;
    }
    const diff = daysBetween(startDate, effectiveEnd);
    if (diff === null || diff < 0) {
      setSubmitError('End date cannot be earlier than start date.');
      return;
    }
    if (diff > MAX_DATE_RANGE_DAYS) {
      setSubmitError(`Date range cannot exceed ${MAX_DATE_RANGE_DAYS} days.`);
      return;
    }
    const intervalNum = parseInt(intervalMinutes, 10);
    if (Number.isNaN(intervalNum) || intervalNum < 1) {
      setSubmitError('Check interval must be at least 1 minute.');
      return;
    }

    const payload = {
      ref_event_code: selectedOption?.ref_event_code || eventCode,
      et_codes: selectedOption?.event_code || '*',
      language: (selectedOption?.language || 'english').toLowerCase(),
      label: label.trim(),
      start_date: startDate.trim(),
      end_date: effectiveEnd,
      interval_minutes: intervalNum,
      emails,
      include_preview: includePreview,
    };

    setSubmitting(true);
    try {
      const created = await createWatch(backendUrl, payload);
      if (enableAlarmNow && pushToken && created?._id) {
        try {
          await linkDevice(backendUrl, created._id, pushToken);
        } catch {
          // Watch created; user can retry linking on Watches tab
        }
      }
      onCreated();
    } catch (err) {
      setSubmitError(err.message || 'Failed to create watch.');
    } finally {
      setSubmitting(false);
    }
  };

  const hasEarlyOpening =
    Boolean(synopsis?.opening_date_iso) &&
    Boolean(synopsis?.release_date_iso) &&
    synopsis.opening_date_iso < synopsis.release_date_iso;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.safe}>
        <View style={styles.topHeader}>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>Cancel</Text>
          </TouchableOpacity>
          <View style={styles.stepPills}>
            <View style={[styles.stepPill, step === 1 && styles.stepPillActive]}>
              <Text
                style={[styles.stepPillText, step === 1 && styles.stepPillTextActive]}
              >
                1. Format
              </Text>
            </View>
            <View style={[styles.stepPill, step === 2 && styles.stepPillActive]}>
              <Text
                style={[styles.stepPillText, step === 2 && styles.stepPillTextActive]}
              >
                2. Schedule
              </Text>
            </View>
          </View>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
        >
          {/* STEP 1: Format & Language */}
          {step === 1 && (
            <View style={styles.section}>
              <Text style={styles.movieTitle}>
                {synopsis?.movie_name || fallbackTitle}
              </Text>
              <Text style={styles.movieCode}>{eventCode}</Text>

              {loadingSynopsis ? (
                <View style={styles.centerCard}>
                  <ActivityIndicator color={COLORS.crimson} size="small" />
                  <Text style={styles.mutedText}>
                    Loading formats and opening dates...
                  </Text>
                </View>
              ) : synopsisError ? (
                <View style={styles.errorCard}>
                  <Text style={styles.errorText}>{synopsisError}</Text>
                  <TouchableOpacity
                    style={styles.btnSecondary}
                    onPress={() => fetchSynopsisData(eventCode)}
                  >
                    <Text style={styles.btnSecondaryText}>Retry</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={[styles.card, SHADOWS.card]}>
                  {Boolean(synopsis?.release_date_str) && (
                    <Text style={styles.releaseLine}>
                      Wide Release: {synopsis.release_date_str}
                    </Text>
                  )}

                  {hasEarlyOpening && (
                    <View style={styles.earlyBanner}>
                      <Text style={styles.earlyBannerText}>
                        Early Screenings Open: {formatDateCode(synopsis.opening_date_iso)}
                      </Text>
                    </View>
                  )}

                  <Text style={[styles.fieldLabel, { marginTop: 14 }]}>
                    SELECT LANGUAGE & FORMAT
                  </Text>
                  <View style={styles.optionsList}>
                    {(synopsis?.options || []).map((opt, idx) => {
                      const active =
                        selectedOption?.label === opt.label &&
                        selectedOption?.event_code === opt.event_code;
                      return (
                        <TouchableOpacity
                          key={`${opt.event_code}-${idx}`}
                          style={[styles.optionChip, active && styles.optionChipActive]}
                          onPress={() => handleSelectOption(opt)}
                        >
                          <Text
                            style={[
                              styles.optionText,
                              active && styles.optionTextActive,
                            ]}
                          >
                            {opt.label || `${opt.language} - ${opt.dimension}`}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  <TouchableOpacity
                    style={[styles.btnPrimary, { marginTop: 18 }]}
                    onPress={() => setStep(2)}
                  >
                    <Text style={styles.btnPrimaryText}>
                      Continue to Schedule & Alarm
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}

          {/* STEP 2: Schedule & Alarm */}
          {step === 2 && (
            <View style={styles.section}>
              <View style={styles.stepBackRow}>
                <TouchableOpacity style={styles.backBtn} onPress={() => setStep(1)}>
                  <Text style={styles.backBtnText}>Back to Format</Text>
                </TouchableOpacity>
              </View>

              <View style={[styles.card, SHADOWS.card]}>
                {hasEarlyOpening && (
                  <View style={[styles.earlyBanner, { marginBottom: 14 }]}>
                    <Text style={styles.earlyBannerText}>
                      Opening Date: {synopsis.opening_date_iso} | Wide Release:{' '}
                      {synopsis.release_date_iso}
                    </Text>
                  </View>
                )}

                <Text style={styles.fieldLabel}>WATCH LABEL</Text>
                <TextInput
                  style={styles.input}
                  value={label}
                  onChangeText={setLabel}
                  placeholder="Watch Label"
                  placeholderTextColor={COLORS.textDim}
                />

                <Text style={styles.fieldLabel}>START DATE (IST YYYY-MM-DD)</Text>
                <View style={styles.stepperRow}>
                  <TouchableOpacity
                    style={styles.stepBtn}
                    onPress={() => handleStepDate('start', -1)}
                  >
                    <Text style={styles.stepBtnText}>-1d</Text>
                  </TouchableOpacity>
                  <TextInput
                    style={[styles.input, styles.monoInput, styles.dateInput]}
                    value={startDate}
                    onChangeText={applyStartDateChange}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={COLORS.textDim}
                  />
                  <TouchableOpacity
                    style={styles.stepBtn}
                    onPress={() => handleStepDate('start', 1)}
                  >
                    <Text style={styles.stepBtnText}>+1d</Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.fieldLabel}>
                  END DATE (MAX {MAX_DATE_RANGE_DAYS} DAYS)
                </Text>
                <View style={styles.stepperRow}>
                  <TouchableOpacity
                    style={styles.stepBtn}
                    onPress={() => handleStepDate('end', -1)}
                  >
                    <Text style={styles.stepBtnText}>-1d</Text>
                  </TouchableOpacity>
                  <TextInput
                    style={[styles.input, styles.monoInput, styles.dateInput]}
                    value={endDate}
                    onChangeText={setEndDate}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor={COLORS.textDim}
                  />
                  <TouchableOpacity
                    style={styles.stepBtn}
                    onPress={() => handleStepDate('end', 1)}
                  >
                    <Text style={styles.stepBtnText}>+1d</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.switchRow}>
                  <View style={styles.switchTextWrap}>
                    <Text style={styles.switchTitle}>
                      Include day-before preview (releaseDate - 1)
                    </Text>
                    <Text style={styles.switchSub}>
                      Monitor one day prior to wide release
                    </Text>
                  </View>
                  <Switch
                    value={includePreview}
                    onValueChange={handleTogglePreview}
                    trackColor={{ false: COLORS.bgElevated, true: COLORS.crimsonBorder }}
                    thumbColor={includePreview ? COLORS.crimson : COLORS.textMuted}
                  />
                </View>

                <Text style={[styles.fieldLabel, { marginTop: 12 }]}>
                  CHECK INTERVAL (MINUTES)
                </Text>
                <TextInput
                  style={styles.input}
                  value={intervalMinutes}
                  onChangeText={setIntervalMinutes}
                  keyboardType="numeric"
                  placeholder="10"
                  placeholderTextColor={COLORS.textDim}
                />

                <Text style={styles.fieldLabel}>ALERT EMAILS (OPTIONAL)</Text>
                <View style={styles.inlineRow}>
                  <TextInput
                    style={[styles.input, styles.flexInput]}
                    value={emailInput}
                    onChangeText={setEmailInput}
                    placeholder="name@example.com"
                    placeholderTextColor={COLORS.textDim}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    onSubmitEditing={handleAddEmail}
                  />
                  <TouchableOpacity style={styles.btnSecondary} onPress={handleAddEmail}>
                    <Text style={styles.btnSecondaryText}>Add</Text>
                  </TouchableOpacity>
                </View>

                {emails.length > 0 && (
                  <View style={styles.chipsWrap}>
                    {emails.map((addr) => (
                      <View key={addr} style={styles.emailChip}>
                        <Text style={styles.emailChipText}>{addr}</Text>
                        <TouchableOpacity
                          onPress={() =>
                            setEmails((prev) => prev.filter((e) => e !== addr))
                          }
                        >
                          <Text style={styles.emailRemoveText}>Remove</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                )}

                <View style={[styles.switchRow, styles.alarmBox]}>
                  <View style={styles.switchTextWrap}>
                    <Text style={styles.switchTitle}>
                      Enable Mobile Alarm on This Phone
                    </Text>
                    <Text style={styles.switchSub}>
                      {pushToken
                        ? 'Links this device immediately after creation'
                        : 'Push token unavailable; link later on Watches tab'}
                    </Text>
                  </View>
                  <Switch
                    value={Boolean(enableAlarmNow && pushToken)}
                    disabled={!pushToken}
                    onValueChange={setEnableAlarmNow}
                    trackColor={{ false: COLORS.bgElevated, true: COLORS.emeraldBorder }}
                    thumbColor={
                      enableAlarmNow && pushToken ? COLORS.emerald : COLORS.textMuted
                    }
                  />
                </View>

                {Boolean(submitError) && (
                  <View style={styles.errorCard}>
                    <Text style={styles.errorText}>{submitError}</Text>
                  </View>
                )}

                <TouchableOpacity
                  style={[
                    styles.btnPrimary,
                    { marginTop: 14 },
                    submitting && styles.btnDisabled,
                  ]}
                  disabled={submitting}
                  onPress={handleCreate}
                >
                  {submitting ? (
                    <ActivityIndicator color="#ffffff" size="small" />
                  ) : (
                    <Text style={styles.btnPrimaryText}>Create Watch</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: COLORS.bgBase,
  },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderGlass,
    backgroundColor: COLORS.bgCard,
  },
  closeBtn: {
    backgroundColor: COLORS.bgElevated,
    borderWidth: 1,
    borderColor: COLORS.borderGlass,
    borderRadius: RADII.sm,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  closeBtnText: {
    color: COLORS.textMain,
    fontSize: 12,
    fontWeight: '700',
  },
  stepPills: {
    flexDirection: 'row',
    gap: 8,
  },
  stepPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: RADII.full,
    backgroundColor: COLORS.bgBase,
    borderWidth: 1,
    borderColor: COLORS.borderGlass,
  },
  stepPillActive: {
    backgroundColor: COLORS.crimsonSubtle,
    borderColor: COLORS.crimsonBorder,
  },
  stepPillText: {
    color: COLORS.textMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  stepPillTextActive: {
    color: '#FCA5A5',
  },
  scroll: {
    flex: 1,
  },
  container: {
    padding: 16,
    paddingBottom: 34,
  },
  section: {
    gap: 12,
  },
  movieTitle: {
    color: COLORS.textMain,
    fontSize: 22,
    fontWeight: '800',
  },
  movieCode: {
    color: COLORS.textDim,
    fontFamily: MONO_FONT,
    fontSize: 12,
    marginTop: -6,
  },
  card: {
    backgroundColor: COLORS.bgCard,
    borderWidth: 1,
    borderColor: COLORS.borderGlass,
    borderRadius: RADII.md,
    padding: 16,
  },
  releaseLine: {
    color: COLORS.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  earlyBanner: {
    marginTop: 8,
    backgroundColor: COLORS.emeraldSubtle,
    borderWidth: 1,
    borderColor: COLORS.emeraldBorder,
    borderRadius: RADII.sm,
    padding: 10,
  },
  earlyBannerText: {
    color: COLORS.emerald,
    fontSize: 12,
    fontWeight: '700',
  },
  fieldLabel: {
    color: COLORS.textDim,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  optionsList: {
    gap: 8,
  },
  optionChip: {
    backgroundColor: COLORS.bgElevated,
    borderWidth: 1,
    borderColor: COLORS.borderGlass,
    borderRadius: RADII.sm,
    paddingHorizontal: 13,
    paddingVertical: 12,
  },
  optionChipActive: {
    backgroundColor: COLORS.crimsonSubtle,
    borderColor: COLORS.crimson,
  },
  optionText: {
    color: COLORS.textMain,
    fontSize: 14,
    fontWeight: '600',
  },
  optionTextActive: {
    color: '#FCA5A5',
    fontWeight: '700',
  },
  stepBackRow: {
    flexDirection: 'row',
  },
  backBtn: {
    backgroundColor: COLORS.bgElevated,
    borderWidth: 1,
    borderColor: COLORS.borderGlass,
    borderRadius: RADII.sm,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  backBtnText: {
    color: COLORS.textMain,
    fontSize: 12,
    fontWeight: '700',
  },
  input: {
    backgroundColor: COLORS.bgInput,
    borderWidth: 1,
    borderColor: COLORS.borderGlass,
    borderRadius: RADII.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: COLORS.textMain,
    fontSize: 14,
    marginBottom: 12,
  },
  monoInput: {
    fontFamily: MONO_FONT,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  stepBtn: {
    backgroundColor: COLORS.bgElevated,
    borderWidth: 1,
    borderColor: COLORS.borderGlass,
    borderRadius: RADII.sm,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  stepBtnText: {
    color: COLORS.textMain,
    fontSize: 13,
    fontWeight: '700',
  },
  dateInput: {
    flex: 1,
    textAlign: 'center',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderColor: COLORS.borderGlass,
  },
  alarmBox: {
    marginTop: 8,
    backgroundColor: COLORS.bgBase,
    borderWidth: 1,
    borderColor: COLORS.borderGlass,
    borderRadius: RADII.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  switchTextWrap: {
    flex: 1,
  },
  switchTitle: {
    color: COLORS.textMain,
    fontSize: 13,
    fontWeight: '700',
  },
  switchSub: {
    color: COLORS.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  flexInput: {
    flex: 1,
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 10,
  },
  emailChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.crimsonSubtle,
    borderWidth: 1,
    borderColor: COLORS.crimsonBorder,
    borderRadius: RADII.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  emailChipText: {
    color: '#FCA5A5',
    fontSize: 12,
    fontWeight: '600',
  },
  emailRemoveText: {
    color: COLORS.textMain,
    fontSize: 11,
    fontWeight: '700',
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
  mutedText: {
    color: COLORS.textMuted,
    fontSize: 13,
    textAlign: 'center',
  },
  errorCard: {
    marginTop: 8,
    backgroundColor: COLORS.dangerSubtle,
    borderWidth: 1,
    borderColor: COLORS.dangerBorder,
    borderRadius: RADII.sm,
    padding: 12,
    gap: 10,
  },
  errorText: {
    color: COLORS.danger,
    fontSize: 13,
    fontWeight: '600',
  },
  btnPrimary: {
    backgroundColor: COLORS.crimson,
    borderRadius: RADII.sm,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimaryText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  btnSecondary: {
    backgroundColor: COLORS.bgElevated,
    borderWidth: 1,
    borderColor: COLORS.borderStrong,
    borderRadius: RADII.sm,
    paddingHorizontal: 14,
    paddingVertical: 11,
    alignItems: 'center',
  },
  btnSecondaryText: {
    color: COLORS.textMain,
    fontSize: 13,
    fontWeight: '700',
  },
  btnDisabled: {
    opacity: 0.55,
  },
});
