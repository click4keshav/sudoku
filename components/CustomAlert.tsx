import React from 'react';
import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';

type CustomAlertProps = {
  visible: boolean;
  title: string;
  message: string;
  theme: any;
  buttons: {
    text: string;
    onPress: () => void;
    style?: 'default' | 'cancel' | 'destructive';
  }[];
  onClose: () => void;
};

export default function CustomAlert({
  visible,
  title,
  message,
  theme,
  buttons,
  onClose,
}: CustomAlertProps) {
  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={[styles.box, { backgroundColor: theme.cardBg, borderColor: theme.blockBg }]}>
          <Text style={[styles.title, { color: theme.textPrimary }]}>{title}</Text>
          <Text style={[styles.message, { color: theme.textSecondary }]}>{message}</Text>

          <View style={styles.buttonRow}>
            {buttons.map((btn, index) => {
              let btnBg = 'transparent';
              let textColor = theme.userText;

              if (btn.style === 'destructive') {
                textColor = '#EF4444';
              } else if (btn.style === 'cancel') {
                textColor = theme.textSecondary;
              }

              return (
                <Pressable
                  key={index}
                  style={[styles.button, { backgroundColor: btnBg }] }
                  onPress={() => {
                    btn.onPress();
                    onClose();
                  }}
                >
                  <Text style={[styles.buttonText, { color: textColor }]}>
                    {btn.text}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  box: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 8,
    textAlign: 'center',
  },
  message: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  button: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '700',
  },
});