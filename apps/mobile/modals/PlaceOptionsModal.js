/**
 * PlaceOptionsModal - Options for a place (Share, Delete)
 * Bottom modal with option buttons
 */

import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Share,
} from 'react-native';
import * as Linking from 'expo-linking';
import { encodeSharePayload } from '../../../share/src';
import CrossIcon from '../assets/icons/modal-cross-icon.svg';
import ShareIcon from '../assets/icons/share.svg';
import DeleteIcon from '../assets/icons/delete.svg';
import { colors } from '../styles/colors';
import { deletePlace } from '../data/storage';
import { mediumHaptic, heavyHaptic, warningHaptic, successHaptic } from '../utils/haptics';

const PlaceOptionsModal = ({ route, navigation }) => {
  const { place } = route.params;

  // Handle close
  const handleClose = () => {
    navigation.goBack();
  };

  // Handle share tap - directly share this place
  const handleShare = async () => {
    mediumHaptic();
    try {
      // Build share data for this single place
      const shareData = [{
        id: 'shared-place',
        name: 'Shared Place',
        places: [{
          id: place.id || place.placeId,
          name: place.name,
          type: place.type,
          image: place.image,
          address: place.address,
          rating: place.rating,
          reviewCount: place.reviewCount,
        }],
      }];

      // Encode as base64
      const base64Data = encodeSharePayload(shareData);

      // Create URL using Expo Linking
      const shareUrl = Linking.createURL('shared', {
        queryParams: { data: base64Data },
      });

      const result = await Share.share({
        message: `Check out ${place.name}!\n\n${shareUrl}`,
        title: `Share ${place.name}`,
      });

      // Only close modal if share was completed
      if (result.action === Share.sharedAction) {
        successHaptic();
        navigation.goBack();
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        Alert.alert('Error', 'Failed to share place');
      }
    }
  };

  // Handle delete tap - show confirmation
  const handleDelete = () => {
    warningHaptic();
    Alert.alert(
      'Are you sure you want to delete?',
      'This place will be deleted from every collection',
      [
        {
          text: 'No',
          style: 'cancel',
        },
        {
          text: 'Yes',
          style: 'destructive',
          onPress: async () => {
            heavyHaptic();
            const placeId = place.placeId || place.id;
            const success = await deletePlace(placeId);
            if (success) {
              navigation.goBack();
            } else {
              Alert.alert('Error', 'Failed to delete place. Please try again.');
            }
          },
        },
      ]
    );
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
          <Text style={styles.heading}>Options</Text>
          <TouchableOpacity onPress={handleClose}>
            <CrossIcon width={32} height={32} />
          </TouchableOpacity>
        </View>

        {/* Content */}
        <View style={styles.content}>
          {/* Share Button */}
          <TouchableOpacity
            style={styles.optionButton}
            onPress={handleShare}
            activeOpacity={0.7}
          >
            <ShareIcon width={24} height={24} />
            <Text style={styles.optionLabel}>Share</Text>
          </TouchableOpacity>

          {/* Delete Button */}
          <TouchableOpacity
            style={styles.optionButton}
            onPress={handleDelete}
            activeOpacity={0.7}
          >
            <DeleteIcon width={24} height={24} stroke="#FF6568" />
            <Text style={[styles.optionLabel, styles.deleteLabel]}>Delete</Text>
          </TouchableOpacity>
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

  optionButton: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#393939',
    borderRadius: 52,
    paddingHorizontal: 16,
    gap: 12,
  },

  optionLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: '#FFFFFF',
  },

  deleteLabel: {
    color: '#FF6568',
  },
});

export default PlaceOptionsModal;
