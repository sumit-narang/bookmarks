/**
 * ShareCollectionModal - Select collections to share
 * Bottom modal with multi-select list and share button
 */

import { useState, useEffect } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  Share,
  Alert,
  StyleSheet,
  Dimensions,
} from 'react-native';
import * as Linking from 'expo-linking';
import { getCollections, getPlacesInCollection } from '../data/storage';
import CrossIcon from '../assets/icons/modal-cross-icon.svg';
import SelectedIcon from '../assets/icons/selected-selection.svg';
import { selectionHaptic, successHaptic, mediumHaptic } from '../utils/haptics';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const MAX_MODAL_HEIGHT = SCREEN_HEIGHT * 0.9;

const ShareCollectionModal = ({ navigation }) => {
  const [collections, setCollections] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [isSharing, setIsSharing] = useState(false);

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

  // Generate shareable data
  const generateShareData = async () => {
    const selectedCollections = collections.filter((c) => selectedIds.has(c.id));

    // Build share data with places
    const shareData = await Promise.all(
      selectedCollections.map(async (collection) => {
        const places = await getPlacesInCollection(collection.id);
        return {
          id: collection.id,
          name: collection.name,
          places: places.map((place) => ({
            id: place.id || place.placeId,
            name: place.name,
            type: place.type,
            image: place.image,
            address: place.address,
            rating: place.rating,
            reviewCount: place.reviewCount,
          })),
        };
      })
    );

    // Encode as base64
    const jsonData = JSON.stringify(shareData);
    const base64Data = btoa(encodeURIComponent(jsonData));

    // Create URL using Expo Linking (works for both mobile and web)
    const shareUrl = Linking.createURL('shared', {
      queryParams: { data: base64Data },
    });

    return shareUrl;
  };

  // Handle share
  const handleShare = async () => {
    if (selectedIds.size === 0) return;

    mediumHaptic();
    setIsSharing(true);
    try {
      const shareUrl = await generateShareData();
      const collectionNames = collections
        .filter((c) => selectedIds.has(c.id))
        .map((c) => c.name)
        .join(', ');

      const result = await Share.share({
        message: `Check out my saved places: ${collectionNames}\n\n${shareUrl}`,
        title: 'Share Collections',
      });

      // Only close modal if share was completed (not dismissed)
      if (result.action === Share.sharedAction) {
        successHaptic();
        navigation.goBack();
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        Alert.alert('Error', 'Failed to share');
      }
    }
    setIsSharing(false);
  };

  // Get button text based on selection count
  const getButtonText = () => {
    if (isSharing) return 'Sharing...';
    if (selectedIds.size === 0) return 'Share Collection';
    if (selectedIds.size === 1) return 'Share 1 Collection';
    return `Share ${selectedIds.size} Collections`;
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
          <Text style={styles.heading}>Share Collections</Text>
          <TouchableOpacity style={styles.closeButton} onPress={handleClose}>
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
            {collections.map((collection) => {
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

        {/* Share Button */}
        <View style={styles.bottomAction}>
          <TouchableOpacity
            style={[
              styles.shareButton,
              selectedIds.size === 0 && styles.shareButtonDisabled,
            ]}
            onPress={handleShare}
            disabled={selectedIds.size === 0 || isSharing}
            activeOpacity={0.8}
          >
            <Text style={[
              styles.shareButtonText,
              selectedIds.size === 0 && styles.shareButtonTextDisabled,
            ]}>
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

  selectLabel: {
    fontSize: 15,
    color: 'rgba(255, 255, 255, 0.7)',
    letterSpacing: -0.3,
    marginTop: 24,
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
    paddingHorizontal: 16,
    paddingTop: 40,
  },

  shareButton: {
    backgroundColor: '#FFFFFF',
    borderRadius: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },

  shareButtonDisabled: {
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
  },

  shareButtonText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#000000',
    letterSpacing: -0.5,
  },

  shareButtonTextDisabled: {
    color: 'rgba(0, 0, 0, 0.5)',
  },
});

export default ShareCollectionModal;
