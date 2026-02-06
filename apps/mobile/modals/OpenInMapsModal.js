/**
 * OpenInMapsModal - Choose to open location in Google Maps or Apple Maps
 * Bottom modal with action buttons
 */

import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Linking,
  Platform,
} from 'react-native';
import CrossIcon from '../assets/icons/modal-cross-icon.svg';

const OpenInMapsModal = ({ route, navigation }) => {
  const { coordinates, placeName } = route.params;

  // Handle close
  const handleClose = () => {
    navigation.goBack();
  };

  // Open in Google Maps
  const openGoogleMaps = () => {
    handleClose();
    const { latitude, longitude } = coordinates || {};
    if (latitude && longitude) {
      const url = Platform.select({
        ios: `comgooglemaps://?q=${latitude},${longitude}&center=${latitude},${longitude}`,
        android: `geo:${latitude},${longitude}?q=${latitude},${longitude}`,
      });
      const webUrl = `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;

      Linking.canOpenURL(url).then((supported) => {
        if (supported) {
          Linking.openURL(url);
        } else {
          Linking.openURL(webUrl);
        }
      });
    }
  };

  // Open in Apple Maps
  const openAppleMaps = () => {
    handleClose();
    const { latitude, longitude } = coordinates || {};
    if (latitude && longitude) {
      const url = `maps://app?daddr=${latitude},${longitude}`;
      Linking.openURL(url);
    }
  };

  return (
    <TouchableOpacity
      style={styles.backdrop}
      activeOpacity={1}
      onPress={handleClose}
    >
      <TouchableOpacity
        style={styles.modal}
        activeOpacity={1}
        onPress={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.heading}>Open in Maps</Text>
          <TouchableOpacity onPress={handleClose}>
            <CrossIcon width={32} height={32} />
          </TouchableOpacity>
        </View>

        {/* Content */}
        <View style={styles.content}>
          <TouchableOpacity
            style={styles.actionOption}
            onPress={openGoogleMaps}
            activeOpacity={0.7}
          >
            <Text style={styles.actionOptionText}>Open in Google Maps</Text>
          </TouchableOpacity>

          {Platform.OS === 'ios' && (
            <TouchableOpacity
              style={styles.actionOption}
              onPress={openAppleMaps}
              activeOpacity={0.7}
            >
              <Text style={styles.actionOptionText}>Open in Apple Maps</Text>
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },

  modal: {
    backgroundColor: '#262626',
    borderTopLeftRadius: 34,
    borderTopRightRadius: 34,
    padding: 18,
    paddingBottom: 34,
    width: '100%',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  heading: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: -0.4,
    flex: 1,
  },

  content: {
    marginTop: 24,
    gap: 12,
  },

  actionOption: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 52,
    paddingVertical: 16,
    paddingHorizontal: 20,
  },

  actionOptionText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#FFFFFF',
  },
});

export default OpenInMapsModal;
