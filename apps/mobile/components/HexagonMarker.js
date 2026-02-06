/**
 * HexagonMarker - Giant's Causeway style 3D hexagonal column marker
 * Isometric view with pointy-top hexagon and visible side faces
 */

import { View, StyleSheet } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';

// Height variation presets
export const HEXAGON_VARIANTS = {
  short: { depth: 8, label: 'Short' },
  medium: { depth: 16, label: 'Medium' },
  tall: { depth: 28, label: 'Tall' },
  extraTall: { depth: 40, label: 'Extra Tall' },
};

// Color theme presets
export const HEXAGON_THEMES = {
  stone: {
    topColor: '#B8B8B8',
    leftColor: '#5A5A5A',
    rightColor: '#707070',
  },
  basalt: {
    topColor: '#A0A0A0',
    leftColor: '#4A4A4A',
    rightColor: '#606060',
  },
  slate: {
    topColor: '#8899AA',
    leftColor: '#3D4654',
    rightColor: '#566270',
  },
  sandstone: {
    topColor: '#D4C4A8',
    leftColor: '#8B7355',
    rightColor: '#A68B5B',
  },
  obsidian: {
    topColor: '#6A6A6A',
    leftColor: '#2A2A2A',
    rightColor: '#404040',
  },
};

const HexagonMarker = ({
  size = 36,
  depth = 16,
  variant, // 'short', 'medium', 'tall', 'extraTall'
  theme = 'stone', // 'stone', 'basalt', 'slate', 'sandstone', 'obsidian'
  // Or custom colors
  topColor,
  leftColor,
  rightColor,
}) => {
  // Apply variant if specified
  const actualDepth = variant ? HEXAGON_VARIANTS[variant]?.depth || depth : depth;

  // Apply theme colors or use custom
  const themeColors = HEXAGON_THEMES[theme] || HEXAGON_THEMES.stone;
  const colors = {
    top: topColor || themeColors.topColor,
    left: leftColor || themeColors.leftColor,
    right: rightColor || themeColors.rightColor,
  };

  // Hexagon dimensions for flat-top isometric view
  const hexWidth = size;

  // Isometric angles - creates the 3D tilted effect
  // Higher values = more tilted/angled appearance
  const isoAngle = 0.5; // Controls the vertical compression of top face

  // Top face dimensions
  const topFaceHeight = size * isoAngle;

  // Total SVG dimensions
  const svgWidth = hexWidth;
  const svgHeight = topFaceHeight + actualDepth;

  // Center X position
  const cx = hexWidth / 2;

  // Flat-top hexagon in isometric 3D projection
  // The shape is like looking at a hexagonal column from above and in front
  //
  //        ___________
  //       /           \        <- top edge (flat)
  //      /             \       <- angled sides going back
  //     /               \
  //    |                 |     <- this part goes straight down (depth)
  //    |                 |
  //
  const halfWidth = hexWidth / 2;
  const quarterWidth = hexWidth / 4;

  // Top face points - flat-top hexagon viewed at isometric angle
  // Creates the tilted 3D perspective matching the reference image
  const topFacePoints = [
    [cx - quarterWidth, 0],                    // 0: Top-left (back edge)
    [cx + quarterWidth, 0],                    // 1: Top-right (back edge)
    [cx + halfWidth, topFaceHeight * 0.5],     // 2: Right vertex
    [cx + quarterWidth, topFaceHeight],        // 3: Bottom-right (front edge)
    [cx - quarterWidth, topFaceHeight],        // 4: Bottom-left (front edge)
    [cx - halfWidth, topFaceHeight * 0.5],     // 5: Left vertex
  ];

  // Bottom face points (shifted down by depth)
  const bottomFacePoints = topFacePoints.map(p => [p[0], p[1] + actualDepth]);

  // Create polygon point strings
  const topFaceStr = topFacePoints.map(p => p.join(',')).join(' ');

  // Left side face - from left vertex down to bottom-left
  const leftFace = [
    topFacePoints[5],    // Left vertex (top)
    topFacePoints[4],    // Bottom-left (top)
    bottomFacePoints[4], // Bottom-left (bottom)
    bottomFacePoints[5], // Left vertex (bottom)
  ].map(p => p.join(',')).join(' ');

  // Right side face - from right vertex down to bottom-right
  const rightFace = [
    topFacePoints[2],    // Right vertex (top)
    bottomFacePoints[2], // Right vertex (bottom)
    bottomFacePoints[3], // Bottom-right (bottom)
    topFacePoints[3],    // Bottom-right (top)
  ].map(p => p.join(',')).join(' ');

  // Front face - the bottom front edge going straight down
  const frontFace = [
    topFacePoints[3],    // Bottom-right (top)
    topFacePoints[4],    // Bottom-left (top)
    bottomFacePoints[4], // Bottom-left (bottom)
    bottomFacePoints[3], // Bottom-right (bottom)
  ].map(p => p.join(',')).join(' ');

  // Adjust brightness helper
  const adjustBrightness = (hex, amount) => {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.min(255, Math.max(0, (num >> 16) + amount));
    const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + amount));
    const b = Math.min(255, Math.max(0, (num & 0x0000FF) + amount));
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
  };

  // Front face is slightly lighter than left side
  const frontColor = adjustBrightness(colors.left, 15);

  return (
    <View style={[styles.container, { width: svgWidth, height: svgHeight }]}>
      <Svg width={svgWidth} height={svgHeight}>
        {/* Left side face (darkest) */}
        <Polygon
          points={leftFace}
          fill={colors.left}
        />

        {/* Front face (slightly lighter than left) */}
        <Polygon
          points={frontFace}
          fill={frontColor}
        />

        {/* Right side face (medium - lighter than left) */}
        <Polygon
          points={rightFace}
          fill={colors.right}
        />

        {/* Top face (lightest - main visible surface) */}
        <Polygon
          points={topFaceStr}
          fill={colors.top}
        />
      </Svg>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
});

export default HexagonMarker;
