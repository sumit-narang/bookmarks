/**
 * AddToExistingCollectionModal - Select an existing collection to add place to
 * Dynamic height bottom sheet - expands based on content up to max height
 */

import { useState, useEffect } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Dimensions,
  DeviceEventEmitter,
} from 'react-native';
import { getCollections, addPlaceToCollection } from '../data/storage';
import CrossIcon from '../assets/icons/modal-cross-icon.svg';
import SelectedIcon from '../assets/icons/selected-selection.svg';
import BookmarkIcon from '../assets/icons/bookmark.svg';
import { selectionHaptic, successHaptic } from '../utils/haptics';

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

const AddToExistingCollectionModal = ({ route, navigation }) => {
  const { placeId, googlePlace } = route.params;
  const [collections, setCollections] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [isSaving, setIsSaving] = useState(false);

  // Generate color based on place name/id for consistent coloring
  const primaryColor = generateColorFromString(googlePlace?.name || placeId);

  // Load collections
  useEffect(() => {
    loadCollections();
  }, []);

  const loadCollections = async () => {
    const data = await getCollections();
    setCollections(data);
  };

  // Handle close
  const handleClose = () => {
    navigation.goBack();
  };

  // Toggle collection selection (multiple selection)
  const handleToggleCollection = (collection) => {
    selectionHaptic();
    setSelectedIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(collection.id)) {
        newSet.delete(collection.id);
      } else {
        newSet.add(collection.id);
      }
      return newSet;
    });
  };

  // Handle save button
  const handleSave = async () => {
    if (selectedIds.size === 0) return;

    successHaptic();
    setIsSaving(true);

    // Add place to all selected collections
    for (const collectionId of selectedIds) {
      await addPlaceToCollection(collectionId, placeId, googlePlace);
    }

    // Emit event to refresh PlaceDetailsScreen
    console.log('Emitting collectionsUpdated event');
    DeviceEventEmitter.emit('collectionsUpdated');

    // Close modals one by one with small delay to ensure proper navigation
    navigation.goBack(); // Close AddToExisting modal
    setTimeout(() => {
      navigation.goBack(); // Close SaveToCollection modal
    }, 50);
  };

  // Calculate if we need scrolling (more than 4 collections)
  const needsScrolling = collections.length > 4;

  return (
    <TouchableOpacity
      style={styles.backdrop}
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
            {googlePlace?.name || 'Select Collection'}
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

          {/* Select Collection Label */}
          <Text style={styles.selectLabel}>Select Collection</Text>

          {/* Collections List */}
          <ScrollView
            style={[
              styles.collectionsList,
              !needsScrolling && { flexGrow: 0 }
            ]}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.collectionsListContent}
            scrollEnabled={needsScrolling}
          >
            {collections.map((collection) => {
              const isSelected = selectedIds.has(collection.id);
              const isAlreadySaved = collection.places?.includes(placeId);
              return (
                <TouchableOpacity
                  key={collection.id}
                  style={[
                    styles.collectionItem,
                    isSelected && styles.collectionItemSelected,
                  ]}
                  onPress={() => handleToggleCollection(collection)}
                  activeOpacity={0.7}
                >
                  <Image
                    source={{ uri: collection.coverImage }}
                    style={styles.collectionThumb}
                    resizeMode="cover"
                  />
                  <View style={styles.collectionInfo}>
                    <Text style={styles.collectionName}>{collection.name}</Text>
                    <View style={styles.collectionMeta}>
                      <Text style={styles.collectionCount}>
                        {collection.placeCount} places
                      </Text>
                      {isAlreadySaved && (
                        <>
                          <View style={styles.metaDot} />
                          <View style={styles.bookmarkIcon}>
                            <BookmarkIcon width={12} height={12} />
                          </View>
                          <Text style={styles.alreadySavedText}>Already saved</Text>
                        </>
                      )}
                    </View>
                  </View>
                  {isSelected && (
                    <SelectedIcon width={14} height={14} />
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Save Button */}
        <View style={styles.bottomAction}>
          <TouchableOpacity
            style={[
              styles.saveButton,
              selectedIds.size === 0 && styles.saveButtonDisabled,
            ]}
            onPress={handleSave}
            disabled={selectedIds.size === 0 || isSaving}
            activeOpacity={0.8}
          >
            <Text style={[
              styles.saveButtonText,
              selectedIds.size === 0 && styles.saveButtonTextDisabled,
            ]}>
              {isSaving ? 'Saving...' : 'Save to Collection'}
            </Text>
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
  },

  imageContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 32,
    alignSelf: 'center',
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

  selectLabel: {
    fontSize: 15,
    color: 'rgba(255, 255, 255, 0.7)',
    letterSpacing: -0.3,
    marginTop: 32,
  },

  collectionsList: {
    marginTop: 16,
    maxHeight: 250,
  },

  collectionsListContent: {
    gap: 8,
  },

  collectionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingLeft: 8,
    paddingRight: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0)',
  },

  collectionItemSelected: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },

  collectionThumb: {
    width: 44,
    height: 44,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },

  collectionInfo: {
    flex: 1,
    marginLeft: 12,
  },

  collectionName: {
    fontSize: 17,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.9)',
    lineHeight: 20,
    letterSpacing: -0.3,
  },

  collectionMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },

  collectionCount: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.5)',
    letterSpacing: -0.3,
    lineHeight: 20,
  },

  metaDot: {
    width: 2,
    height: 2,
    borderRadius: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
    marginLeft: 6,
  },

  bookmarkIcon: {
    marginLeft: 6,
  },

  alreadySavedText: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.5)',
    letterSpacing: -0.3,
    lineHeight: 20,
    marginLeft: 4,
  },

  bottomAction: {
    paddingHorizontal: 16,
    paddingTop: 40,
  },

  saveButton: {
    backgroundColor: '#FFFFFF',
    borderRadius: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },

  saveButtonDisabled: {
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
  },

  saveButtonText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#000000',
    letterSpacing: -0.5,
  },

  saveButtonTextDisabled: {
    color: 'rgba(0, 0, 0, 0.5)',
  },
});

export default AddToExistingCollectionModal;
