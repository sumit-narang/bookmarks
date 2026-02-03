/**
 * ImportGoogleModal - Import places from Google Maps
 * Centered modal with text input for Google Maps URLs
 */

import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { createCollection, addPlaceToCollection } from '../data/storage';
import { getPlaceDetails, searchPlacesGoogle } from '../data/placesApi';
import CrossIcon from '../assets/icons/modal-cross-icon.svg';

/**
 * Extract place ID from various Google Maps URL formats
 * Supports:
 * - https://www.google.com/maps/place/...data=...!1s[PLACE_ID]...
 * - https://maps.google.com/?cid=[CID]
 * - https://www.google.com/maps/place/?q=place_id:[PLACE_ID]
 * - https://maps.app.goo.gl/[SHORT_CODE] (needs redirect follow)
 */
const extractPlaceIdFromUrl = (url) => {
  try {
    // Pattern 1: place_id in data parameter (most common)
    // Format: ...data=...!1s[PLACE_ID]...
    const dataMatch = url.match(/!1s(0x[a-fA-F0-9]+:0x[a-fA-F0-9]+)/);
    if (dataMatch) {
      return dataMatch[1];
    }

    // Pattern 2: place_id in query parameter
    // Format: ?q=place_id:PLACE_ID or &place_id=PLACE_ID
    const placeIdMatch = url.match(/place_id[=:]([^&\s]+)/i);
    if (placeIdMatch) {
      return placeIdMatch[1];
    }

    // Pattern 3: ftid parameter (another format)
    const ftidMatch = url.match(/ftid=(0x[a-fA-F0-9]+:0x[a-fA-F0-9]+)/);
    if (ftidMatch) {
      return ftidMatch[1];
    }

    // Pattern 4: CID (Customer ID) - would need conversion via API
    const cidMatch = url.match(/[?&]cid=(\d+)/);
    if (cidMatch) {
      return `cid:${cidMatch[1]}`; // Mark as CID for special handling
    }

    return null;
  } catch (error) {
    console.error('Error extracting place ID:', error);
    return null;
  }
};

/**
 * Extract place name from Google Maps URL for search fallback
 */
const extractPlaceNameFromUrl = (url) => {
  try {
    // Try to get place name from URL path
    // Format: /maps/place/PLACE+NAME/@...
    const nameMatch = url.match(/\/place\/([^/@]+)/);
    if (nameMatch) {
      return decodeURIComponent(nameMatch[1].replace(/\+/g, ' '));
    }
    return null;
  } catch (error) {
    return null;
  }
};

const ImportGoogleModal = ({ navigation }) => {
  const [googleLink, setGoogleLink] = useState('');
  const [isImporting, setIsImporting] = useState(false);

  // Handle close
  const handleClose = () => {
    navigation.goBack();
  };

  // Validate Google Maps link
  const isValidGoogleLink = (link) => {
    return link.includes('google.com/maps') ||
           link.includes('maps.google.com') ||
           link.includes('goo.gl/maps') ||
           link.includes('maps.app.goo.gl');
  };

  // Fetch place by ID or search by name
  const fetchPlace = async (url) => {
    // First try to extract place ID
    const placeId = extractPlaceIdFromUrl(url);

    if (placeId && !placeId.startsWith('cid:')) {
      // We have a valid place ID, fetch directly
      const place = await getPlaceDetails(placeId);
      if (place) {
        return place;
      }
    }

    // Fallback: try to extract place name and search
    const placeName = extractPlaceNameFromUrl(url);
    if (placeName) {
      const searchResults = await searchPlacesGoogle(placeName);
      if (searchResults.length > 0) {
        // Get details for the first result
        const place = await getPlaceDetails(searchResults[0].placeId);
        if (place) {
          return place;
        }
      }
    }

    return null;
  };

  // Handle import
  const handleImport = async () => {
    if (!googleLink.trim()) {
      Alert.alert('Error', 'Please paste Google Maps links');
      return;
    }

    // Split input by newlines to support multiple URLs
    const lines = googleLink.trim().split('\n').filter(line => line.trim());
    const validLinks = lines.filter(isValidGoogleLink);

    if (validLinks.length === 0) {
      Alert.alert(
        'Invalid Links',
        'Please paste valid Google Maps place links.\n\nTip: Open a place in Google Maps, tap Share, and copy the link.'
      );
      return;
    }

    setIsImporting(true);

    try {
      const importedPlaces = [];
      const failedCount = { value: 0 };

      // Fetch each place
      for (const link of validLinks) {
        try {
          const place = await fetchPlace(link.trim());
          if (place) {
            importedPlaces.push(place);
          } else {
            failedCount.value++;
          }
        } catch (err) {
          console.error('Error fetching place:', err);
          failedCount.value++;
        }
      }

      if (importedPlaces.length === 0) {
        Alert.alert(
          'Import Failed',
          'Could not fetch any places. Please make sure you\'re using valid Google Maps place links.'
        );
        setIsImporting(false);
        return;
      }

      // Create a new collection for imported places
      const collectionName = importedPlaces.length === 1
        ? importedPlaces[0].name
        : 'Imported from Google';

      const newCollection = await createCollection(
        collectionName,
        importedPlaces[0].image
      );

      if (newCollection) {
        // Add all places to the collection
        for (const place of importedPlaces) {
          await addPlaceToCollection(newCollection.id, place.placeId, place);
        }

        const successMessage = failedCount.value > 0
          ? `Imported ${importedPlaces.length} places to "${collectionName}"\n(${failedCount.value} links could not be imported)`
          : `Imported ${importedPlaces.length} place${importedPlaces.length > 1 ? 's' : ''} to "${collectionName}"`;

        Alert.alert(
          'Import Successful',
          successMessage,
          [
            {
              text: 'View Collection',
              onPress: () => {
                navigation.popToTop();
                navigation.navigate('LibraryTab');
              },
            },
          ]
        );
      }
    } catch (error) {
      console.error('Import error:', error);
      Alert.alert('Import Failed', 'Unable to import places. Please try again.');
    }

    setIsImporting(false);
  };

  const canImport = googleLink.trim().length > 0 && !isImporting;

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
          style={styles.modal}
          activeOpacity={1}
          onPress={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.heading}>Import from Google</Text>
            <TouchableOpacity onPress={handleClose}>
              <CrossIcon width={32} height={32} />
            </TouchableOpacity>
          </View>

          {/* Content */}
          <View style={styles.content}>
            {/* Instructions */}
            <View style={styles.instructionsBox}>
              <Ionicons name="information-circle-outline" size={20} color="#52949D" />
              <Text style={styles.instructionsText}>
                Open a place in Google Maps, tap Share, and copy the link. You can paste multiple links (one per line).
              </Text>
            </View>

            {/* Input Section */}
            <View style={styles.inputSection}>
              <Text style={styles.inputLabel}>Google Maps Links</Text>
              <TextInput
                style={styles.textInput}
                placeholder="https://maps.google.com/maps/place/..."
                placeholderTextColor="rgba(255, 255, 255, 0.4)"
                value={googleLink}
                onChangeText={setGoogleLink}
                autoCapitalize="none"
                autoCorrect={false}
                multiline
                numberOfLines={4}
              />
            </View>

            {/* Import Button */}
            <TouchableOpacity
              style={[
                styles.importButton,
                !canImport && styles.importButtonDisabled,
              ]}
              onPress={handleImport}
              disabled={!canImport}
              activeOpacity={0.8}
            >
              {isImporting ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={[
                  styles.importButtonText,
                  !canImport && styles.importButtonTextDisabled,
                ]}>
                  Import Places
                </Text>
              )}
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
  },

  instructionsBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(82, 148, 157, 0.15)',
    borderRadius: 12,
    padding: 12,
    gap: 10,
    marginBottom: 16,
  },

  instructionsText: {
    flex: 1,
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.7)',
    lineHeight: 18,
  },

  inputSection: {
    marginBottom: 16,
  },

  inputLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.7)',
    marginBottom: 8,
  },

  textInput: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 14,
    color: '#FFFFFF',
    minHeight: 100,
    textAlignVertical: 'top',
  },

  importButton: {
    backgroundColor: '#52949D',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },

  importButtonDisabled: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },

  importButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },

  importButtonTextDisabled: {
    color: 'rgba(255, 255, 255, 0.4)',
  },
});

export default ImportGoogleModal;
