import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Colors } from '../theme/colors';
import { Radii, Type } from '../theme/tokens';
import { t } from '../i18n';

interface Props {
  onRefresh: () => void;
  onSetManualLocation: (placeName: string) => void;
  manualLocation: string | null;
}

/**
 * Fallback row shown when GPS is unavailable. Lets the user type a place name
 * ("Times Square, NYC") so downstream features can still run with that text
 * in place of real coordinates.
 */
export function ManualLocationRow({ onRefresh, onSetManualLocation, manualLocation }: Props) {
  const [locationInput, setLocationInput] = useState('');
  if (manualLocation) return null;
  const submit = () => {
    if (locationInput.trim()) {
      onSetManualLocation(locationInput.trim());
      setLocationInput('');
    }
  };
  return (
    <View style={styles.manualRow}>
      <Text style={[Type.bodySm, styles.gpsMsg]}>{t('chat.gpsUnavailable')}</Text>
      <View style={styles.inputRow}>
        <TextInput
          style={styles.manualInput}
          value={locationInput}
          onChangeText={setLocationInput}
          placeholder={t('chat.locationPlaceholder')}
          placeholderTextColor={Colors.textTertiary}
          returnKeyType="done"
          onSubmitEditing={submit}
        />
        <TouchableOpacity
          style={[styles.manualSet, !locationInput.trim() && { opacity: 0.5 }]}
          onPress={submit}
          disabled={!locationInput.trim()}
        >
          <Text style={[Type.chip, { color: '#FFFFFF' }]}>{t('chat.set')}</Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity onPress={onRefresh}>
        <Text style={[Type.bodySm, styles.retryLink]}>{t('chat.retryGps')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  manualRow: {
    backgroundColor: Colors.errorLight,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(198,70,70,0.25)',
  },
  gpsMsg: {
    color: Colors.error,
    marginBottom: 6,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  manualInput: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: Radii.md,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 13,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  manualSet: {
    backgroundColor: Colors.primary,
    borderRadius: Radii.md,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  retryLink: {
    color: Colors.error,
    marginTop: 6,
    textDecorationLine: 'underline',
  },
});
