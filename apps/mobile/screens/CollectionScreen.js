/**
 * CollectionScreen - Shows saved collections and all saved places
 * Two tabs: Collection (shows collections) and Places (shows all saved places)
 * Requires authentication to view collections
 */

import { useState, useEffect } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { getCollections, getPlaces, getCollectionsForPlace } from '../data/storage';
import ShareIcon from '../assets/icons/share.svg';
import GoogleIcon from '../assets/icons/google-icon.svg';
import AppleIcon from '../assets/icons/apple-icon.svg';
import BookmarkIcon from '../assets/icons/bookmark.svg';
import ChevronForwardIcon from '../assets/icons/chevron-forward.svg';
import MoreOptionIcon from '../assets/icons/more-option.svg';
import { colors } from '../styles/colors';
import { typography } from '../styles/typography';
import { useAuth } from '../context/AuthContext';
import { mediumHaptic, lightHaptic } from '../utils/haptics';

// Empty state image
const CollectionEmptyImage = require('../assets/icons/collection-empty.png');

const CollectionScreen = ({ navigation }) => {
  const { isAuthenticated, signInWithGoogle, signInWithApple } = useAuth();
  const [collections, setCollections] = useState([]);
  const [allSavedPlaces, setAllSavedPlaces] = useState([]);
  const [activeTab, setActiveTab] = useState('collection');
  const [placeCollections, setPlaceCollections] = useState({});

  // Format collections display text
  const formatCollectionsText = (collectionsArray) => {
    if (!collectionsArray || collectionsArray.length === 0) return '';

    const firstTwo = collectionsArray.slice(0, 2).map((c) => c.name);
    const remaining = collectionsArray.length - 2;

    if (remaining > 0) {
      return `${firstTwo.join(', ')} +${remaining} more`;
    }
    return firstTwo.join(', ');
  };

  // Load data when screen loads (only if authenticated)
  useEffect(() => {
    if (isAuthenticated) {
      loadData();
    }
  }, [isAuthenticated]);

  // Reload when screen comes into focus (only if authenticated)
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      if (isAuthenticated) {
        loadData();
      }
    });
    return unsubscribe;
  }, [navigation, isAuthenticated]);

  const loadData = async () => {
    // Get collections sorted by creation date (newest first)
    const collectionsData = await getCollections();
    const sortedCollections = [...collectionsData].sort((a, b) => {
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
    setCollections(sortedCollections);

    // Get all saved places (places that are marked as saved)
    const placesData = await getPlaces();
    const saved = placesData.filter((place) => place.saved);
    setAllSavedPlaces(saved);

    // Load collections for each saved place
    const collectionsMap = {};
    for (const place of saved) {
      const placeId = place.id;
      const placeColls = await getCollectionsForPlace(placeId);
      collectionsMap[placeId] = placeColls;
    }
    setPlaceCollections(collectionsMap);
  };

  // Handle tapping on a collection
  const handleCollectionPress = (collection) => {
    mediumHaptic();
    navigation.navigate('PlacesInCollection', { collectionId: collection.id });
  };

  // Handle tapping on a place card
  const handlePlacePress = (place) => {
    mediumHaptic();
    navigation.navigate('PlaceDetails', { placeId: place.id });
  };

  // Handle share button
  const handleShare = () => {
    mediumHaptic();
    navigation.navigate('ShareCollection');
  };

  // Calculate total places across all collections
  const totalPlaces = allSavedPlaces.length;

  // Handle Google Sign In
  const handleGoogleSignIn = async () => {
    mediumHaptic();
    try {
      await signInWithGoogle();
    } catch (error) {
      Alert.alert('Error', 'Failed to sign in with Google. Please try again.');
    }
  };

  // Handle Apple Sign In
  const handleAppleSignIn = async () => {
    mediumHaptic();
    try {
      await signInWithApple();
    } catch (error) {
      if (error.code !== 'ERR_CANCELED') {
        Alert.alert('Error', 'Failed to sign in with Apple. Please try again.');
      }
    }
  };

  // Handle more options button press
  const handleMoreOptions = (place) => {
    mediumHaptic();
    navigation.navigate('PlaceOptions', { place });
  };

  // Show sign up prompt if not authenticated
  if (!isAuthenticated) {
    return (
      <View style={styles.container}>
        <SafeAreaView style={styles.safeArea} edges={['top']}>
          <Text style={styles.screenTitle}>Library</Text>
        <View style={styles.signUpContainer}>
          <Image
            source={CollectionEmptyImage}
            style={styles.signUpImage}
            resizeMode="contain"
          />
          <Text style={styles.signUpTitle}>Sign up to view your collections</Text>
          <Text style={styles.signUpSubtitle}>
            Create an account to save places{'\n'}and organize them into collections
          </Text>

          {/* Auth Buttons */}
          <View style={styles.authButtonContainer}>
            {/* Google Sign In Button */}
            <TouchableOpacity
              style={styles.authButton}
              onPress={handleGoogleSignIn}
              activeOpacity={0.7}
            >
              <GoogleIcon width={24} height={24} />
              <Text style={styles.authButtonText}>Continue with Google</Text>
            </TouchableOpacity>

            {/* Apple Sign In Button - iOS only */}
            {Platform.OS === 'ios' && (
              <TouchableOpacity
                style={styles.authButton}
                onPress={handleAppleSignIn}
                activeOpacity={0.7}
              >
                <AppleIcon width={24} height={24} />
                <Text style={styles.authButtonText}>Continue with Apple</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
      {/* Screen Title */}
      <Text style={styles.screenTitle}>Library</Text>

      {/* Top Bar with Tabs */}
      <View style={styles.topBar}>
        <View style={styles.tabsContainer}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'collection' && styles.tabActive]}
            onPress={() => { lightHaptic(); setActiveTab('collection'); }}
          >
            <Text style={[styles.tabText, activeTab === 'collection' && styles.tabTextActive]}>
              Collection
            </Text>
            <Text style={[styles.tabCount, activeTab === 'collection' && styles.tabCountActive]}>{collections.length}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tab, activeTab === 'places' && styles.tabActive]}
            onPress={() => { lightHaptic(); setActiveTab('places'); }}
          >
            <Text style={[styles.tabText, activeTab === 'places' && styles.tabTextActive]}>
              Places
            </Text>
            <Text style={[styles.tabCount, activeTab === 'places' && styles.tabCountActive]}>{totalPlaces}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.shareBtn} onPress={handleShare}>
          <ShareIcon width={24} height={24} />
        </TouchableOpacity>
      </View>

      {/* Content Area - Scrollable */}
      <ScrollView style={styles.contentArea} showsVerticalScrollIndicator={false}>
        {/* Collection Tab Content */}
        {activeTab === 'collection' && (
          <>
            {collections.map((collection) => (
              <View key={collection.id} style={styles.section}>
                {/* Section Header */}
                <TouchableOpacity
                  style={styles.sectionHeader}
                  onPress={() => handleCollectionPress(collection)}
                >
                  <Text style={styles.sectionTitle}>{collection.name}</Text>
                  <Text style={styles.sectionCount}>{collection.placeCount}</Text>
                  <ChevronForwardIcon width={20} height={20} />
                </TouchableOpacity>

                {/* Horizontal Places Grid - only show actual places, no placeholders */}
                {collection.placeCount > 0 && (
                  <View style={styles.placesGridWrapper}>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.placesGrid}
                    >
                      {collection.places
                        .map((placeId) =>
                          allSavedPlaces.find(
                            (p) => p.id === placeId || p.placeId === placeId
                          )
                        )
                        .filter(Boolean)
                        .map((place, index, arr) => {
                          const isFirst = index === 0;
                          const isLast = index === arr.length - 1;
                          return (
                            <TouchableOpacity
                              key={`${collection.id}-${place.id}`}
                              style={[
                                styles.placeContainer,
                                isFirst && styles.placeContainerFirst,
                                isLast && styles.placeContainerLast,
                              ]}
                              onPress={() => handlePlacePress(place)}
                              activeOpacity={0.8}
                            >
                              {/* Blurred background image */}
                              <Image
                                source={{ uri: place.image }}
                                style={styles.placeBackgroundImage}
                                blurRadius={32}
                                resizeMode="cover"
                              />
                              {/* Dark overlay */}
                              <View style={styles.placeBackgroundOverlay} />
                              {/* Sharp foreground image */}
                              <View style={styles.placeImageWrapper}>
                                <Image
                                  source={{ uri: place.image }}
                                  style={styles.placeImage}
                                  resizeMode="cover"
                                />
                              </View>
                              {/* Place name with masked blend effect */}
                              <MaskedView
                                style={styles.maskedTextContainer}
                                maskElement={
                                  <Text style={styles.placeName} numberOfLines={1}>
                                    {place.name}
                                  </Text>
                                }
                              >
                                <Image
                                  source={{ uri: place.image }}
                                  style={styles.maskedTextBackground}
                                  blurRadius={8}
                                  resizeMode="cover"
                                />
                                <View style={styles.maskedTextOverlay} />
                              </MaskedView>
                            </TouchableOpacity>
                          );
                        })}
                    </ScrollView>
                  </View>
                )}
              </View>
            ))}

            {/* Empty State for Collections */}
            {collections.length === 0 && (
              <View style={styles.emptyState}>
                <Ionicons name="folder-outline" size={48} color={colors.textSecondary} />
                <Text style={styles.emptyStateText}>No collections yet</Text>
                <Text style={styles.emptyStateSubtext}>
                  Save places to create your first collection
                </Text>
              </View>
            )}
          </>
        )}

        {/* Places Tab Content - Shows ALL saved places */}
        {activeTab === 'places' && (
          <View style={styles.allPlacesContainer}>
            {allSavedPlaces.map((place) => (
              <TouchableOpacity
                key={place.id}
                style={styles.placeListItem}
                onPress={() => handlePlacePress(place)}
                activeOpacity={0.7}
              >
                <Image
                  source={{ uri: place.image }}
                  style={styles.placeListImage}
                  resizeMode="cover"
                />
                <View style={styles.placeListInfo}>
                  <Text style={styles.placeListName} numberOfLines={1}>
                    {place.name}
                  </Text>
                  <Text style={styles.placeListType} numberOfLines={1}>
                    {place.type}
                  </Text>
                  {placeCollections[place.id]?.length > 0 && (
                    <View style={styles.placeListCollections}>
                      <BookmarkIcon width={12} height={12} />
                      <Text style={styles.placeListCollectionsText} numberOfLines={1}>
                        {formatCollectionsText(placeCollections[place.id])}
                      </Text>
                    </View>
                  )}
                </View>
                <TouchableOpacity
                  style={styles.moreOptionsButton}
                  onPress={() => handleMoreOptions(place)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <MoreOptionIcon width={24} height={24} />
                </TouchableOpacity>
              </TouchableOpacity>
            ))}

            {/* Empty State for Places */}
            {allSavedPlaces.length === 0 && (
              <View style={styles.emptyState}>
                <Ionicons name="location-outline" size={48} color={colors.textSecondary} />
                <Text style={styles.emptyStateText}>No saved places</Text>
                <Text style={styles.emptyStateSubtext}>
                  Search and save places to see them here
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Bottom spacer to push content above tab bar */}
        <View style={styles.bottomSpacer} />
      </ScrollView>
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },

  safeArea: {
    flex: 1,
  },

  screenTitle: {
    fontSize: 24,
    fontWeight: '600',
    letterSpacing: -0.7,
    color: '#FFFFFF',
    paddingHorizontal: 16,
    marginTop: 24,
  },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 16,
  },

  tabsContainer: {
    flexDirection: 'row',
    gap: 8,
  },

  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    height: 36,
    borderRadius: 10,
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.10)',
  },

  tabActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
    borderColor: 'transparent',
  },

  tabText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#FFFFFF',
  },

  tabTextActive: {
    color: '#FFFFFF',
  },

  tabCount: {
    fontSize: 15,
    fontWeight: '400',
    color: 'rgba(255, 255, 255, 0.5)',
  },

  // tabCountActive: {
  //   color: '#FFFFFF',
  // },

  shareBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },

  contentArea: {
    flex: 1,
  },

  bottomSpacer: {
    height: 100,
    width: '100%',
  },

  section: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },

  sectionTitle: {
    fontSize: 16,
    letterSpacing: -0.5,
    fontWeight: '500',
    color: '#FFFFFF',
    marginRight: 6,
  },

  sectionCount: {
    fontSize: 15,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.5)',
  },

  placesGridWrapper: {
    overflow: 'hidden',
    borderRadius: 12,
  },

  placesGrid: {
    flexDirection: 'row',
    gap: 2,
  },

  placeContainer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    alignItems: 'center',
    overflow: 'hidden',
    position: 'relative',
  },

  placeContainerFirst: {
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
  },

  placeContainerLast: {
    borderTopRightRadius: 12,
    borderBottomRightRadius: 12,
  },

  placeBackgroundImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },

  placeBackgroundOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },

  placeImageWrapper: {
    width: 72,
    height: 72,
    borderRadius: 10,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.32,
    shadowRadius: 12,
    elevation: 8,
  },

  placeImage: {
    width: 72,
    height: 72,
    backgroundColor: colors.inputBackground,
  },

  placeName: {
    width: 72,
    fontSize: 14,
    fontWeight: '400',
    letterSpacing: -0.3,
    color: 'rgba(255, 255, 255, 0.8)',
    textAlign: 'center',
    backgroundColor: 'transparent',
  },

  maskedTextContainer: {
    width: 72,
    height: 20,
    marginTop: 4,
  },

  maskedTextBackground: {
    width: 72,
    height: 20,
  },

  maskedTextOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 255, 255, 0.6)',
  },

  // All Places list styles
  allPlacesContainer: {
    paddingHorizontal: 16,
  },

  placeListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
    gap: 12,
  },

  placeListImage: {
    width: 64,
    height: 64,
    borderRadius: 8,
    backgroundColor: colors.inputBackground,
  },

  placeListInfo: {
    flex: 1,
  },

  placeListName: {
    fontSize: 17,
    letterSpacing: -0.3,
    lineHeight: 20,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.9)',
  },

  placeListType: {
    fontSize: 15,
    letterSpacing: -0.3,
    lineHeight: 20,
    fontWeight: '400',
    color: 'rgba(255, 255, 255, 0.6)',
    marginTop: 4,
  },

  placeListCollections: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },

  placeListCollectionsText: {
    fontSize: 15,
    letterSpacing: -0.3,
    lineHeight: 20,
    fontWeight: '400',
    color: 'rgba(255, 255, 255, 0.6)',
  },

  // Empty state
  emptyState: {
    padding: 40,
    alignItems: 'center',
    gap: 12,
  },

  emptyStateText: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '600',
  },

  emptyStateSubtext: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
  },

  // Sign up prompt styles
  signUpContainer: {
    width: 300,
    alignSelf: 'center',
    marginTop: 120,
    alignItems: 'center',
  },

  signUpImage: {
    width: 200,
    height: 150,
    marginBottom: 24,
  },

  signUpTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: -0.5,
    lineHeight: 20,
    textAlign: 'center',
  },

  signUpSubtitle: {
    fontSize: 16,
    fontWeight: '400',
    color: 'rgba(255, 255, 255, 0.7)',
    letterSpacing: -0.5,
    lineHeight: 20,
    marginTop: 8,
    textAlign: 'center',
  },

  authButtonContainer: {
    marginTop: 24,
    gap: 12,
    width: '100%',
  },

  authButton: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#393939',
    borderRadius: 52,
    paddingHorizontal: 16,
    gap: 12,
  },

  authButtonText: {
    fontSize: 17,
    fontWeight: '500',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },

  // More options button
  moreOptionsButton: {
    padding: 8,
  },
});

export default CollectionScreen;
