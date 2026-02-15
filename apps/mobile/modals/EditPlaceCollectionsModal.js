/**
 * EditPlaceCollectionsModal - Edit which collections a place is saved to
 * Shows only collections where the place is currently saved, all pre-checked
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
import {
  getCollectionsForPlace,
  removePlaceFromCollection,
  getPlaceById,
  updatePlace,
} from '../data/storage';
import CrossIcon from '../assets/icons/modal-cross-icon.svg';
import SelectedIcon from '../assets/icons/selected-selection.svg';
import { selectionHaptic, successHaptic } from '../utils/haptics';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const MAX_MODAL_HEIGHT = SCREEN_HEIGHT * 0.9;

const EditPlaceCollectionsModal = ({ route, navigation }) => {
  const { placeId, googlePlace } = route.params;
  const [savedCollections, setSavedCollections] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [isSaving, setIsSaving] = useState(false);

  // Load only collections where this place is saved
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const actualPlaceId = googlePlace?.placeId || placeId;
    const collections = await getCollectionsForPlace(actualPlaceId);
    setSavedCollections(collections);
    // Pre-check all collections
    setSelectedIds(new Set(collections.map((c) => c.id)));
  };

  // Handle close
  const handleClose = () => {
    navigation.goBack();
  };

  // Toggle collection selection
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
    successHaptic();
    setIsSaving(true);
    const actualPlaceId = googlePlace?.placeId || placeId;

    // Find collections to remove (unchecked ones)
    const toRemove = savedCollections.filter((c) => !selectedIds.has(c.id));

    // Remove place from deselected collections
    for (const collection of toRemove) {
      await removePlaceFromCollection(collection.id, actualPlaceId);
    }

    // If place is removed from all collections, mark it as unsaved
    if (selectedIds.size === 0) {
      const place = await getPlaceById(actualPlaceId);
      if (place) {
        await updatePlace({ ...place, saved: false });
      }
    }

    // Emit event to refresh PlaceDetailsScreen
    DeviceEventEmitter.emit('collectionsUpdated');

    navigation.goBack();
  };

  // Get button text
  const getButtonText = () => {
    if (isSaving) return 'Saving...';
    if (selectedIds.size === 0) return 'Remove from all';
    if (selectedIds.size === 1) return 'Save to 1 collection';
    return `Save to ${selectedIds.size} collections`;
  };

  // Calculate if we need scrolling
  const needsScrolling = savedCollections.length > 4;

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
          <Text style={styles.heading}>Edit Saved Collection</Text>
          <TouchableOpacity onPress={handleClose}>
            <CrossIcon width={32} height={32} />
          </TouchableOpacity>
        </View>

        {/* Content */}
        <View style={styles.content}>
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
            {savedCollections.map((collection) => {
              const isSelected = selectedIds.has(collection.id);
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
                    <Text style={styles.collectionCount}>
                      {collection.placeCount} places
                    </Text>
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
            style={styles.saveButton}
            onPress={handleSave}
            disabled={isSaving}
            activeOpacity={0.8}
          >
            <Text style={styles.saveButtonText}>
              {getButtonText()}
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
    marginTop: 16,
  },

  selectLabel: {
    fontSize: 15,
    color: 'rgba(255, 255, 255, 0.7)',
    letterSpacing: -0.3,
  },

  collectionsList: {
    marginTop: 16,
    maxHeight: 300,
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

  collectionCount: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.5)',
    letterSpacing: -0.3,
    lineHeight: 20,
    marginTop: 4,
  },

  bottomAction: {
    paddingTop: 24,
  },

  saveButton: {
    backgroundColor: '#FFFFFF',
    borderRadius: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },

  saveButtonText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#000000',
    letterSpacing: -0.5,
  },
});

export default EditPlaceCollectionsModal;
