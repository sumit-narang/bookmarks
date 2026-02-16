/**
 * AppNavigator - Main navigation configuration
 * Sets up bottom tabs and stack navigators
 */

import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import FloatingTabBar from '../components/FloatingTabBar';

// Screens
import HomeScreen from '../screens/HomeScreen';
import AddPlaceSearchScreen from '../screens/AddPlaceSearchScreen';
import CollectionScreen from '../screens/CollectionScreen';
import PlaceDetailsScreen from '../screens/PlaceDetailsScreen';
import PlacesInCollectionScreen from '../screens/PlacesInCollectionScreen';
import SharedCollectionScreen from '../screens/SharedCollectionScreen';
import ProfileScreen from '../screens/ProfileScreen';
import DiagnosticsScreen from '../screens/DiagnosticsScreen';
import { isE2eModeEnabled } from '../config/e2e';

// Modals
import SaveToCollectionModal from '../modals/SaveToCollectionModal';
import AddNewCollectionModal from '../modals/AddNewCollectionModal';
import AddToExistingCollectionModal from '../modals/AddToExistingCollectionModal';
import ShareCollectionModal from '../modals/ShareCollectionModal';
import ImportGoogleModal from '../modals/ImportGoogleModal';
import OpenInMapsModal from '../modals/OpenInMapsModal';
import PlaceOptionsModal from '../modals/PlaceOptionsModal';
import CollectionOptionsModal from '../modals/CollectionOptionsModal';
import EditSavedOptionsModal from '../modals/EditSavedOptionsModal';
import EditPlaceCollectionsModal from '../modals/EditPlaceCollectionsModal';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

/**
 * Home Tab Stack
 * Map view → Place details → Save modals
 */
const HomeStack = () => {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
      }}
    >
      <Stack.Screen name="HomeMain" component={HomeScreen} />
      <Stack.Screen name="PlaceDetails" component={PlaceDetailsScreen} />
    </Stack.Navigator>
  );
};

/**
 * Add Tab Stack
 * Search → Place details → Save modals
 */
const AddStack = () => {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
      }}
    >
      <Stack.Screen name="AddPlaceSearch" component={AddPlaceSearchScreen} />
      <Stack.Screen name="PlaceDetails" component={PlaceDetailsScreen} />
    </Stack.Navigator>
  );
};

/**
 * Library Tab Stack
 * Collections list → Places in collection → Place details
 */
const LibraryStack = () => {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
      }}
    >
      <Stack.Screen name="LibraryMain" component={CollectionScreen} />
      <Stack.Screen name="PlacesInCollection" component={PlacesInCollectionScreen} />
      <Stack.Screen name="PlaceDetails" component={PlaceDetailsScreen} />
    </Stack.Navigator>
  );
};

/**
 * Main Tab Navigator
 * Three tabs: Map, Add, Library
 * Uses custom floating tab bar
 */
const TabNavigator = () => {
  return (
    <Tab.Navigator
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
      }}
    >
      <Tab.Screen
        name="MapTab"
        component={HomeStack}
        options={{ tabBarTestID: 'tab-map' }}
      />
      <Tab.Screen
        name="AddTab"
        component={AddStack}
        options={{ tabBarTestID: 'tab-add' }}
      />
      <Tab.Screen
        name="LibraryTab"
        component={LibraryStack}
        options={{ tabBarTestID: 'tab-library' }}
      />
    </Tab.Navigator>
  );
};

/**
 * Root Navigator
 * Contains tabs and modal screens
 */
const AppNavigator = () => {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
      }}
    >
      <Stack.Screen name="Main" component={TabNavigator} />
      <Stack.Screen name="Profile" component={ProfileScreen} />
      {isE2eModeEnabled && (
        <Stack.Screen name="Diagnostics" component={DiagnosticsScreen} />
      )}
      <Stack.Screen name="SharedCollection" component={SharedCollectionScreen} />
      <Stack.Group
        screenOptions={{
          presentation: 'transparentModal',
          animation: 'slide_from_bottom',
        }}
      >
        <Stack.Screen name="SaveToCollection" component={SaveToCollectionModal} />
        <Stack.Screen name="AddNewCollection" component={AddNewCollectionModal} />
        <Stack.Screen name="AddToExistingCollection" component={AddToExistingCollectionModal} />
        <Stack.Screen name="ShareCollection" component={ShareCollectionModal} />
        <Stack.Screen name="ImportGoogle" component={ImportGoogleModal} />
        <Stack.Screen name="OpenInMaps" component={OpenInMapsModal} />
        <Stack.Screen name="PlaceOptions" component={PlaceOptionsModal} />
        <Stack.Screen name="CollectionOptions" component={CollectionOptionsModal} />
        <Stack.Screen name="EditSavedOptions" component={EditSavedOptionsModal} />
        <Stack.Screen name="EditPlaceCollections" component={EditPlaceCollectionsModal} />
      </Stack.Group>
    </Stack.Navigator>
  );
};

export default AppNavigator;
