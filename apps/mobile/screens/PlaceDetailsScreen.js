/**
 * PlaceDetailsScreen - Shows detailed info about a place
 * Handles both local places (from storage) and Google Places
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  Dimensions,
  DeviceEventEmitter,
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { getPlaceById, getPlaces, getCollectionsForPlace } from '../data/storage';
import { PlaceDetailsStyles as styles } from '../styles/PlaceDetailsStyles';
import { colors } from '../styles/colors';
import { useAuth } from '../context/AuthContext';
import BookmarkIcon from '../assets/icons/bookmark.svg';
import MoreOptionIcon from '../assets/icons/more-option.svg';
import ChevronBottomIcon from '../assets/icons/chevron-bottom.svg';
import { mediumHaptic, lightHaptic } from '../utils/haptics';

// Rating icons based on rating ranges
import Rating5 from '../assets/icons/rating5.svg';
import Rating4_5 from '../assets/icons/rating4-5.svg';
import Rating3_4 from '../assets/icons/rating3-4.svg';
import Rating2_5_3 from '../assets/icons/rating2.5-3.svg';
import Rating2_2_5 from '../assets/icons/rating2-2.5.svg';
import Rating1_2 from '../assets/icons/rating1-2.svg';
import Rating0_1 from '../assets/icons/rating0-1.svg';

const { width } = Dimensions.get('window');

// Get the appropriate rating icon based on rating value
const getRatingIcon = (rating) => {
  if (rating >= 5) return Rating5;
  if (rating >= 4) return Rating4_5;
  if (rating >= 3) return Rating3_4;
  if (rating >= 2.5) return Rating2_5_3;
  if (rating >= 2) return Rating2_2_5;
  if (rating >= 1) return Rating1_2;
  return Rating0_1;
};

// Default placeholder image
const PLACEHOLDER_IMAGE = 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=400&h=400&fit=crop';

// Custom Google Maps style - Dark mode (converted from cloud-based style export)
const customMapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#242f3e' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#746855' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#242f3e' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'landscape', elementType: 'geometry.fill', stylers: [{ color: '#2f445a' }] },
  { featureType: 'landscape.natural.landcover', elementType: 'geometry.fill', stylers: [{ color: '#346d56' }] },
  { featureType: 'water', elementType: 'geometry.fill', stylers: [{ color: '#0c3175' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#5080a0' }] },
  { featureType: 'road', elementType: 'geometry.fill', stylers: [{ color: '#3d5571' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#242f3e' }] },
  { featureType: 'road.highway', elementType: 'geometry.fill', stylers: [{ color: '#6899dc' }] },
  { featureType: 'road.arterial', elementType: 'geometry.fill', stylers: [{ color: '#7589a2' }] },
  { featureType: 'road.local', elementType: 'geometry.fill', stylers: [{ color: '#3d5571' }] },
  { featureType: 'poi.park', elementType: 'geometry.fill', stylers: [{ color: '#005a57' }] },
  { featureType: 'poi', elementType: 'geometry.fill', stylers: [{ color: '#2f445a' }] },
  { featureType: 'transit.station.airport', elementType: 'geometry.fill', stylers: [{ color: '#294f7b' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#e24b7b' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#dae4ee' }] },
  { featureType: 'administrative.country', elementType: 'labels.text.fill', stylers: [{ color: '#d9b68c' }] },
];

// Format date as "12 Dec, 2025"
const formatDate = (dateString) => {
  if (!dateString) return '';
  const date = new Date(dateString);
  const day = date.getDate();
  const month = date.toLocaleString('en-US', { month: 'short' });
  const year = date.getFullYear();
  return `${day} ${month}, ${year}`;
};

const PlaceDetailsScreen = ({ route, navigation }) => {
  const { isAuthenticated } = useAuth();
  const { placeId, googlePlace, refresh } = route.params;
  const [place, setPlace] = useState(null);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [savedCollections, setSavedCollections] = useState([]);
  const [showAllCollections, setShowAllCollections] = useState(false);

  // Use ref to always have access to the latest loadPlace function
  const loadPlaceRef = useRef();

  const loadPlace = useCallback(async () => {
    let currentPlace = null;
    let currentPlaceId = placeId;

    // If we have Google Place data, use that
    if (googlePlace) {
      // Check if this place is already saved in our storage
      const allPlaces = await getPlaces();
      const existingPlace = allPlaces.find(p => p.placeId === googlePlace.placeId || p.id === googlePlace.placeId);

      if (existingPlace) {
        currentPlace = { ...googlePlace, ...existingPlace, saved: existingPlace.saved };
        currentPlaceId = existingPlace.id;
      } else {
        currentPlace = googlePlace;
        currentPlaceId = googlePlace.placeId;
      }
    } else {
      // Otherwise load from local storage
      currentPlace = await getPlaceById(placeId);
      // For local places, use the place's id or placeId
      if (currentPlace) {
        currentPlaceId = currentPlace.id;
      }
    }

    setPlace(currentPlace);

    // Load collections this place is saved in
    if (currentPlaceId) {
      const collections = await getCollectionsForPlace(currentPlaceId);
      setSavedCollections(collections);
    }
  }, [placeId, googlePlace]);

  // Keep ref updated with latest loadPlace
  loadPlaceRef.current = loadPlace;

  // Load place data (also reload when refresh param changes)
  useEffect(() => {
    loadPlace();
  }, [loadPlace, refresh]);

  // Listen for collection save events to refresh data
  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener('collectionsUpdated', () => {
      loadPlaceRef.current();
    });
    return () => subscription.remove();
  }, []);

  // Handle back button
  const handleBack = () => {
    navigation.goBack();
  };

  // Handle save button - navigate to save modal
  const handleSave = () => {
    mediumHaptic();
    // Pass the place data to the save modal (always include place info for preview)
    navigation.navigate('SaveToCollection', {
      placeId: place.id,
      googlePlace: place,
    });
  };

  // Handle sign up - navigate to profile screen
  const handleSignUp = () => {
    navigation.navigate('Profile');
  };

  // Handle See All / View More button
  const handleSeeAll = () => {
    lightHaptic();
    setShowAllCollections(true);
  };

  // Handle edit saved collections - opens options modal
  const handleEditSavedCollections = () => {
    mediumHaptic();
    navigation.navigate('EditSavedOptions', {
      placeId: place.id,
      googlePlace: place,
    });
  };

  // Handle map press - navigate to modal
  const handleMapPress = () => {
    mediumHaptic();
    navigation.navigate('OpenInMaps', {
      coordinates: place.coordinates,
      placeName: place.name,
    });
  };

  // Loading state
  if (!place) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={{ color: colors.textSecondary }}>Loading...</Text>
      </View>
    );
  }

  // Always return exactly 3 images for the carousel
  const getImages = () => {
    // Start with Google Places images if available
    if (place.images && place.images.length >= 3) {
      return place.images.slice(0, 3);
    }

    // Get available images
    const available = place.images && place.images.length > 0
      ? [...place.images]
      : place.image
        ? [place.image]
        : [PLACEHOLDER_IMAGE];

    // Fill to exactly 3 images by repeating available ones
    const result = [];
    for (let i = 0; i < 3; i++) {
      result.push(available[i % available.length]);
    }
    return result;
  };
  const images = getImages();

  // Collections to display (max 4 unless "View More" is clicked)
  const displayedCollections = showAllCollections
    ? savedCollections
    : savedCollections.slice(0, 4);

  // Number of hidden collections
  const hiddenCollectionsCount = savedCollections.length - 4;

  return (
    <View style={styles.container}>
      {/* Back Header */}
      <View style={styles.backHeader}>
        <TouchableOpacity style={styles.backBtn} onPress={handleBack}>
          <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Image Carousel */}
        <View style={styles.imageCarousel}>
          <ScrollView
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) => {
              const index = Math.round(e.nativeEvent.contentOffset.x / width);
              setCurrentImageIndex(index);
            }}
          >
            {images.map((img, index) => (
              <Image
                key={index}
                source={{ uri: img }}
                style={styles.carouselImage}
                resizeMode="cover"
              />
            ))}
          </ScrollView>

          {/* Gradient overlay */}
          <LinearGradient
            colors={[
              'rgba(24, 24, 24, 0)',
              'rgba(24, 24, 24, 0.45)',
              'rgba(24, 24, 24, 0.75)',
              'rgba(24, 24, 24, 1)',
            ]}
            locations={[0, 0.24, 0.5, 0.94]}
            style={styles.imageGradient}
          />

          {/* Carousel Dots - on top of gradient */}
          <View style={styles.carouselDots}>
            {images.map((_, index) => (
              <View
                key={index}
                style={[styles.dot, currentImageIndex === index && styles.dotActive]}
              />
            ))}
          </View>
        </View>

        {/* Details Content */}
        <View style={[styles.detailsContent, savedCollections.length > 0 && styles.detailsContentSaved]}>
          <View style={styles.placeNameRow}>
            <Text style={styles.placeName}>{place.name}</Text>
            {savedCollections.length > 0 && (
              <BookmarkIcon width={18} height={18} style={styles.placeNameBookmark} />
            )}
          </View>

          <View style={styles.placeMeta}>
            <Text style={styles.placeType}>{place.type}</Text>
            {place.rating != null && place.rating > 0 && (() => {
              const RatingIcon = getRatingIcon(place.rating);
              return (
                <>
                  <Text style={styles.metaSeparator}>·</Text>
                  <View style={styles.rating}>
                    <RatingIcon width={14} height={14} />
                    <Text style={styles.ratingText}>
                      {place.rating}/5 ({place.reviewCount?.toLocaleString() || 0})
                    </Text>
                  </View>
                </>
              );
            })()}
          </View>

          {/* Saved In Section - Only show if place is saved */}
          {savedCollections.length > 0 && (
            <View style={styles.infoCard}>
              <View style={styles.savedSectionHeader}>
                <Text style={styles.cardLabel}>
                  Saved in {savedCollections.length} collection{savedCollections.length > 1 ? 's' : ''}
                </Text>
                <TouchableOpacity onPress={handleEditSavedCollections} activeOpacity={0.7}>
                  <MoreOptionIcon width={24} height={24} />
                </TouchableOpacity>
              </View>

              <View>
                {displayedCollections.map((collection, index) => (
                  <View
                    key={collection.id}
                    style={[
                      styles.savedCollectionItem,
                      index === 0 && { marginTop: 14 },
                      index > 0 && { marginTop: 10 },
                    ]}
                  >
                    <View style={styles.savedCollectionLeft}>
                      <Image
                        source={{ uri: collection.coverImage }}
                        style={styles.savedCollectionImage}
                        resizeMode="cover"
                      />
                      <Text style={styles.savedCollectionName} numberOfLines={1}>
                        {collection.name}
                      </Text>
                    </View>
                    <Text style={styles.savedCollectionDate}>
                      {formatDate(collection.createdAt)}
                    </Text>
                  </View>
                ))}
              </View>

              {/* View More link - only show if more than 4 collections */}
              {hiddenCollectionsCount > 0 && !showAllCollections && (
                <TouchableOpacity
                  style={styles.viewMoreButton}
                  onPress={handleSeeAll}
                  activeOpacity={0.7}
                >
                  <Text style={styles.viewMoreText}>View {hiddenCollectionsCount} More</Text>
                  <ChevronBottomIcon width={16} height={16} />
                </TouchableOpacity>
              )}

              {/* Save to Collection button - always visible in this section */}
              <TouchableOpacity
                style={styles.saveToCollectionBtn}
                onPress={handleSave}
                activeOpacity={0.8}
              >
                <Text style={styles.saveToCollectionBtnText}>Save to Collection</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Description Card */}
          {place.description && (
            <View style={styles.infoCard}>
              <Text style={styles.cardLabel}>About</Text>
              <Text style={styles.cardContent} numberOfLines={4}>
                {place.description}
              </Text>
            </View>
          )}

          {/* Location Card */}
          <View style={styles.infoCard}>
            <Text style={styles.cardLabel}>Location</Text>
            <Text style={styles.cardContent}>{place.address}</Text>

            {/* Map */}
            {place.coordinates?.latitude && place.coordinates?.longitude && (
              <TouchableOpacity
                style={styles.mapContainer}
                onPress={handleMapPress}
                activeOpacity={0.9}
              >
                <MapView
                  provider={PROVIDER_GOOGLE}
                  customMapStyle={customMapStyle}
                  style={styles.map}
                  initialRegion={{
                    latitude: place.coordinates.latitude,
                    longitude: place.coordinates.longitude,
                    latitudeDelta: 0.005,
                    longitudeDelta: 0.005,
                  }}
                  scrollEnabled={false}
                  zoomEnabled={false}
                  rotateEnabled={false}
                  pitchEnabled={false}
                  pointerEvents="none"
                >
                  <Marker
                    coordinate={{
                      latitude: place.coordinates.latitude,
                      longitude: place.coordinates.longitude,
                    }}
                    title={place.name}
                  />
                </MapView>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </ScrollView>

      {/* Bottom Action Button - Only show when place is NOT saved */}
      {savedCollections.length === 0 && (
        <View style={styles.bottomAction}>
          {/* Gradient background */}
          <LinearGradient
            colors={['rgba(24, 24, 24, 0)', 'rgba(24, 24, 24, 0.7)']}
            locations={[0, 1]}
            style={styles.bottomGradient}
          />
          {isAuthenticated ? (
            <TouchableOpacity
              style={styles.saveBtn}
              onPress={handleSave}
              activeOpacity={0.8}
            >
              <Text style={styles.saveBtnText}>Save to Collection</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.saveBtn}
              onPress={handleSignUp}
              activeOpacity={0.8}
            >
              <Ionicons name="person-add" size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
              <Text style={styles.saveBtnText}>Sign Up to Save</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

    </View>
  );
};

export default PlaceDetailsScreen;
