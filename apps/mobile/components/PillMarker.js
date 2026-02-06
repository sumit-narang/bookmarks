/**
 * PillMarker - Map marker with circular image and place name
 * Supports 3 display modes based on zoom level:
 * - 'full': Pill with image + text + pointer (zoomed in)
 * - 'circle': Just circular image (medium zoom)
 * - 'dot': Small dot only (zoomed out)
 */

import { View, Text, Image, StyleSheet } from 'react-native';

const PILL_HEIGHT = 36; // Fixed height for pill
const PILL_RADIUS = PILL_HEIGHT / 2; // Fully rounded

const PillMarker = ({
  imageUri,
  name,
  pointerColor = '#007AFF', // Blue pointer circle
  imageSize = 28, // Circle image size
  mode = 'full', // 'full' | 'circle' | 'dot'
}) => {
  // DOT MODE - small colored dot
  if (mode === 'dot') {
    return (
      <View style={styles.dotContainer}>
        <View style={[styles.dot, { backgroundColor: pointerColor }]} />
      </View>
    );
  }

  // CIRCLE MODE - just the image circle
  if (mode === 'circle') {
    return (
      <View style={styles.circleContainer}>
        <View style={[styles.circleImageWrapper, { width: imageSize, height: imageSize, borderRadius: imageSize / 2 }]}>
          {imageUri ? (
            <Image
              source={{ uri: imageUri }}
              style={[styles.image, { width: imageSize, height: imageSize, borderRadius: imageSize / 2 }]}
              resizeMode="cover"
            />
          ) : (
            <View style={[styles.imagePlaceholder, { width: imageSize, height: imageSize, borderRadius: imageSize / 2 }]} />
          )}
        </View>
      </View>
    );
  }

  // FULL MODE - pill with semi-transparent background + shadow
  return (
    <View style={styles.container}>
      {/* Main pill container with shadow */}
      <View style={styles.pillWrapper}>
        {/* Content */}
        <View style={styles.pillContent}>
          {/* Circular image */}
          <View style={[styles.imageContainer, { width: imageSize, height: imageSize, borderRadius: imageSize / 2 }]}>
            {imageUri ? (
              <Image
                source={{ uri: imageUri }}
                style={[styles.image, { width: imageSize, height: imageSize, borderRadius: imageSize / 2 }]}
                resizeMode="cover"
              />
            ) : (
              <View style={[styles.imagePlaceholder, { width: imageSize, height: imageSize, borderRadius: imageSize / 2 }]} />
            )}
          </View>

          {/* Place name */}
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
        </View>
      </View>

      {/* Blue circle pointer */}
      <View style={[styles.pointer, { backgroundColor: pointerColor }]} />
    </View>
  );
};

const styles = StyleSheet.create({
  // FULL MODE styles
  container: {
    alignItems: 'center',
  },
  pillWrapper: {
    height: PILL_HEIGHT,
    borderRadius: PILL_RADIUS,
    // Semi-transparent dark background (simulates blur effect)
    backgroundColor: 'rgba(30, 45, 50, 0.85)',
    // Stroke
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
    // Shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  pillContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 4,
    paddingRight: 12,
  },
  imageContainer: {
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
  image: {
    backgroundColor: '#E0E0E0',
  },
  imagePlaceholder: {
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
  },
  name: {
    marginLeft: 8,
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: -0.3,
    maxWidth: 120,
  },
  pointer: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginTop: 6,
    // Shadow for pointer
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },

  // CIRCLE MODE styles
  circleContainer: {
    alignItems: 'center',
  },
  circleImageWrapper: {
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    // Shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 4,
  },

  // DOT MODE styles
  dotContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    // Shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
    elevation: 3,
  },
});

export default PillMarker;
