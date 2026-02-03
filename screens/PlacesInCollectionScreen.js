/**
 * PlacesInCollectionScreen - Shows all places in a collection
 * List view with map preview and place items
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { getCollectionById, getPlacesInCollection } from '../data/storage';
import { colors } from '../styles/colors';
import ChevronLeftIcon from '../assets/icons/chevron-left.svg';
import MoreOptionIcon from '../assets/icons/more-option.svg';
import AddNewIcon from '../assets/icons/add-new-icon.svg';
import ImageListWithAction from '../components/ImageListWithAction';
import { mediumHaptic } from '../utils/haptics';

// Custom Google Maps style - Dark mode (same as HomeScreen)
const customMapStyle = [
  // Dark base theme
  { elementType: 'geometry', stylers: [{ color: '#242f3e' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#746855' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#242f3e' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  // Urban area / man-made landscape
  { featureType: 'landscape.man_made', elementType: 'geometry.fill', stylers: [{ color: '#2f445a' }] },
  { featureType: 'landscape', elementType: 'geometry.fill', stylers: [{ color: '#2f445a' }] },
  // Natural land cover
  { featureType: 'landscape.natural', elementType: 'geometry.fill', stylers: [{ color: '#2f445a' }] },
  { featureType: 'landscape.natural.landcover', elementType: 'geometry.fill', stylers: [{ color: '#346d56' }] },
  { featureType: 'landscape.natural.terrain', elementType: 'geometry.fill', stylers: [{ color: '#66705c' }] },
  // Water
  { featureType: 'water', elementType: 'geometry.fill', stylers: [{ color: '#0c3175' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#5080a0' }] },
  { featureType: 'water', elementType: 'labels.text.stroke', stylers: [{ color: '#493737' }] },
  // Roads
  { featureType: 'road', elementType: 'geometry.fill', stylers: [{ color: '#3d5571' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#242f3e' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#9ca5b3' }] },
  { featureType: 'road.highway', elementType: 'geometry.fill', stylers: [{ color: '#6899dc' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#242f3e' }] },
  { featureType: 'road.arterial', elementType: 'geometry.fill', stylers: [{ color: '#7589a2' }] },
  { featureType: 'road.arterial', elementType: 'geometry.stroke', stylers: [{ visibility: 'off' }] },
  { featureType: 'road.local', elementType: 'geometry.fill', stylers: [{ color: '#3d5571' }] },
  { featureType: 'road.local', elementType: 'geometry.stroke', stylers: [{ visibility: 'off' }] },
  // Road shields / labels hidden
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  // POI - parks and recreation
  { featureType: 'poi.park', elementType: 'geometry.fill', stylers: [{ color: '#005a57' }] },
  { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#82b891' }] },
  { featureType: 'poi.sports_complex', elementType: 'geometry.fill', stylers: [{ color: '#006051' }] },
  // POI - business corridor
  { featureType: 'poi.business', elementType: 'geometry.fill', stylers: [{ color: '#44436e' }] },
  // POI - medical
  { featureType: 'poi.medical', elementType: 'geometry.fill', stylers: [{ color: '#494969' }] },
  // POI - school (labels hidden)
  { featureType: 'poi.school', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  // POI - general
  { featureType: 'poi', elementType: 'geometry.fill', stylers: [{ color: '#2f445a' }] },
  // POI - place of worship visible
  { featureType: 'poi.place_of_worship', elementType: 'labels', stylers: [{ visibility: 'on' }] },
  // Transit - airport
  { featureType: 'transit.station.airport', elementType: 'geometry.fill', stylers: [{ color: '#294f7b' }] },
  // Transit - bus/rail labels hidden
  { featureType: 'transit.station.bus', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit.station.rail', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  // Administrative / Political
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#e24b7b' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#dae4ee' }] },
  { featureType: 'administrative.neighborhood', elementType: 'labels.text.fill', stylers: [{ color: '#dae4ee' }] },
  { featureType: 'administrative.province', elementType: 'labels.text.fill', stylers: [{ color: '#d9b68c' }] },
  { featureType: 'administrative.country', elementType: 'labels.text.fill', stylers: [{ color: '#d9b68c' }] },
];

const PlacesInCollectionScreen = ({ route, navigation }) => {
  const { collectionId } = route.params;
  const [collection, setCollection] = useState(null);
  const [places, setPlaces] = useState([]);

  // Load data
  useEffect(() => {
    loadData();
  }, [collectionId]);

  // Reload when screen comes into focus
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      loadData();
    });
    return unsubscribe;
  }, [navigation]);

  const loadData = async () => {
    const collectionData = await getCollectionById(collectionId);
    const placesData = await getPlacesInCollection(collectionId);
    setCollection(collectionData);
    setPlaces(placesData);
  };

  // Handle place tap
  const handlePlacePress = (place) => {
    mediumHaptic();
    navigation.navigate('PlaceDetails', { placeId: place.id });
  };

  // Handle more options for a place
  const handlePlaceOptions = (place) => {
    mediumHaptic();
    navigation.navigate('PlaceOptions', { place });
  };

  // Handle back button
  const handleBack = () => {
    navigation.goBack();
  };

  // Handle header more options
  const handleHeaderOptions = () => {
    mediumHaptic();
    navigation.navigate('CollectionOptions', { collection });
  };

  // Handle view in map
  const handleViewInMap = () => {
    // TODO: Navigate to map view with these places
  };

  // Handle add place
  const handleAddPlace = () => {
    mediumHaptic();
    navigation.navigate('AddTab', { screen: 'AddPlaceSearch' });
  };

  // Calculate map region based on places
  const getMapRegion = () => {
    if (places.length === 0) {
      return {
        latitude: 53.3498,
        longitude: -6.2603,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      };
    }

    const lats = places.map(p => p.latitude).filter(Boolean);
    const lngs = places.map(p => p.longitude).filter(Boolean);

    if (lats.length === 0 || lngs.length === 0) {
      return {
        latitude: 53.3498,
        longitude: -6.2603,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      };
    }

    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);

    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: Math.max(0.05, (maxLat - minLat) * 1.5),
      longitudeDelta: Math.max(0.05, (maxLng - minLng) * 1.5),
    };
  };

  if (!collection) {
    return (
      <View style={styles.container}>
        <SafeAreaView style={styles.safeArea} edges={['top']}>
          <Text style={{ color: colors.textSecondary, padding: 20 }}>Loading...</Text>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={handleBack}>
            <ChevronLeftIcon width={24} height={24} />
          </TouchableOpacity>

          <Text style={styles.headerTitle} numberOfLines={1}>
            {collection.name}
          </Text>

          <TouchableOpacity style={styles.headerOptionsBtn} onPress={handleHeaderOptions}>
            <MoreOptionIcon width={24} height={24} />
          </TouchableOpacity>
        </View>

        {/* Content */}
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* View in Map Section */}
          <Text style={styles.sectionLabel}>View in Map</Text>
          <TouchableOpacity
            style={styles.mapContainer}
            onPress={handleViewInMap}
            activeOpacity={0.9}
          >
            <MapView
              provider={PROVIDER_GOOGLE}
              customMapStyle={customMapStyle}
              style={styles.mapPreview}
              region={getMapRegion()}
              scrollEnabled={false}
              zoomEnabled={false}
              rotateEnabled={false}
              pitchEnabled={false}
              pointerEvents="none"
            >
              {places.map((place) => (
                place.latitude && place.longitude && (
                  <Marker
                    key={place.id}
                    coordinate={{
                      latitude: place.latitude,
                      longitude: place.longitude,
                    }}
                  />
                )
              ))}
            </MapView>
            <View style={styles.mapOverlay}>
              <View style={styles.mapLabelContainer}>
                <Text style={styles.mapLabel}>Click to see in map</Text>
              </View>
            </View>
          </TouchableOpacity>

          {/* All Places Section */}
          <Text style={styles.sectionLabel}>{places.length} {collection.name}</Text>
          <View style={styles.placesList}>
            {places.map((place, index) => (
              <ImageListWithAction
                key={place.id}
                imageUri={place.image}
                title={place.name}
                subtitle={place.address || place.type}
                onPress={() => handlePlacePress(place)}
                actionIcon={<MoreOptionIcon width={24} height={24} />}
                onActionPress={() => handlePlaceOptions(place)}
                showDivider={true}
              />
            ))}
          </View>

          {/* Add Place Button */}
          <TouchableOpacity
            style={styles.addPlaceButton}
            onPress={handleAddPlace}
            activeOpacity={0.7}
          >
            <View style={styles.addPlaceIcon}>
              <AddNewIcon width={24} height={24} fill="#FFFFFF" />
            </View>
            <Text style={styles.addPlaceText}>Add {collection.name}</Text>
          </TouchableOpacity>

          {/* Bottom spacer */}
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

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 16,
  },

  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },

  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: -0.5,
    color: '#FFFFFF',
    flex: 1,
    textAlign: 'center',
    marginHorizontal: 8,
  },

  headerOptionsBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },

  scrollView: {
    flex: 1,
  },

  scrollContent: {
    paddingHorizontal: 16,
  },

  sectionLabel: {
    fontSize: 15,
    fontWeight: '400',
    color: 'rgba(255, 255, 255, 0.6)',
    marginBottom: 12,
    marginTop: 8,
  },

  mapContainer: {
    height: 150,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 24,
  },

  mapPreview: {
    width: '100%',
    height: '100%',
  },

  mapOverlay: {
    position: 'absolute',
    bottom: 12,
    left: 12,
  },

  mapLabelContainer: {
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    flexDirection: 'row',
    alignItems: 'center',
  },

  mapLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: '#FFFFFF',
  },

  placesList: {
    marginBottom: 0,
  },

  addPlaceButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
  },

  addPlaceIcon: {
    width: 44,
    height: 44,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  addPlaceText: {
    fontSize: 17,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.9)',
    marginLeft: 12,
  },

  bottomSpacer: {
    height: 100,
  },
});

export default PlacesInCollectionScreen;
