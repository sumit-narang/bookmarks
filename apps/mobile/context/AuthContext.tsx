/**
 * AuthContext - Manages authentication state.
 * Supports Google and Apple Sign In with SQLite-backed session persistence.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import * as Google from 'expo-auth-session/providers/google';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as WebBrowser from 'expo-web-browser';
import { wipeLocalDataOnSignOut } from '../data/localPersistence';
import {
  loadStoredUser as loadStoredUserFromDb,
  migrateGuestDataToUser,
  saveUser as persistUser,
} from '../data/userStorage';
import { resetActiveUserId, setActiveUserId } from '../data/runtimeSession';
import type { AuthenticatedUser } from '../data/types';

WebBrowser.maybeCompleteAuthSession();

interface AuthContextValue {
  user: AuthenticatedUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
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

  const [request, response, promptAsync] = Google.useAuthRequest({
    clientId: 'YOUR_EXPO_CLIENT_ID.apps.googleusercontent.com',
    iosClientId: 'YOUR_IOS_CLIENT_ID.apps.googleusercontent.com',
    androidClientId: 'YOUR_ANDROID_CLIENT_ID.apps.googleusercontent.com',
    webClientId: 'YOUR_WEB_CLIENT_ID.apps.googleusercontent.com',
  });

  useEffect(() => {
    const bootstrapUser = async () => {
      try {
        const storedUser = await loadStoredUserFromDb();

        if (storedUser) {
          setActiveUserId(storedUser.id);
          setUser(storedUser);
        } else {
          resetActiveUserId();
        }
      } catch (error) {
        console.error('Error loading user:', error);
        resetActiveUserId();
      } finally {
        setIsLoading(false);
      }
    };

    void bootstrapUser();
  }, []);

  useEffect(() => {
    if (response?.type !== 'success') {
      return;
    }

    const accessToken = response.authentication?.accessToken;

    if (!accessToken) {
      console.error('Google auth succeeded but no access token was returned.');
      return;
    }

    void fetchGoogleUserInfo(accessToken);
  }, [response]);

  const saveUser = async (userData: AuthenticatedUser): Promise<void> => {
    try {
      await persistUser(userData);
      await migrateGuestDataToUser(userData.id);
      setActiveUserId(userData.id);
      setUser(userData);
    } catch (error) {
      console.error('Error saving user:', error);
      throw error;
    }
  };

  const fetchGoogleUserInfo = async (accessToken: string): Promise<void> => {
    try {
      const responseValue = await fetch('https://www.googleapis.com/userinfo/v2/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const userInfo = (await responseValue.json()) as {
        id?: string;
        email?: string;
        name?: string;
        picture?: string;
      };

      if (!userInfo.id) {
        throw new Error('Google user info response is missing id.');
      }

      const userData: AuthenticatedUser = {
        id: userInfo.id,
        email: userInfo.email ?? null,
        name: userInfo.name ?? 'Google User',
        picture: userInfo.picture ?? null,
        provider: 'google',
      };

      await saveUser(userData);
    } catch (error) {
      console.error('Error fetching Google user info:', error);
    }
  };

  const signInWithGoogle = async (): Promise<void> => {
    try {
      await promptAsync();
    } catch (error) {
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

      const userData: AuthenticatedUser = {
        id: credential.user,
        email: credential.email ?? null,
        name: fallbackName,
        picture: null,
        provider: 'apple',
      };

      await saveUser(userData);
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

  const signOut = async (): Promise<void> => {
    try {
      await wipeLocalDataOnSignOut(undefined, { wipeDatabase: true });
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
        signInWithGoogle,
        signInWithApple,
        signOut,
        googleAuthRequest: request,
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
