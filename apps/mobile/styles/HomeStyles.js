/**
 * Styles for the HomeScreen (Map view)
 */

import { StyleSheet, Dimensions } from 'react-native';
import { colors } from './colors';
import { typography } from './typography';

const { width, height } = Dimensions.get('window');

export const HomeStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },

  // Map background container
  mapContainer: {
    flex: 1,
    backgroundColor: '#E8F4E5',
  },

  // Map background image/gradient
  mapBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },

  // Location labels on the map
  mapLabel: {
    position: 'absolute',
    ...typography.callout,
    fontWeight: '600',
    color: '#1B5E20',
  },

  mapLabelGolfCourse: {
    top: 180,
    right: 20,
  },

  mapLabelHermitage: {
    bottom: 150,
    right: 20,
  },

  // Circular photo markers
  placeMarker: {
    position: 'absolute',
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 3,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
  },

  markerImage: {
    width: '100%',
    height: '100%',
  },

  // Marker border colors
  markerBlue: {
    borderColor: colors.markerBlue,
  },

  markerPurple: {
    borderColor: colors.markerPurple,
  },

  markerRed: {
    borderColor: colors.markerRed,
  },

  markerGreen: {
    borderColor: colors.markerGreen,
  },

  markerBrown: {
    borderColor: colors.markerBrown,
  },

  // Marker positions (matching HTML layout)
  marker1: {
    top: 100,
    right: 60,
  },

  marker2: {
    top: 200,
    left: 140,
  },

  marker3: {
    top: 300,
    left: 80,
  },

  marker4: {
    top: 340,
    right: 70,
  },

  marker5: {
    top: 420,
    left: 110,
  },

  marker6: {
    bottom: 160,
    right: 50,
  },
});

export default HomeStyles;
