/**
 * Backend API configuration for mobile auth/sync flows.
 */

import { Platform } from 'react-native';

const defaultBackendUrl = Platform.OS === 'android'
  ? 'http://10.0.2.2:8787'
  : 'http://127.0.0.1:8787';

export const BOOKMARKS_BACKEND_URL = process.env.EXPO_PUBLIC_BOOKMARKS_BACKEND_URL || defaultBackendUrl;
