/**
 * Styles for the PlaceDetailsScreen
 */

import { StyleSheet, Dimensions } from 'react-native';
import { colors } from './colors';
import { typography } from './typography';

const { width } = Dimensions.get('window');

export const PlaceDetailsStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#181818',
  },

  // Back button header
  backHeader: {
    position: 'absolute',
    top: 50,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 10,
  },

  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Image carousel
  imageCarousel: {
    height: 400,
    position: 'relative',
  },

  carouselImage: {
    width: width,
    height: 400,
  },

  carouselDots: {
    position: 'absolute',
    bottom: 76,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },

  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
  },

  dotActive: {
    width: 20,
    backgroundColor: '#FFFFFF',
  },

  imageGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 155,
  },

  // Details content
  detailsContent: {
    padding: 16,
    paddingBottom: 120,
    marginTop: -60,
  },

  detailsContentSaved: {
    paddingBottom: 40,
  },

  placeNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },

  placeName: {
    fontSize: 28,
    fontWeight: '600',
    lineHeight: 36,
    color: '#FFFFFF',
    flexShrink: 1,
  },

  placeNameBookmark: {
    marginLeft: 8,
    alignSelf: 'center',
    marginTop: 6,
  },

  placeMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 20,
  },

  placeType: {
    fontSize: 15,
    fontWeight: '400',
    color: 'rgba(255, 255, 255, 0.7)',
  },

  metaSeparator: {
    fontSize: 15,
    color: 'rgba(255, 255, 255, 0.5)',
  },

  rating: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },

  starIcon: {
    fontSize: 14,
    color: '#FFD60A', // Yellow/gold star color
  },

  ratingText: {
    fontSize: 15,
    fontWeight: '400',
    color: 'rgba(255, 255, 255, 0.7)',
  },

  // Info cards (sections)
  infoCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
  },

  cardLabel: {
    ...typography.caption,
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 15,
    fontWeight: '300',
  },

  cardContent: {
    fontSize: 16,
    fontWeight: '300',
    lineHeight: 22,
    color: '#FFFFFF',
    marginTop: 12,
  },

  savedCollectionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  savedCollectionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },

  savedCollectionImage: {
    width: 24,
    height: 24,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },

  savedCollectionName: {
    fontSize: 16,
    fontWeight: '300',
    color: '#FFFFFF',
    marginLeft: 8,
    flex: 1,
  },

  savedCollectionDate: {
    fontSize: 14,
    fontWeight: '400',
    color: 'rgba(255, 255, 255, 0.5)',
    letterSpacing: -0.5,
  },

  savedSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  viewMoreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    gap: 4,
  },

  viewMoreText: {
    fontSize: 15,
    fontWeight: '400',
    color: 'rgba(255, 255, 255, 0.7)',
  },

  saveToCollectionBtn: {
    height: 48,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
  },

  saveToCollectionBtnText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#FFFFFF',
  },

  // Bottom action
  bottomAction: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingBottom: 34,
    paddingHorizontal: 16,
  },

  bottomGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 100,
  },

  saveBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 52,
    paddingVertical: 16,
    paddingHorizontal: 24,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 8,
  },

  saveBtnText: {
    ...typography.subheading,
  },

  // Saved state button
  savedBtn: {
    backgroundColor: '#FFFFFF',
  },

  savedBtnText: {
    color: '#000000',
  },

  // Map styles
  mapContainer: {
    height: 240,
    borderRadius: 12,
    overflow: 'hidden',
    marginTop: 12,
  },

  map: {
    width: '100%',
    height: '100%',
  },
});

export default PlaceDetailsStyles;
