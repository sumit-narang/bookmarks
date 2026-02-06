/**
 * SharedCollectionScreen - View shared collections from a link
 * Displays collections and places shared by another user
 */

import { useState, useEffect } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../styles/colors';
import { typography } from '../styles/typography';

const { width } = Dimensions.get('window');
const CARD_SIZE = (width - 48) / 3;

const SharedCollectionScreen = ({ route, navigation }) => {
  const [sharedData, setSharedData] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    parseSharedData();
  }, [route.params]);

  const parseSharedData = () => {
    try {
      const { data } = route.params || {};
      if (!data) {
        setError('No shared data found');
        return;
      }

      // Decode base64 data
      const jsonData = decodeURIComponent(atob(data));
      const parsed = JSON.parse(jsonData);
      setSharedData(parsed);
    } catch (err) {
      console.error('Error parsing shared data:', err);
      setError('Unable to load shared collections');
    }
  };

  const handleBack = () => {
    navigation.goBack();
  };

  const handlePlacePress = (place) => {
    // Navigate to place details with the shared place data
    navigation.navigate('PlaceDetails', {
      placeId: place.id,
      googlePlace: {
        ...place,
        placeId: place.id,
        isGooglePlace: true,
      },
    });
  };

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={handleBack}>
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Shared Collection</Text>
          <View style={styles.headerPlaceholder} />
        </View>
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle-outline" size={48} color={colors.textSecondary} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={handleBack}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Shared with You</Text>
        <View style={styles.headerPlaceholder} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {sharedData.map((collection) => (
          <View key={collection.id} style={styles.collectionSection}>
            {/* Collection Header */}
            <View style={styles.collectionHeader}>
              <Text style={styles.collectionName}>{collection.name}</Text>
              <Text style={styles.placeCount}>{collection.places?.length || 0} places</Text>
            </View>

            {/* Places Grid */}
            <View style={styles.placesGrid}>
              {collection.places?.map((place) => (
                <TouchableOpacity
                  key={place.id}
                  style={styles.placeCard}
                  onPress={() => handlePlacePress(place)}
                  activeOpacity={0.8}
                >
                  <Image
                    source={{ uri: place.image }}
                    style={styles.placeImage}
                    resizeMode="cover"
                  />
                  <LinearGradient
                    colors={['transparent', 'rgba(0,0,0,0.7)']}
                    style={styles.placeGradient}
                  />
                  <View style={styles.placeInfo}>
                    <Text style={styles.placeName} numberOfLines={1}>
                      {place.name}
                    </Text>
                    {place.rating > 0 && (
                      <View style={styles.ratingRow}>
                        <Text style={styles.ratingStar}>★</Text>
                        <Text style={styles.ratingText}>{place.rating}</Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}

        {sharedData.length === 0 && !error && (
          <View style={styles.emptyContainer}>
            <Ionicons name="folder-open-outline" size={48} color={colors.textSecondary} />
            <Text style={styles.emptyText}>No collections to display</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
  },

  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },

  headerTitle: {
    ...typography.heading,
    color: colors.textPrimary,
    flex: 1,
    textAlign: 'center',
  },

  headerPlaceholder: {
    width: 40,
  },

  content: {
    flex: 1,
    paddingHorizontal: 16,
  },

  collectionSection: {
    marginBottom: 24,
  },

  collectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },

  collectionName: {
    ...typography.subheading,
    color: colors.textPrimary,
  },

  placeCount: {
    fontSize: 14,
    color: colors.textSecondary,
  },

  placesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },

  placeCard: {
    width: CARD_SIZE,
    height: CARD_SIZE,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
  },

  placeImage: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.inputBackground,
  },

  placeGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '60%',
  },

  placeInfo: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    right: 8,
  },

  placeName: {
    ...typography.caption,
    color: colors.textPrimary,
    fontWeight: '500',
  },

  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: 2,
  },

  ratingStar: {
    color: colors.warning,
    fontSize: 10,
  },

  ratingText: {
    fontSize: 10,
    color: colors.textPrimary,
  },

  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },

  errorText: {
    color: colors.textSecondary,
    fontSize: 16,
  },

  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
    gap: 12,
  },

  emptyText: {
    color: colors.textSecondary,
    fontSize: 16,
  },
});

export default SharedCollectionScreen;
