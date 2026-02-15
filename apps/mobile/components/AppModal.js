/**
 * AppModal - Reusable modal component with consistent styling
 *
 * Props:
 * - visible: boolean - controls modal visibility
 * - onClose: function - called when modal should close
 * - title: string - modal heading text
 * - children: ReactNode - modal content
 */

import { Modal, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import CrossIcon from '../assets/icons/modal-cross-icon.svg';

const AppModal = ({ visible, onClose, title, children }) => {
  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.backdrop}
        activeOpacity={1}
        onPress={onClose}
      >
        <TouchableOpacity
          style={styles.modal}
          activeOpacity={1}
          onPress={(e) => e.stopPropagation()}
        >
          {/* Header with title and close button */}
          <View style={styles.header}>
            <Text style={styles.heading}>{title}</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <CrossIcon width={32} height={32} />
            </TouchableOpacity>
          </View>

          {/* Content */}
          <View style={styles.contentContainer}>
            {children}
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(8, 8, 8, 0.80)',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingBottom: 34,
  },

  modal: {
    backgroundColor: '#232323',
    borderRadius: 34,
    padding: 18,
    width: '100%',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  heading: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: -0.4,
    flex: 1,
  },

  closeButton: {
    marginLeft: 12,
  },

  contentContainer: {
    marginTop: 24,
  },
});

export default AppModal;
