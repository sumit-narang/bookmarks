/**
 * Styles for the AddPlaceSearchScreen
 */

import { StyleSheet } from 'react-native';
import { colors } from './colors';

export const SearchStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },

  // Screen title
  screenTitle: {
    fontSize: 24,
    fontWeight: '600',
    letterSpacing: -0.7,
    color: '#FFFFFF',
    paddingHorizontal: 16,
    marginTop: 24,
  },

  // Search input
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    paddingHorizontal: 12,
    marginHorizontal: 16,
    marginTop: 32,
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    borderRadius: 12,
  },

  searchIcon: {
    marginRight: 10,
  },

  searchInput: {
    flex: 1,
    fontSize: 16,
    color: colors.textPrimary,
    height: '100%',
    padding: 0,
  },

  // Section label
  sectionLabel: {
    fontSize: 15,
    letterSpacing: -0.3,
    color: 'rgba(255, 255, 255, 0.6)',
    paddingHorizontal: 16,
    marginTop: 24,
  },

  // Search results
  searchResults: {
    paddingHorizontal: 16,
    marginTop: 20,
    paddingBottom: 180,
  },

  // Loading overlay
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(28, 28, 30, 0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },

  loadingText: {
    color: colors.textSecondary,
    fontSize: 16,
    marginTop: 16,
  },

  // Empty state
  emptyState: {
    paddingTop: 40,
    alignItems: 'center',
  },

  emptyStateTitle: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontSize: 17,
    fontWeight: '500',
    letterSpacing: -0.3,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: 20,
  },

  emptyStateDescription: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 15,
    fontWeight: '400',
    letterSpacing: -0.3,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: 4,
  },
});

export default SearchStyles;
