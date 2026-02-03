/**
 * HexagonCustomizerScreen - Interactive customization for 3D hexagon marker
 * Preview different variants and themes
 */

import { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  SafeAreaView,
  TouchableOpacity,
  PanResponder,
  Dimensions,
} from 'react-native';
import HexagonMarker, { HEXAGON_VARIANTS, HEXAGON_THEMES } from '../components/HexagonMarker';

const SCREEN_WIDTH = Dimensions.get('window').width;

// Custom Slider Component
const CustomSlider = ({ value, onValueChange, minimumValue, maximumValue, trackColor = '#007AFF' }) => {
  const sliderWidth = SCREEN_WIDTH - 64;
  const thumbSize = 24;
  const range = maximumValue - minimumValue;
  const percentage = (value - minimumValue) / range;
  const thumbPosition = percentage * (sliderWidth - thumbSize);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (_, gestureState) => {
        const newPosition = Math.max(0, Math.min(sliderWidth - thumbSize, thumbPosition + gestureState.dx));
        const newPercentage = newPosition / (sliderWidth - thumbSize);
        const newValue = minimumValue + (newPercentage * range);
        onValueChange(newValue);
      },
      onPanResponderGrant: (evt) => {
        const touchX = evt.nativeEvent.locationX;
        const newPercentage = Math.max(0, Math.min(1, touchX / sliderWidth));
        const newValue = minimumValue + (newPercentage * range);
        onValueChange(newValue);
      },
    })
  ).current;

  return (
    <View style={sliderStyles.container} {...panResponder.panHandlers}>
      <View style={sliderStyles.track}>
        <View style={[sliderStyles.fill, { width: `${percentage * 100}%`, backgroundColor: trackColor }]} />
      </View>
      <View style={[sliderStyles.thumb, { left: thumbPosition, backgroundColor: trackColor }]} />
    </View>
  );
};

const sliderStyles = StyleSheet.create({
  container: {
    height: 40,
    justifyContent: 'center',
  },
  track: {
    height: 4,
    backgroundColor: '#333',
    borderRadius: 2,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 2,
  },
  thumb: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
    top: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 4,
  },
});

const HexagonCustomizerScreen = ({ navigation }) => {
  // Customizable properties
  const [size, setSize] = useState(80);
  const [selectedVariant, setSelectedVariant] = useState('medium');
  const [selectedTheme, setSelectedTheme] = useState('stone');
  const [customDepth, setCustomDepth] = useState(16);
  const [useCustomDepth, setUseCustomDepth] = useState(false);

  // Get the code for current config
  const getConfigCode = () => {
    if (useCustomDepth) {
      return `<HexagonMarker
  size={${Math.round(size)}}
  depth={${Math.round(customDepth)}}
  theme="${selectedTheme}"
/>`;
    }
    return `<HexagonMarker
  size={${Math.round(size)}}
  variant="${selectedVariant}"
  theme="${selectedTheme}"
/>`;
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Hexagon Customizer</Text>
        </View>

        {/* Main Preview */}
        <View style={styles.previewContainer}>
          <View style={styles.previewBg}>
            <HexagonMarker
              size={size}
              variant={useCustomDepth ? undefined : selectedVariant}
              depth={useCustomDepth ? customDepth : undefined}
              theme={selectedTheme}
            />
          </View>
        </View>

        {/* Size Slider */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Size: {Math.round(size)}px</Text>
          <CustomSlider
            minimumValue={24}
            maximumValue={120}
            value={size}
            onValueChange={setSize}
            trackColor="#007AFF"
          />
        </View>

        {/* Height Variants */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Height Variants</Text>
          <View style={styles.variantsRow}>
            {Object.entries(HEXAGON_VARIANTS).map(([key, config]) => (
              <TouchableOpacity
                key={key}
                style={[
                  styles.variantItem,
                  selectedVariant === key && !useCustomDepth && styles.variantSelected,
                ]}
                onPress={() => {
                  setSelectedVariant(key);
                  setUseCustomDepth(false);
                }}
              >
                <View style={styles.variantPreview}>
                  <HexagonMarker
                    size={36}
                    variant={key}
                    theme={selectedTheme}
                  />
                </View>
                <Text style={styles.variantLabel}>{config.label}</Text>
                <Text style={styles.variantDepth}>{config.depth}px</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Custom Depth */}
        <View style={styles.section}>
          <View style={styles.customDepthHeader}>
            <Text style={styles.sectionTitle}>Custom Depth: {Math.round(customDepth)}px</Text>
            <TouchableOpacity
              style={[styles.customToggle, useCustomDepth && styles.customToggleActive]}
              onPress={() => setUseCustomDepth(!useCustomDepth)}
            >
              <Text style={styles.customToggleText}>
                {useCustomDepth ? 'Using Custom' : 'Use Custom'}
              </Text>
            </TouchableOpacity>
          </View>
          <CustomSlider
            minimumValue={4}
            maximumValue={60}
            value={customDepth}
            onValueChange={(v) => {
              setCustomDepth(v);
              setUseCustomDepth(true);
            }}
            trackColor="#FF9500"
          />
        </View>

        {/* Color Themes */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Color Themes</Text>
          <View style={styles.themesGrid}>
            {Object.entries(HEXAGON_THEMES).map(([key, colors]) => (
              <TouchableOpacity
                key={key}
                style={[
                  styles.themeItem,
                  selectedTheme === key && styles.themeSelected,
                ]}
                onPress={() => setSelectedTheme(key)}
              >
                <View style={styles.themePreview}>
                  <HexagonMarker
                    size={40}
                    depth={12}
                    topColor={colors.topColor}
                    leftColor={colors.leftColor}
                    rightColor={colors.rightColor}
                  />
                </View>
                <Text style={styles.themeLabel}>{key.charAt(0).toUpperCase() + key.slice(1)}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* All Variants Preview */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>All Combinations</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.combinationsScroll}>
            <View style={styles.combinationsRow}>
              {Object.keys(HEXAGON_THEMES).map((theme) => (
                <View key={theme} style={styles.combinationColumn}>
                  <Text style={styles.combinationTheme}>{theme}</Text>
                  <View style={styles.combinationVariants}>
                    {Object.keys(HEXAGON_VARIANTS).map((variant) => (
                      <View key={variant} style={styles.combinationItem}>
                        <HexagonMarker
                          size={28}
                          variant={variant}
                          theme={theme}
                        />
                      </View>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          </ScrollView>
        </View>

        {/* Code Output */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Generated Code</Text>
          <View style={styles.codeBox}>
            <Text style={styles.codeText}>{getConfigCode()}</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#181818',
  },
  scrollContent: {
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  backBtn: {
    marginRight: 16,
  },
  backText: {
    color: '#007AFF',
    fontSize: 16,
  },
  title: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: '600',
  },
  previewContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  previewBg: {
    backgroundColor: '#C4A574',
    padding: 50,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  sectionTitle: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 16,
  },
  variantsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  variantItem: {
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: '#2C2C2E',
    minWidth: 70,
  },
  variantSelected: {
    borderColor: '#007AFF',
    backgroundColor: '#1A3A5C',
  },
  variantPreview: {
    height: 60,
    justifyContent: 'flex-end',
    marginBottom: 8,
  },
  variantLabel: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '600',
  },
  variantDepth: {
    color: '#888',
    fontSize: 10,
    marginTop: 2,
  },
  customDepthHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  customToggle: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#333',
  },
  customToggleActive: {
    backgroundColor: '#FF9500',
  },
  customToggleText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '600',
  },
  themesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  themeItem: {
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: '#2C2C2E',
    width: (SCREEN_WIDTH - 56) / 3,
  },
  themeSelected: {
    borderColor: '#007AFF',
  },
  themePreview: {
    marginBottom: 8,
  },
  themeLabel: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '500',
  },
  combinationsScroll: {
    marginHorizontal: -16,
    paddingHorizontal: 16,
  },
  combinationsRow: {
    flexDirection: 'row',
    gap: 16,
  },
  combinationColumn: {
    alignItems: 'center',
  },
  combinationTheme: {
    color: '#888',
    fontSize: 10,
    marginBottom: 8,
    textTransform: 'capitalize',
  },
  combinationVariants: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
    backgroundColor: '#C4A574',
    padding: 8,
    borderRadius: 8,
  },
  combinationItem: {
    alignItems: 'center',
  },
  codeBox: {
    backgroundColor: '#2C2C2E',
    borderRadius: 8,
    padding: 16,
  },
  codeText: {
    color: '#6BCB77',
    fontSize: 12,
    fontFamily: 'monospace',
    lineHeight: 18,
  },
});

export default HexagonCustomizerScreen;
