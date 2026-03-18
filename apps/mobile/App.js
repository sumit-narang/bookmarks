/**
 * Bookmarks App - Main Entry Point
 * A React Native Expo app for saving and organizing places
 */

import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { View, Text, ActivityIndicator, StyleSheet, Platform, LogBox } from 'react-native';
import * as Linking from 'expo-linking';

import AppNavigator from './navigation/AppNavigator';
import { initializeStorage } from './data/storage';
import { colors } from './styles/colors';
import { AuthProvider } from './context/AuthContext';
import { isE2eModeEnabled } from './config/e2e';

if (isE2eModeEnabled) {
  LogBox.ignoreAllLogs(true);
}

const isDiagnosticsEnabled = isE2eModeEnabled || __DEV__;

// Deep linking configuration
const prefix = Linking.createURL('/');

// Get the current origin for web
const getWebOrigin = () => {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return window.location.origin;
  }
  return '';
};

const linkingPrefixes = [prefix, getWebOrigin(), 'https://bookmarks.app', 'bookmarks://'].filter(
  (value) => typeof value === 'string' && value.length > 0
);

const linking = {
  prefixes: linkingPrefixes,
  config: {
    screens: {
      SharedCollection: {
        path: 'shared',
        parse: {
          data: (data) => data,
        },
      },
      ...(isDiagnosticsEnabled ? { Diagnostics: 'diagnostics' } : {}),
      Main: {
        screens: {
          LibraryTab: {
            screens: {
              LibraryMain: 'library',
            },
          },
        },
      },
    },
  },
  // Custom function to get initial URL on web
  async getInitialURL() {
    // Handle web URLs with query params
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      return window.location.href;
    }
    // Default behavior for native
    const url = await Linking.getInitialURL();
    return url;
  },
};

export default function App() {
  const [isReady, setIsReady] = useState(false);

  // Initialize SQLite persistence and run migrations
  useEffect(() => {
    const prepare = async () => {
      try {
        await initializeStorage();
      } catch (error) {
        console.error('Error initializing storage:', error);
      } finally {
        setIsReady(true);
      }
    };

    prepare();
  }, []);

  // Show loading screen while initializing
  if (!isReady) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading Bookmarks...</Text>
        <StatusBar style="light" />
      </View>
    );
  }

  return (
    <AuthProvider>
      <NavigationContainer linking={linking}>
        <AppNavigator />
        <StatusBar style="light" />
      </NavigationContainer>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  loadingText: {
    color: colors.textSecondary,
    fontSize: 16,
  },
});
