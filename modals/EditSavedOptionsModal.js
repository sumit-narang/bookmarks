/**
 * EditSavedOptionsModal - Options for editing saved collections
 * Bottom modal with "Edit Saved Collection" option
 */

import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import CrossIcon from '../assets/icons/modal-cross-icon.svg';
import EditIcon from '../assets/icons/edit.svg';
import { mediumHaptic } from '../utils/haptics';

const EditSavedOptionsModal = ({ route, navigation }) => {
  const { placeId, googlePlace } = route.params;

  // Handle close
  const handleClose = () => {
    navigation.goBack();
  };

  // Handle edit saved collection
  const handleEditSavedCollection = () => {
    mediumHaptic();
    navigation.goBack();
    // Navigate to edit collections modal
    setTimeout(() => {
      navigation.navigate('EditPlaceCollections', { placeId, googlePlace });
    }, 100);
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
          {/* Edit Saved Collection Button */}
          <TouchableOpacity
            style={styles.optionButton}
            onPress={handleEditSavedCollection}
            activeOpacity={0.7}
          >
            <EditIcon width={24} height={24} />
            <Text style={styles.optionLabel}>Edit Saved Collection</Text>
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

export default EditSavedOptionsModal;
