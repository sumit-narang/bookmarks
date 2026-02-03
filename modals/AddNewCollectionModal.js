/**
 * AddNewCollectionModal - Create a new collection and add place to it
 * Dynamic height bottom sheet with image and input
 */

import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Image,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Dimensions,
  DeviceEventEmitter,
} from 'react-native';
import { createCollection, addPlaceToCollection } from '../data/storage';
import CrossIcon from '../assets/icons/modal-cross-icon.svg';
import { successHaptic } from '../utils/haptics';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const MAX_MODAL_HEIGHT = SCREEN_HEIGHT * 0.9; // 90% of screen height

// Generate a color from string hash for consistent colors per place
const generateColorFromString = (str) => {
  if (!str) return 'rgba(100, 100, 100, 0.8)';
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  // Generate HSL color with good saturation and lightness for glow effect
  const h = Math.abs(hash % 360);
  const s = 50 + (Math.abs(hash >> 8) % 30); // 50-80% saturation
  const l = 40 + (Math.abs(hash >> 16) % 20); // 40-60% lightness
  return `hsl(${h}, ${s}%, ${l}%)`;
};

const AddNewCollectionModal = ({ route, navigation }) => {
  const { placeId, googlePlace } = route.params;
  const [collectionName, setCollectionName] = useState('');

  // Generate color based on place name/id for consistent coloring
  const primaryColor = generateColorFromString(googlePlace?.name || placeId);

  // Handle close
  const handleClose = () => {
    navigation.goBack();
  };

  // Handle save
  const handleSave = async () => {
    if (collectionName.trim().length === 0) return;

    successHaptic();
    // Create new collection with the place's image as cover
    const coverImage = googlePlace?.image || null;
    const newCollection = await createCollection(collectionName.trim(), coverImage);

    if (newCollection) {
      // Add place to the new collection
      await addPlaceToCollection(newCollection.id, placeId, googlePlace);

      // Emit event to refresh PlaceDetailsScreen
      console.log('Emitting collectionsUpdated event');
      DeviceEventEmitter.emit('collectionsUpdated');

      // Close modals one by one with small delay to ensure proper navigation
      navigation.goBack(); // Close AddNewCollection modal
      setTimeout(() => {
        navigation.goBack(); // Close SaveToCollection modal
      }, 50);
    }
  };

  const canSave = collectionName.trim().length > 0;

  return (
    <KeyboardAvoidingView
      style={styles.backdrop}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <TouchableOpacity
        style={styles.backdropInner}
        activeOpacity={1}
        onPress={handleClose}
      >
        <TouchableOpacity
          style={[styles.modal, { maxHeight: MAX_MODAL_HEIGHT }]}
          activeOpacity={1}
          onPress={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.heading} numberOfLines={1}>
              {googlePlace?.name || 'New Collection'}
            </Text>
            <TouchableOpacity style={styles.closeButton} onPress={handleClose}>
              <CrossIcon width={32} height={32} />
            </TouchableOpacity>
          </View>

          {/* Content */}
          <View style={styles.content}>
            {/* Place Image with Blurred Glow */}
            {googlePlace && (
              <View style={styles.imageContainer}>
                {/* Blurred glow behind image */}
                <View style={[
                  styles.glowCircle,
                  {
                    backgroundColor: primaryColor,
                    shadowColor: primaryColor,
                  }
                ]} />
                <Image
                  source={{ uri: googlePlace.image || googlePlace.images?.[0] }}
                  style={styles.placeImage}
                  resizeMode="cover"
                />
              </View>
            )}

            {/* Collection Name Input */}
            <TextInput
              style={styles.collectionInput}
              placeholder="Collection name"
              placeholderTextColor="rgba(255, 255, 255, 0.4)"
              value={collectionName}
              onChangeText={setCollectionName}
              autoFocus
              textAlign="center"
            />
          </View>

          {/* Save Button */}
          <View style={styles.bottomAction}>
            <TouchableOpacity
              style={[
                styles.saveButton,
                canSave ? styles.saveButtonEnabled : styles.saveButtonDisabled,
              ]}
              onPress={handleSave}
              disabled={!canSave}
              activeOpacity={0.8}
            >
              <Text style={[
                styles.saveButtonText,
                canSave ? styles.saveButtonTextEnabled : styles.saveButtonTextDisabled,
              ]}>
                Save Collection
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
  },

  backdropInner: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },

  modal: {
    backgroundColor: '#262626',
    borderTopLeftRadius: 34,
    borderTopRightRadius: 34,
    paddingTop: 16,
    paddingBottom: 32,
    overflow: 'hidden',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    position: 'relative',
    zIndex: 10,
  },

  heading: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: -0.3,
    textAlign: 'center',
  },

  closeButton: {
    position: 'absolute',
    right: 16,
  },

  content: {
    paddingHorizontal: 16,
    alignItems: 'center',
  },

  imageContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 32,
  },

  glowCircle: {
    position: 'absolute',
    width: 200,
    height: 160,
    borderRadius: 80,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 75,
    elevation: 50,
  },

  placeImage: {
    width: 200,
    height: 160,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },

  collectionInput: {
    width: '100%',
    fontSize: 24,
    fontWeight: '500',
    color: '#FFFFFF',
    letterSpacing: -0.3,
    marginTop: 32,
  },

  bottomAction: {
    paddingHorizontal: 16,
    paddingTop: 40,
  },

  saveButton: {
    width: '100%',
    height: 52,
    borderRadius: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },

  saveButtonDisabled: {
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
  },

  saveButtonEnabled: {
    backgroundColor: '#FFFFFF',
  },

  saveButtonText: {
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: -0.5,
  },

  saveButtonTextDisabled: {
    color: 'rgba(255, 255, 255, 0.7)',
  },

  saveButtonTextEnabled: {
    color: '#000000',
  },
});

export default AddNewCollectionModal;
