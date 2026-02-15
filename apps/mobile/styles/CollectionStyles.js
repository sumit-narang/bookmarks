/**
 * Styles for the CollectionScreen
 */

import { StyleSheet } from 'react-native';
import { colors } from './colors';
import { typography } from './typography';

export const CollectionStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },

  // Top bar with tabs
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
  },

  tabsContainer: {
    flexDirection: 'row',
    gap: 8,
  },

  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 6,
  },

  tabActive: {
    backgroundColor: colors.inputBackground,
  },

  tabText: {
    fontSize: 15,
    fontWeight: '500',
    lineHeight: 18,
    color: colors.textSecondary,
  },

  tabTextActive: {
    color: colors.textPrimary,
  },

  tabCount: {
    fontSize: 15,
    fontWeight: '400',
    color: colors.textSecondary,
  },

  shareBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Content area
  contentArea: {
    flex: 1,
    paddingBottom: 100,
  },

  // Section
  section: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },

  sectionTitle: {
    ...typography.subheading,
    color: colors.textPrimary,
  },

  sectionCount: {
    fontSize: 15,
    fontWeight: '400',
    lineHeight: 18,
    color: colors.textSecondary,
  },

  // Horizontal scroll for places
  placesGrid: {
    flexDirection: 'row',
    gap: 8,
  },

  // Place card
  placeCard: {
    width: 120,
    height: 120,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
  },

  placeImage: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.inputBackground,
  },

  // Gradient overlay
  placeGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '50%',
  },

  // Place name (overlaid)
  placeName: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    right: 8,
    ...typography.caption,
    color: colors.textPrimary,
  },
});

export default CollectionStyles;
