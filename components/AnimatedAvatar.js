/**
 * AnimatedAvatar - Animated profile avatar with eyes and nose that react to map interactions
 * Eyes and nose shift left by 4px when triggered, then return to original position
 */

import React, { useRef, useImperativeHandle, forwardRef } from 'react';
import { Animated } from 'react-native';
import Svg, { Circle, Path, G, Defs, Filter, FeFlood, FeColorMatrix, FeOffset, FeGaussianBlur, FeComposite, FeBlend, ClipPath, ForeignObject } from 'react-native-svg';

const AnimatedG = Animated.createAnimatedComponent(G);

const AnimatedAvatar = forwardRef(({ size = 32 }, ref) => {
  // Scale factor from original 76x76 to desired size
  const scale = size / 76;

  // Animated value for horizontal shift (0 = original, -4 = shifted left)
  const shiftX = useRef(new Animated.Value(0)).current;

  // Flag to prevent re-triggering while animating
  const isAnimating = useRef(false);

  // Expose triggerAnimation method to parent via ref
  useImperativeHandle(ref, () => ({
    triggerAnimation: () => {
      // Don't restart if already animating
      if (isAnimating.current) return;

      isAnimating.current = true;

      // Animate: shift left 3px (0.3s), hold (1.2s), return (0.3s)
      Animated.sequence([
        Animated.timing(shiftX, {
          toValue: -3,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.delay(1200),
        Animated.timing(shiftX, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start(() => {
        isAnimating.current = false;
      });
    },
  }));

  return (
    <Svg width={size} height={size} viewBox="18 14 40 40" fill="none">
      {/* Background circles - fills the viewBox */}
      <G>
        <Circle cx="38" cy="34" r="20" fill="black" fillOpacity={0.6} />
        <Circle cx="38" cy="34" r="20" fill="#52949D" fillOpacity={0.2} />
      </G>

      {/* Animated group for eyes and nose */}
      <AnimatedG
        style={{
          transform: [{ translateX: shiftX }],
        }}
      >
        {/* Nose/Mouth path */}
        <Path
          d="M32.2282 30.5448C28.5074 44.5428 31.0443 43.6829 33.5812 43.3046"
          stroke="white"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Left eye */}
        <Circle cx={29.1042} cy={26.0136} r={2} fill="white" />

        {/* Right eye */}
        <Circle cx={37.1042} cy={26.0136} r={2} fill="white" />
      </AnimatedG>
    </Svg>
  );
});

AnimatedAvatar.displayName = 'AnimatedAvatar';

export default AnimatedAvatar;
