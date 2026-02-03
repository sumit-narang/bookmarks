/**
 * SaveToCollectionModal - Choose to save to new or existing collection
 * Bottom modal with two pill buttons
 */

import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import CrossIcon from '../assets/icons/modal-cross-icon.svg';
import AddNewIcon from '../assets/icons/add-new-icon.svg';
import AddExistingIcon from '../assets/icons/add-existing-icon.svg';
import { mediumHaptic } from '../utils/haptics';

const SaveToCollectionModal = ({ route, navigation }) => {
  const { placeId, googlePlace } = route.params;

  // Handle close
  const handleClose = () => {
    navigation.goBack();
  };

  // Handle "New Collection" tap
  const handleNewCollection = () => {
    mediumHaptic();
    navigation.navigate('AddNewCollection', { placeId, googlePlace });
  };

  // Handle "Existing Collection" tap
  const handleExistingCollection = () => {
    mediumHaptic();
    navigation.navigate('AddToExistingCollection', { placeId, googlePlace });
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
          <Text style={styles.heading}>Save to Collection</Text>
          <TouchableOpacity onPress={handleClose}>
            <CrossIcon width={32} height={32} />
          </TouchableOpacity>
        </View>

        {/* Content */}
        <View style={styles.content}>
          {/* New Collection Button */}
          <TouchableOpacity
            style={styles.optionButton}
            onPress={handleNewCollection}
            activeOpacity={0.7}
          >
            <AddNewIcon width={24} height={24} />
            <Text style={styles.optionLabel}>New Collection</Text>
          </TouchableOpacity>

          {/* Existing Collection Button */}
          <TouchableOpacity
            style={styles.optionButton}
            onPress={handleExistingCollection}
            activeOpacity={0.7}
          >
            <AddExistingIcon width={24} height={24} />
            <Text style={styles.optionLabel}>Existing Collection</Text>
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
});

export default SaveToCollectionModal;
