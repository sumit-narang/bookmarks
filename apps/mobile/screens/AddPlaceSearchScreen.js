/**
 * AddPlaceSearchScreen - Search for places using Google Places API
 * Shows search input and results from Google Places Autocomplete
 */

import { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  Image,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  Keyboard,
  ActivityIndicator,
} from 'react-native';
import { searchPlacesGoogle, getPlaceDetails, getPlacePhoto } from '../data/placesApi';
import { getPlaces } from '../data/storage';
import { SearchStyles as styles } from '../styles/SearchStyles';
import { colors } from '../styles/colors';
import SearchIcon from '../assets/icons/search.svg';
import SearchCrossIcon from '../assets/icons/search-cross.svg';
import SearchNotFoundIcon from '../assets/icons/search-not-found.svg';
import BookmarkIcon from '../assets/icons/bookmark.svg';
import ImageListWithAction from '../components/ImageListWithAction';

const AddPlaceSearchScreen = ({ navigation }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [savedPlaceIds, setSavedPlaceIds] = useState(new Set());
  const inputRef = useRef(null);
  const searchTimeoutRef = useRef(null);

  // Load saved places to check which results are bookmarked
  const loadSavedPlaces = async () => {
    const places = await getPlaces();
    const savedIds = new Set(
      places.filter(p => p.saved).map(p => p.placeId || p.id)
    );
    setSavedPlaceIds(savedIds);
  };

  // Load on mount
  useEffect(() => {
    loadSavedPlaces();
  }, []);

  // Reload when screen comes into focus (in case save status changed)
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      loadSavedPlaces();
    });
    return unsubscribe;
  }, [navigation]);

  // Clear search input
  const handleClearSearch = () => {
    setSearchQuery('');
    setResults([]);
    inputRef.current?.focus();
  };

  // Handle search with debounce
  const handleSearch = (query) => {
    setSearchQuery(query);

    // Clear previous timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    // Don't search if query is too short
    if (query.length < 2) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);

    // Debounce search by 300ms
    searchTimeoutRef.current = setTimeout(async () => {
      const searchResults = await searchPlacesGoogle(query);
      setResults(searchResults);
      setIsSearching(false);

      // Fetch photos for each result in parallel
      searchResults.forEach(async (result, index) => {
        const photoUrl = await getPlacePhoto(result.placeId);
        if (photoUrl) {
          setResults((prevResults) => {
            const updated = [...prevResults];
            if (updated[index] && updated[index].placeId === result.placeId) {
              updated[index] = { ...updated[index], photoUrl };
            }
            return updated;
          });
        }
      });
    }, 300);
  };

  // Handle tapping on a search result
  const handleResultPress = async (result) => {
    setIsLoadingDetails(true);
    Keyboard.dismiss();

    // Fetch full place details from Google
    const placeDetails = await getPlaceDetails(result.placeId);

    setIsLoadingDetails(false);

    if (placeDetails) {
      // Navigate to place details with the Google place data
      navigation.navigate('PlaceDetails', {
        placeId: result.placeId,
        googlePlace: placeDetails,
      });
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Screen Title */}
      <Text style={styles.screenTitle}>Add Place</Text>

      {/* Search Input */}
      <View style={styles.searchInputContainer}>
        <SearchIcon width={16} height={16} style={styles.searchIcon} />
        <TextInput
          ref={inputRef}
          style={styles.searchInput}
          placeholder="Search for a place"
          placeholderTextColor="rgba(255, 255, 255, 0.36)"
          value={searchQuery}
          onChangeText={handleSearch}
          autoFocus={false}
          returnKeyType="search"
          onSubmitEditing={() => Keyboard.dismiss()}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity
            onPress={handleClearSearch}
            style={styles.clearButton}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <SearchCrossIcon width={24} height={24} />
          </TouchableOpacity>
        )}
      </View>

      {/* Section Label */}
      {searchQuery.length > 0 && (
        <Text style={styles.sectionLabel}>
          {isSearching ? 'Searching...' : 'Search Results'}
        </Text>
      )}

      {/* Loading indicator for fetching place details */}
      {isLoadingDetails && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading place details...</Text>
        </View>
      )}

      {/* Results List */}
      <ScrollView
        style={styles.searchResults}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {results.map((result, index) => (
          <ImageListWithAction
            key={result.placeId || index}
            imageUri={result.photoUrl}
            title={result.name}
            subtitle={result.address}
            onPress={() => handleResultPress(result)}
            placeholder={<Image source={require('../assets/icons/search-no-place-found.png')} style={{ width: 44, height: 44 }} />}
            showDivider={index < results.length - 1}
            titleIcon={savedPlaceIds.has(result.placeId) ? <BookmarkIcon height={14} /> : null}
          />
        ))}

        {/* No results state */}
        {searchQuery.length >= 2 && !isSearching && results.length === 0 && (
          <View style={styles.emptyState}>
            <SearchNotFoundIcon width={90} height={90} />
            <Text style={styles.emptyStateTitle}>No places found</Text>
            <Text style={styles.emptyStateDescription}>
              Try to search a different place
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

export default AddPlaceSearchScreen;
