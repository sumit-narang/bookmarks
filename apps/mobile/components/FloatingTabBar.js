/**
 * FloatingTabBar - Custom floating bottom navigation
 * Positioned 100px from bottom, floats over content
 *
 * Figma specs:
 * - Height: 48px
 * - Stroke: 1px solid rgba(255, 255, 255, 0.01)
 * - Background: rgba(82, 148, 157, 0.2) + rgba(0, 0, 0, 0.5)
 * - Effects: blur(34), drop shadow(0, 0, 24, 0, rgba(0,0,0,0.27))
 */

import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { lightHaptic } from '../utils/haptics';

// SVG Icons - outline (inactive) versions
import MapOutline from '../assets/icons/map-outline.svg';
import AddOutline from '../assets/icons/add-outline.svg';
import LibraryOutline from '../assets/icons/library-outline.svg';

// SVG Icons - filled (active) versions
import MapFilled from '../assets/icons/map-filled.svg';
import AddFilled from '../assets/icons/add-filled.svg';
import LibraryFilled from '../assets/icons/library-filled.svg';

// Icon mappings - outline (inactive) and filled (active) versions
const tabIcons = {
  MapTab: {
    outline: MapOutline,
    filled: MapFilled,
  },
  AddTab: {
    outline: AddOutline,
    filled: AddFilled,
  },
  LibraryTab: {
    outline: LibraryOutline,
    filled: LibraryFilled,
  },
};

const FloatingTabBar = ({ state, descriptors, navigation }) => {
  // Check if we're on a screen that should hide the tab bar
  const currentRoute = state.routes[state.index];
  const nestedState = currentRoute?.state;
  const nestedRouteName = nestedState?.routes?.[nestedState.index]?.name;

  // Hide tab bar on Profile and PlaceDetails screens
  if (nestedRouteName === 'Profile' || nestedRouteName === 'PlaceDetails') {
    return null;
  }

  return (
    <View style={styles.container}>
      {/* Blur background with gradient overlay */}
      <View style={styles.tabBarWrapper}>
        <BlurView intensity={34} tint="dark" style={styles.blurView}>
          <LinearGradient
            colors={['rgba(82, 148, 157, 0.2)', 'rgba(0, 0, 0, 0.5)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.gradient}
          />
        </BlurView>

        {/* Tab buttons */}
        <View style={styles.tabBar}>
          {state.routes.map((route, index) => {
            const { options } = descriptors[route.key];
            const isFocused = state.index === index;

            const onPress = () => {
              lightHaptic();
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });

              if (!isFocused && !event.defaultPrevented) {
                navigation.navigate(route.name, route.params);
              }
            };

            const onLongPress = () => {
              navigation.emit({
                type: 'tabLongPress',
                target: route.key,
              });
            };

            const icons = tabIcons[route.name];
            const IconComponent = isFocused ? icons?.filled : icons?.outline;

            return (
              <TouchableOpacity
                key={route.key}
                accessibilityRole="button"
                accessibilityState={isFocused ? { selected: true } : {}}
                accessibilityLabel={options.tabBarAccessibilityLabel}
                testID={options.tabBarTestID}
                onPress={onPress}
                onLongPress={onLongPress}
                style={[styles.tabButton, isFocused && styles.tabButtonActive]}
                activeOpacity={0.7}
              >
                {IconComponent && <IconComponent width={24} height={24} />}
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 24,
    left: 0,
    right: 0,
    alignItems: 'center',
    pointerEvents: 'box-none',
  },
  tabBarWrapper: {
    height: 52,
    borderRadius: 26, // Half of height for fully rounded pill
    // Stroke: 1px solid rgba(255, 255, 255, 0.01)
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.01)',
    // Drop shadow: x=0, y=0, blur=24, spread=0, rgba(0,0,0,0.27)
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.27,
    shadowRadius: 12, // blur/2 for React Native
    elevation: 12,
  },
  blurView: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 26,
    overflow: 'hidden',
  },
  gradient: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 26,
  },
  tabBar: {
    flexDirection: 'row',
    alignItems: 'stretch', // Children take full height
    height: '100%',
    paddingHorizontal: 4, // 4px padding on each side of parent
    paddingVertical: 4, // 4px padding on each side of parent
  },
  tabButton: {
    width: 58, // Each child is 58px wide
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22, // Fully rounded
  },
  tabButtonActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
});

export default FloatingTabBar;
