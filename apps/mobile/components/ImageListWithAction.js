/**
 * ImageListWithAction - Reusable list item component
 * Picture, Title, Subtitle, Action Icon - all vertically centered
 */

import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';

const ImageListWithAction = ({
  imageUri,
  title,
  subtitle,
  onPress,
  actionIcon,
  onActionPress,
  showDivider = true,
  placeholder,
  titleIcon,
}) => {
  return (
    <TouchableOpacity
      style={styles.container}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.content}>
        {/* Picture */}
        {imageUri ? (
          <Image
            source={{ uri: imageUri }}
            style={styles.picture}
            resizeMode="cover"
          />
        ) : placeholder ? (
          <View style={styles.placeholderContainer}>
            {placeholder}
          </View>
        ) : (
          <View style={styles.picture} />
        )}

        {/* Title and Subtitle */}
        <View style={styles.textContainer}>
          <View style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            {titleIcon && (
              <View style={styles.titleIconContainer}>
                {titleIcon}
              </View>
            )}
          </View>
          {subtitle && (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          )}
        </View>

        {/* Action Icon */}
        {actionIcon && (
          <TouchableOpacity
            style={styles.actionIconContainer}
            onPress={onActionPress || onPress}
            activeOpacity={0.7}
          >
            {actionIcon}
          </TouchableOpacity>
        )}
      </View>

      {/* Divider Line */}
      {showDivider && <View style={styles.divider} />}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  picture: {
    width: 44,
    height: 44,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  placeholderContainer: {
    width: 44,
    height: 44,
    borderRadius: 6,
    overflow: 'hidden',
  },
  textContainer: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    color: 'rgba(255, 255, 255, 0.9)',
    fontSize: 17,
    fontWeight: '500',
    letterSpacing: -0.3,
    lineHeight: 20,
    flexShrink: 1,
  },
  titleIconContainer: {
    marginLeft: 6,
    justifyContent: 'center',
  },
  subtitle: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 15,
    fontWeight: '400',
    letterSpacing: -0.3,
    lineHeight: 20,
    marginTop: 4,
  },
  actionIconContainer: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    marginTop: 14,
    marginBottom: 14,
  },
});

export default ImageListWithAction;
