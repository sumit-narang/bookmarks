/**
 * Shared styles for modal screens
 */

import { StyleSheet } from 'react-native';
import { colors } from './colors';
import { typography } from './typography';

export const ModalStyles = StyleSheet.create({
  // Container with semi-transparent backdrop
  container: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },

  // Modal sheet
  modalSheet: {
    backgroundColor: colors.cardBackground,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 34,
  },

  // Drag handle
  modalHandle: {
    width: 36,
    height: 5,
    backgroundColor: colors.inputBackground,
    borderRadius: 3,
    alignSelf: 'center',
    marginBottom: 20,
  },

  // Modal title (centered)
  modalTitle: {
    ...typography.heading,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: 24,
  },

  // Modal header with buttons
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },

  modalTitleFlex: {
    ...typography.heading,
    color: colors.textPrimary,
    textAlign: 'center',
    flex: 1,
  },

  // Header buttons
  headerBtn: {
    minWidth: 60,
  },

  headerBtnText: {
    ...typography.body,
    color: colors.primary,
  },

  headerBtnTextDisabled: {
    color: colors.textSecondary,
  },

  // Close button (circular)
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.inputBackground,
    alignItems: 'center',
    justifyContent: 'center',
  },

  placeholder: {
    width: 32,
  },

  // Collection option buttons
  collectionOptions: {
    gap: 12,
  },

  collectionOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 16,
    backgroundColor: colors.inputBackground,
    borderRadius: 16,
  },

  optionIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },

  optionIconNew: {
    backgroundColor: colors.primary,
  },

  optionIconExisting: {
    backgroundColor: colors.purple,
  },

  optionContent: {
    flex: 1,
  },

  optionTitle: {
    ...typography.subheading,
    color: colors.textPrimary,
  },

  optionSubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 2,
  },

  // Input styles
  inputSection: {
    marginBottom: 24,
  },

  inputLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    marginBottom: 8,
  },

  textInput: {
    backgroundColor: colors.inputBackground,
    borderRadius: 12,
    padding: 16,
    ...typography.body,
    color: colors.textPrimary,
  },

  // Collections list
  collectionsList: {
    gap: 8,
    maxHeight: 350,
  },

  collectionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    backgroundColor: colors.inputBackground,
    borderRadius: 12,
  },

  collectionThumb: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: '#48484A',
  },

  collectionInfo: {
    flex: 1,
  },

  collectionName: {
    ...typography.body,
    fontWeight: '500',
    color: colors.textPrimary,
  },

  collectionCount: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 2,
  },

  collectionCheck: {
    opacity: 0,
  },

  collectionCheckVisible: {
    opacity: 1,
  },

  // Place preview section (shown at top of modals)
  placePreview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    backgroundColor: colors.inputBackground,
    borderRadius: 12,
    marginBottom: 20,
  },

  placePreviewImage: {
    width: 56,
    height: 56,
    borderRadius: 10,
    backgroundColor: '#48484A',
  },

  placePreviewInfo: {
    flex: 1,
  },

  placePreviewName: {
    ...typography.subheading,
    color: colors.textPrimary,
  },

  placePreviewLabel: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },

  // Selected collection item
  collectionItemSelected: {
    borderWidth: 2,
    borderColor: colors.primary,
  },

  // Checkbox circle
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.textSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  checkCircleSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },

  // Save button
  saveButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },

  saveButtonDisabled: {
    backgroundColor: colors.inputBackground,
  },

  saveButtonText: {
    ...typography.body,
    fontWeight: '600',
    color: '#FFFFFF',
  },

  saveButtonTextDisabled: {
    color: colors.textSecondary,
  },

  // Share options
  shareOptionsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 40,
    marginTop: 24,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },

  shareOption: {
    alignItems: 'center',
    gap: 8,
  },

  shareOptionDisabled: {
    opacity: 0.5,
  },

  shareOptionIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },

  shareOptionText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textPrimary,
  },

  shareOptionTextDisabled: {
    color: colors.textSecondary,
  },

  // Instructions box
  instructionsBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 14,
    backgroundColor: 'rgba(0, 122, 255, 0.1)',
    borderRadius: 12,
    marginBottom: 20,
  },

  instructionsText: {
    flex: 1,
    fontSize: 14,
    color: colors.textPrimary,
    lineHeight: 20,
  },

  // Multiline text input
  textInputMultiline: {
    minHeight: 80,
    textAlignVertical: 'top',
    paddingTop: 14,
  },

  // Simple action options (for action sheets like "Open in Maps")
  actionOption: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
    marginBottom: 10,
  },

  actionOptionText: {
    fontSize: 17,
    fontWeight: '500',
    color: '#FFFFFF',
    textAlign: 'center',
  },

  cancelOption: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 20,
    marginTop: 10,
  },

  cancelOptionText: {
    fontSize: 17,
    fontWeight: '500',
    color: '#FFFFFF',
    textAlign: 'center',
  },
});

export default ModalStyles;
