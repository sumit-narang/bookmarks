/**
 * CollectionOptionsModal - Options for a collection (Add Place, Share, Delete)
 * Bottom modal with option buttons
 */

import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import CrossIcon from '../assets/icons/modal-cross-icon.svg';
import AddNewIcon from '../assets/icons/add-new-icon.svg';
import ShareIcon from '../assets/icons/share.svg';
import DeleteIcon from '../assets/icons/delete.svg';
import { colors } from '../styles/colors';
import { deleteCollection } from '../data/storage';
import { mediumHaptic, heavyHaptic, warningHaptic } from '../utils/haptics';

const CollectionOptionsModal = ({ route, navigation }) => {
  const { collection } = route.params;

  // Handle close
  const handleClose = () => {
    navigation.goBack();
  };

  // Handle add place tap
  const handleAddPlace = () => {
    mediumHaptic();
    navigation.goBack();
    // Navigate to add place search after modal closes
    // Need to navigate through Main (TabNavigator) first since modal is at root level
    setTimeout(() => {
      navigation.navigate('Main', {
        screen: 'AddTab',
        params: { screen: 'AddPlaceSearch' },
      });
    }, 100);
  };

  // Handle share tap
  const handleShare = () => {
    mediumHaptic();
    navigation.goBack();
    // Navigate to share screen
    navigation.navigate('ShareCollection');
  };

  // Handle delete tap - show confirmation
  const handleDelete = () => {
    warningHaptic();
    Alert.alert(
      'Delete Collection',
      `Are you sure you want to delete "${collection.name}"? All places will be removed from this collection.`,
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            heavyHaptic();
            const success = await deleteCollection(collection.id);
            if (success) {
              // Navigate back to the library tab, replacing the current stack
              navigation.reset({
                index: 0,
                routes: [{
                  name: 'Main',
                  state: {
                    index: 2, // LibraryTab is the 3rd tab (index 2)
                    routes: [
                      { name: 'MapTab' },
                      { name: 'AddTab' },
                      { name: 'LibraryTab' },
                    ],
                  },
                }],
              });
            } else {
              Alert.alert('Error', 'Failed to delete collection. Please try again.');
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
          {/* Add Place Button */}
          <TouchableOpacity
            style={styles.optionButton}
            onPress={handleAddPlace}
            activeOpacity={0.7}
          >
            <AddNewIcon width={24} height={24} />
            <Text style={styles.optionLabel}>Add Place</Text>
          </TouchableOpacity>

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
            <Text style={[styles.optionLabel, styles.deleteLabel]}>Delete Collection</Text>
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

export default CollectionOptionsModal;
