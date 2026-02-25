/**
 * AuthContext - Manages authentication state.
 * Supports Google (native), Apple, and dev/e2e test-user sign in with SQLite-backed session persistence.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  GoogleSignin,
  isErrorWithCode,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import * as AppleAuthentication from 'expo-apple-authentication';
import { createAuthHttpClient } from '../../../auth/src/httpClient';
import { BOOKMARKS_BACKEND_URL } from '../config/backend';
import { buildInsecureTestIdentityToken, e2ePrimaryUserId, isE2eModeEnabled } from '../config/e2e';
import {
  clearAuthSession,
  loadAuthSession,
  saveAuthSessionEnvelope,
} from '../data/authSession';
import { wipeLocalDataOnSignOut } from '../data/localPersistence';
import { syncAuthenticatedData } from '../data/syncManager';
import {
  loadStoredUser as loadStoredUserFromDb,
  migrateGuestDataToUser,
  saveUser as persistUser,
} from '../data/userStorage';
import { resetActiveUserId, setActiveUserId } from '../data/runtimeSession';
import type { AuthenticatedUser } from '../data/types';

// Configure native Google Sign-In
const googleWebClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const googleAndroidClientId = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;

GoogleSignin.configure({
  webClientId: googleWebClientId || undefined,
  scopes: ['profile', 'email'],
});

interface AuthContextValue {
  user: AuthenticatedUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isE2eMode: boolean;
  isTestAuthEnabled: boolean;
  defaultTestUserId: string;
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  signInWithTestUser: (userId: string) => Promise<void>;
  signOut: () => Promise<void>;
  googleAuthRequest: unknown;
}

interface AuthProviderProps {
  children: ReactNode;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider = ({ children }: AuthProviderProps) => {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const hasGoogleClientConfiguration = Boolean(googleAndroidClientId || googleWebClientId);

  const authClient = createAuthHttpClient({ baseUrl: BOOKMARKS_BACKEND_URL });
  const isDevTestAuthDisabled = process.env.EXPO_PUBLIC_BOOKMARKS_DEV_TEST_AUTH === '0';
  const isTestAuthEnabled = isE2eModeEnabled || (__DEV__ && !isDevTestAuthDisabled);
  const defaultTestUserId = isE2eModeEnabled
    ? e2ePrimaryUserId
    : process.env.EXPO_PUBLIC_BOOKMARKS_DEV_TEST_USER || 'dev-user';

  useEffect(() => {
    if (hasGoogleClientConfiguration) {
      return;
    }

    console.warn(
      'Google sign in is not configured. Set EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID (and optionally EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID) in apps/mobile/.env.'
    );
  }, [hasGoogleClientConfiguration]);

  useEffect(() => {
    const bootstrapUser = async () => {
      try {
        const [storedUser, storedSession] = await Promise.all([
          loadStoredUserFromDb(),
          loadAuthSession(),
        ]);

        if (storedUser) {
          if (storedSession && storedSession.userId !== storedUser.id) {
            await clearAuthSession();
          }

          setActiveUserId(storedUser.id);
          setUser(storedUser);

          if (!isE2eModeEnabled) {
            void syncAuthenticatedData().catch((error) => {
              console.error('Error running initial authenticated sync:', error);
            });
          }
        } else {
          await clearAuthSession();
          resetActiveUserId();
        }
      } catch (error) {
        console.error('Error loading user:', error);
        await clearAuthSession();
        resetActiveUserId();
      } finally {
        setIsLoading(false);
      }
    };

    void bootstrapUser();
  }, []);

  const exchangeBackendSession = async (
    userData: AuthenticatedUser,
    identityToken: string
  ): Promise<AuthenticatedUser> => {
    const sessionResponse = await authClient.createSession({
      provider: userData.provider,
      providerUserId: userData.id,
      email: userData.email,
      name: userData.name,
      avatarUrl: userData.picture,
      identityToken,
    });

    await saveAuthSessionEnvelope(sessionResponse.session);

    return {
      id: sessionResponse.user.id,
      email: sessionResponse.user.email,
      name: sessionResponse.user.name ?? userData.name,
      picture: sessionResponse.user.avatarUrl ?? userData.picture,
      provider: sessionResponse.user.provider === 'apple' ? 'apple' : 'google',
    };
  };

  const saveUser = async (userData: AuthenticatedUser, identityToken: string): Promise<void> => {
    try {
      const authenticatedUser = await exchangeBackendSession(userData, identityToken);

      await persistUser(authenticatedUser);
      await migrateGuestDataToUser(authenticatedUser.id);
      setActiveUserId(authenticatedUser.id);
      setUser(authenticatedUser);

      if (!isE2eModeEnabled) {
        void syncAuthenticatedData().catch((error) => {
          console.error('Error running post-login sync:', error);
        });
      }
    } catch (error) {
      console.error('Error saving user:', error);
      await clearAuthSession();
      throw error;
    }
  };

  const signInWithGoogle = async (): Promise<void> => {
    if (!hasGoogleClientConfiguration) {
      throw new Error('Google sign in is not configured. Missing Google OAuth client IDs.');
    }

    try {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const signInResult = await GoogleSignin.signIn();

      const userInfo = signInResult.data;
      if (!userInfo || !userInfo.user) {
        throw new Error('Google sign in succeeded but no user data was returned.');
      }

      const googleUser = userInfo.user;

      // Get the access token to send to the backend for verification
      const tokens = await GoogleSignin.getTokens();
      const accessToken = tokens.accessToken;

      if (!accessToken) {
        throw new Error('Google sign in succeeded but no access token was returned.');
      }

      const userData: AuthenticatedUser = {
        id: googleUser.id,
        email: googleUser.email ?? null,
        name: googleUser.name ?? 'Google User',
        picture: googleUser.photo ?? null,
        provider: 'google',
      };

      await saveUser(userData, accessToken);
    } catch (error) {
      if (isErrorWithCode(error)) {
        if (error.code === statusCodes.SIGN_IN_CANCELLED) {
          console.log('Google sign in canceled');
          return;
        }

        if (error.code === statusCodes.IN_PROGRESS) {
          console.log('Google sign in already in progress');
          return;
        }

        if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
          console.error('Google Play Services not available or outdated');
          throw new Error('Google Play Services is required for Google sign in.');
        }
      }

      console.error('Google sign in error:', error);
      throw error;
    }
  };

  const signInWithApple = async (): Promise<void> => {
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      const givenName = credential.fullName?.givenName ?? '';
      const familyName = credential.fullName?.familyName ?? '';
      const fallbackName = `${givenName} ${familyName}`.trim() || 'Apple User';

      const identityToken = credential.identityToken;

      if (!identityToken) {
        throw new Error('Apple sign in succeeded but no identity token was returned.');
      }

      const userData: AuthenticatedUser = {
        id: credential.user,
        email: credential.email ?? null,
        name: fallbackName,
        picture: null,
        provider: 'apple',
      };

      await saveUser(userData, identityToken);
    } catch (error) {
      const maybeCode = (error as { code?: string }).code;

      if (maybeCode === 'ERR_CANCELED') {
        console.log('Apple sign in canceled');
        return;
      }

      console.error('Apple sign in error:', error);
      throw error;
    }
  };

  const signInWithTestUser = async (userId: string): Promise<void> => {
    if (!isTestAuthEnabled) {
      throw new Error('Test-user sign in is only available in e2e or development mode.');
    }

    const normalizedUserId = userId.trim();

    if (!normalizedUserId) {
      throw new Error('Test-user sign in requires a non-empty user ID.');
    }

    try {
      const sessionResponse = await authClient.createSession({
        provider: 'test',
        providerUserId: normalizedUserId,
        email: `${normalizedUserId}@bookmarks.test`,
        name: normalizedUserId,
        avatarUrl: null,
        identityToken: buildInsecureTestIdentityToken(normalizedUserId),
      });

      await saveAuthSessionEnvelope(sessionResponse.session);

      const authenticatedUser: AuthenticatedUser = {
        id: sessionResponse.user.id,
        email: sessionResponse.user.email,
        name: sessionResponse.user.name ?? normalizedUserId,
        picture: sessionResponse.user.avatarUrl,
        provider: 'google',
      };

      await persistUser(authenticatedUser);
      await migrateGuestDataToUser(authenticatedUser.id);
      setActiveUserId(authenticatedUser.id);
      setUser(authenticatedUser);

      if (!isE2eModeEnabled) {
        try {
          await syncAuthenticatedData();
        } catch (error) {
          console.error('Error running test-user sync:', error);
        }
      }
    } catch (error) {
      console.error('Error signing in test user:', error);
      await clearAuthSession();
      throw error;
    }
  };

  const signOut = async (): Promise<void> => {
    try {
      const session = await loadAuthSession();

      if (session) {
        try {
          await authClient.revokeSession({ refreshToken: session.refreshToken });
        } catch (error) {
          console.warn('Unable to revoke backend auth session during sign out:', error);
        }
      }

      // Sign out of native Google session if active
      try {
        await GoogleSignin.signOut();
      } catch {
        // Ignore — user may not have signed in with Google
      }

      await wipeLocalDataOnSignOut(undefined, { wipeDatabase: true });
      await clearAuthSession();
      resetActiveUserId();
      setUser(null);
    } catch (error) {
      console.error('Error signing out:', error);
      throw error;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: Boolean(user),
        isE2eMode: isE2eModeEnabled,
        isTestAuthEnabled,
        defaultTestUserId,
        signInWithGoogle,
        signInWithApple,
        signInWithTestUser,
        signOut,
        googleAuthRequest: hasGoogleClientConfiguration ? {} : null,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  return context;
};

export default AuthContext;
