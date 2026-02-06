/**
 * Haptic feedback utility
 * Provides consistent haptic feedback across the app
 */

import * as Haptics from 'expo-haptics';

/**
 * Light haptic feedback - for subtle interactions
 * Use for: toggle switches, selection changes, minor actions
 */
export const lightHaptic = () => {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
};

/**
 * Medium haptic feedback - for standard interactions
 * Use for: button presses, navigation actions, confirmations
 */
export const mediumHaptic = () => {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
};

/**
 * Heavy haptic feedback - for significant interactions
 * Use for: important actions, deletions, major state changes
 */
export const heavyHaptic = () => {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
};

/**
 * Success haptic feedback - for successful operations
 * Use for: save success, completion of tasks
 */
export const successHaptic = () => {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
};

/**
 * Warning haptic feedback - for warnings
 * Use for: alerts, confirmations before destructive actions
 */
export const warningHaptic = () => {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
};

/**
 * Error haptic feedback - for errors
 * Use for: failed operations, validation errors
 */
export const errorHaptic = () => {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
};

/**
 * Selection haptic feedback - for selection changes
 * Use for: list item selection, tab changes
 */
export const selectionHaptic = () => {
  Haptics.selectionAsync();
};
