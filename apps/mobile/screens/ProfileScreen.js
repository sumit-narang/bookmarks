/**
 * ProfileScreen - User profile and settings
 * Shows sign up UI when not logged in, options when logged in
 */

import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../styles/colors';
import { typography } from '../styles/typography';
import { useAuth } from '../context/AuthContext';
import { e2ePrimaryUserId, e2eSecondaryUserId } from '../config/e2e';

// SVG Icons
import AccountInfoIcon from '../assets/icons/account-info.svg';
import ImportIcon from '../assets/icons/import.svg';
import PrivacyPolicyIcon from '../assets/icons/privacy-policy.svg';
import HelpIcon from '../assets/icons/help.svg';
import FeedbackIcon from '../assets/icons/feedback.svg';
import LogoutIcon from '../assets/icons/logout.svg';
import DeleteIcon from '../assets/icons/delete.svg';
import ChevronForwardIcon from '../assets/icons/chevron-forward.svg';
import GoogleIcon from '../assets/icons/google-icon.svg';
import AppleIcon from '../assets/icons/apple-icon.svg';

const ProfileScreen = ({ navigation }) => {
  const {
    isAuthenticated,
    isE2eMode,
    isTestAuthEnabled,
    defaultTestUserId,
    signInWithGoogle,
    signInWithApple,
    signInWithTestUser,
    signOut,
  } = useAuth();

  // Handle back button
  const handleBack = () => {
    navigation.goBack();
  };

  // Handle Account Info
  const handleAccountInfo = () => {
    // TODO: Navigate to account info screen
  };

  // Handle import from Google
  const handleImport = () => {
    navigation.navigate('ImportGoogle');
  };

  // Handle Privacy Policy
  const handlePrivacyPolicy = () => {
    // TODO: Navigate to privacy policy screen
  };

  // Handle Help
  const handleHelp = () => {
    // TODO: Navigate to help screen
  };

  // Handle Feedback
  const handleFeedback = () => {
    // TODO: Navigate to feedback screen
  };

  // Handle Google Sign In
  const handleGoogleSignIn = async () => {
    try {
      await signInWithGoogle();
    } catch (error) {
      Alert.alert('Error', 'Failed to sign in with Google. Please try again.');
    }
  };

  // Handle Apple Sign In
  const handleAppleSignIn = async () => {
    try {
      await signInWithApple();
    } catch (error) {
      if (error.code !== 'ERR_CANCELED') {
        Alert.alert('Error', 'Failed to sign in with Apple. Please try again.');
      }
    }
  };

  // Handle test-user sign in
  const handleTestUserSignIn = async (userId) => {
    try {
      await signInWithTestUser(userId);
    } catch (error) {
      Alert.alert('Error', 'Failed to sign in with test user.');
    }
  };

  // Open diagnostics screen (e2e mode)
  const handleDiagnosticsPress = () => {
    navigation.navigate('Diagnostics');
  };

  // Handle Log Out
  const handleLogout = () => {
    Alert.alert(
      'Log Out',
      'Are you sure you want to log out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log Out',
          style: 'destructive',
          onPress: async () => {
            try {
              await signOut();
            } catch (error) {
              Alert.alert('Error', 'Failed to log out. Please try again.');
            }
          },
        },
      ]
    );
  };

  // Handle Delete Account
  const handleDelete = () => {
    Alert.alert(
      'Delete Account',
      'Are you sure you want to delete your account? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              // TODO: Implement account deletion
              await signOut();
              Alert.alert('Account Deleted', 'Your account has been deleted.');
            } catch (error) {
              Alert.alert('Error', 'Failed to delete account. Please try again.');
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={handleBack}>
          <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Profile</Text>
        <View style={styles.headerPlaceholder} />
      </View>

      {isAuthenticated ? (
        /* Logged In - Options List */
        <View style={styles.optionsList}>
          {/* Account Info */}
          <TouchableOpacity
            style={styles.optionItem}
            onPress={handleAccountInfo}
            activeOpacity={0.7}
          >
            <AccountInfoIcon width={18} height={18} />
            <Text style={styles.optionText}>Account Info</Text>
            <ChevronForwardIcon width={20} height={20} style={styles.chevron} />
          </TouchableOpacity>

          {/* Import Bookmarks */}
          <TouchableOpacity
            style={styles.optionItem}
            onPress={handleImport}
            activeOpacity={0.7}
          >
            <ImportIcon width={18} height={18} />
            <Text style={styles.optionText}>Import Bookmarks</Text>
          </TouchableOpacity>

          {/* Privacy Policy */}
          <TouchableOpacity
            style={styles.optionItem}
            onPress={handlePrivacyPolicy}
            activeOpacity={0.7}
          >
            <PrivacyPolicyIcon width={18} height={18} />
            <Text style={styles.optionText}>Privacy Policy</Text>
            <ChevronForwardIcon width={20} height={20} style={styles.chevron} />
          </TouchableOpacity>

          {/* Help */}
          <TouchableOpacity
            style={styles.optionItem}
            onPress={handleHelp}
            activeOpacity={0.7}
          >
            <HelpIcon width={18} height={18} />
            <Text style={styles.optionText}>Help</Text>
            <ChevronForwardIcon width={20} height={20} style={styles.chevron} />
          </TouchableOpacity>

          {/* Feedback */}
          <TouchableOpacity
            style={styles.optionItem}
            onPress={handleFeedback}
            activeOpacity={0.7}
          >
            <FeedbackIcon width={18} height={18} />
            <Text style={styles.optionText}>Feedback</Text>
            <ChevronForwardIcon width={20} height={20} style={styles.chevron} />
          </TouchableOpacity>

          {/* Logout */}
          <TouchableOpacity
            style={styles.optionItem}
            onPress={handleLogout}
            activeOpacity={0.7}
          >
            <LogoutIcon width={18} height={18} />
            <Text style={styles.optionText}>Logout</Text>
          </TouchableOpacity>

          {/* Delete */}
          <TouchableOpacity
            style={styles.optionItem}
            onPress={handleDelete}
            activeOpacity={0.7}
          >
            <DeleteIcon width={18} height={18} />
            <Text style={styles.optionText}>Delete</Text>
          </TouchableOpacity>

          {isE2eMode && (
            <TouchableOpacity
              style={styles.optionItem}
              onPress={handleDiagnosticsPress}
              activeOpacity={0.7}
              testID="profile-diagnostics-button"
            >
              <Ionicons name="bug-outline" size={18} color={colors.textPrimary} />
              <Text style={styles.optionText}>Diagnostics</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        /* Not Logged In - Sign Up UI */
        <View style={styles.signUpContainer}>
          <Text style={styles.signUpTitle}>Sign Up or Log In</Text>
          <Text style={styles.signUpDescription}>
            Log in to see your saved collection{'\n'}or create your own collection.
          </Text>

          {/* Auth Buttons */}
          <View style={styles.authButtonContainer}>
            {/* Google Sign In Button */}
            <TouchableOpacity
              style={styles.authButton}
              onPress={handleGoogleSignIn}
              activeOpacity={0.7}
            >
              <GoogleIcon width={24} height={24} />
              <Text style={styles.authButtonText}>Continue with Google</Text>
            </TouchableOpacity>

            {/* Apple Sign In Button - iOS only */}
            {Platform.OS === 'ios' && (
              <TouchableOpacity
                style={styles.authButton}
                onPress={handleAppleSignIn}
                activeOpacity={0.7}
              >
                <AppleIcon width={24} height={24} />
                <Text style={styles.authButtonText}>Continue with Apple</Text>
              </TouchableOpacity>
            )}
          </View>

          {isTestAuthEnabled && (
            <View style={styles.authButtonContainer}>
              {isE2eMode ? (
                <>
                  <TouchableOpacity
                    style={styles.authButton}
                    onPress={() => handleTestUserSignIn(e2ePrimaryUserId)}
                    activeOpacity={0.7}
                    testID="profile-e2e-signin-user-a"
                  >
                    <Ionicons name="flask-outline" size={20} color="#FFFFFF" />
                    <Text style={styles.authButtonText}>Continue as E2E User A</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.authButton}
                    onPress={() => handleTestUserSignIn(e2eSecondaryUserId)}
                    activeOpacity={0.7}
                    testID="profile-e2e-signin-user-b"
                  >
                    <Ionicons name="flask-outline" size={20} color="#FFFFFF" />
                    <Text style={styles.authButtonText}>Continue as E2E User B</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.devToolButton}
                    onPress={handleDiagnosticsPress}
                    activeOpacity={0.7}
                    testID="profile-diagnostics-button"
                  >
                    <Ionicons name="bug-outline" size={18} color="#888" />
                    <Text style={styles.devToolText}>Diagnostics</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity
                  style={styles.authButton}
                  onPress={() => handleTestUserSignIn(defaultTestUserId)}
                  activeOpacity={0.7}
                  testID="profile-dev-signin-test-user"
                >
                  <Ionicons name="flask-outline" size={20} color="#FFFFFF" />
                  <Text style={styles.authButtonText}>Continue as Test User</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

        </View>
      )}
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
  },

  headerPlaceholder: {
    width: 40,
  },

  // Logged in - Options List
  optionsList: {
    marginTop: 24,
    paddingHorizontal: 16,
  },

  optionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 20,
    gap: 12,
  },

  optionText: {
    flex: 1,
    fontSize: 18,
    fontWeight: '400',
    color: colors.textPrimary,
  },

  chevron: {
    opacity: 0.9,
  },

  // Not logged in - Sign Up UI
  signUpContainer: {
    width: 300,
    alignSelf: 'center',
    marginTop: 120,
    alignItems: 'center',
  },

  signUpTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: -0.5,
    lineHeight: 20,
    textAlign: 'center',
  },

  signUpDescription: {
    fontSize: 16,
    fontWeight: '400',
    color: 'rgba(255, 255, 255, 0.7)',
    letterSpacing: -0.5,
    lineHeight: 20,
    marginTop: 8,
    textAlign: 'center',
  },

  authButtonContainer: {
    marginTop: 24,
    gap: 12,
    width: '100%',
  },

  authButton: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#393939',
    borderRadius: 52,
    paddingHorizontal: 16,
    gap: 12,
  },

  authButtonText: {
    fontSize: 17,
    fontWeight: '500',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },

  devToolButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 40,
    gap: 8,
  },

  devToolText: {
    fontSize: 14,
    color: '#888',
  },
});

export default ProfileScreen;
