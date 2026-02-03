/**
 * HomeScreen - Interactive map view with saved place markers
 * Shows all saved places on a Google Map
 */

import { useState, useEffect, useRef } from 'react';
import { View, StyleSheet, Dimensions, TouchableOpacity, SafeAreaView } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { getPlaces } from '../data/storage';
import { colors } from '../styles/colors';
import { useAuth } from '../context/AuthContext';
import AnimatedAvatar from '../components/AnimatedAvatar';
import PillMarker from '../components/PillMarker';

const { width, height } = Dimensions.get('window');

// Default map region (Dublin, Ireland - based on mock data)
const INITIAL_REGION = {
  latitude: 53.3498,
  longitude: -6.2603,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

// Custom Google Maps style - Dark mode (converted from cloud-based style export)
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

// Zoom level thresholds (latitudeDelta)
const ZOOM_FULL = 0.03;    // Below this = full pill with text
const ZOOM_CIRCLE = 0.14;  // Below this = circle only, above this = dot

const HomeScreen = ({ navigation }) => {
  const { isAuthenticated } = useAuth();
  const [savedPlaces, setSavedPlaces] = useState([]);
  const [zoomLevel, setZoomLevel] = useState(INITIAL_REGION.latitudeDelta);
  const avatarRef = useRef(null);
  const mapRef = useRef(null);

  // Get marker mode based on zoom level
  const getMarkerMode = () => {
    if (zoomLevel <= ZOOM_FULL) return 'full';
    if (zoomLevel <= ZOOM_CIRCLE) return 'circle';
    return 'dot';
  };

  // Trigger avatar animation on map interaction
  const handleMapInteraction = () => {
    avatarRef.current?.triggerAnimation();
  };

  // Handle region change to track zoom level
  const handleRegionChange = (region) => {
    setZoomLevel(region.latitudeDelta);
    handleMapInteraction();
  };

  // Load places when screen loads (only if authenticated)
  useEffect(() => {
    if (isAuthenticated) {
      loadPlaces();
    } else {
      // Clear saved places when not authenticated
      setSavedPlaces([]);
    }
  }, [isAuthenticated]);

  // Reload places when screen comes into focus (only if authenticated)
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      if (isAuthenticated) {
        loadPlaces();
      }
    });
    return unsubscribe;
  }, [navigation, isAuthenticated]);

  const loadPlaces = async () => {
    const data = await getPlaces();
    // Filter to show only saved places on the map
    const saved = data.filter((place) => place.saved);
    setSavedPlaces(saved);
  };

  // Handle marker tap - navigate to place details
  const handleMarkerPress = (place) => {
    navigation.navigate('PlaceDetails', { placeId: place.id });
  };

  // Handle profile button tap
  const handleProfilePress = () => {
    navigation.navigate('Profile');
  };

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        customMapStyle={customMapStyle}
        style={styles.map}
        initialRegion={INITIAL_REGION}
        showsUserLocation={true}
        showsMyLocationButton={false}
        showsCompass={true}
        rotateEnabled={true}
        zoomEnabled={true}
        scrollEnabled={true}
        pitchEnabled={true}
        onPanDrag={handleMapInteraction}
        onRegionChangeComplete={handleRegionChange}
      >
        {/* Markers for saved places */}
        {savedPlaces.map((place) => (
          <Marker
            key={place.id}
            coordinate={{
              latitude: place.coordinates.latitude,
              longitude: place.coordinates.longitude,
            }}
            onPress={() => handleMarkerPress(place)}
          >
            <PillMarker
              imageUri={place.image}
              name={place.name}
              mode={getMarkerMode()}
            />
          </Marker>
        ))}
      </MapView>

      {/* Profile Button */}
      <SafeAreaView style={styles.headerOverlay}>
        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.profileBtn} onPress={handleProfilePress}>
            <View style={styles.avatarBlurWrapper}>
              <BlurView intensity={34} tint="dark" style={styles.avatarBlurView}>
                <LinearGradient
                  colors={['rgba(82, 148, 157, 0.2)', 'rgba(0, 0, 0, 0.5)']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.avatarGradient}
                />
              </BlurView>
              <AnimatedAvatar ref={avatarRef} size={40} />
            </View>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  map: {
    width: width,
    height: height,
  },
  headerOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  headerRight: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  profileBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarBlurWrapper: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarBlurView: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 20,
    overflow: 'hidden',
  },
  avatarGradient: {
    ...StyleSheet.absoluteFillObject,
  },
});

export default HomeScreen;
