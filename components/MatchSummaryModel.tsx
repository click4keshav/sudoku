import React from 'react';
import { Modal, View, Text, Pressable, StyleSheet, Share } from 'react-native';

type MatchSummaryProps = {
  visible: boolean;
  isWon: boolean;
  timeSeconds: number;
  mistakes: number;
  hintsUsed: number;
  scoreEarned: number;
  isDaily: boolean;
  dailyDate?: string;
  theme: any;
  onHome: () => void;
  onPlayAgain: () => void;
};

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export default function MatchSummaryModal({
  visible,
  isWon,
  timeSeconds,
  mistakes,
  hintsUsed,
  scoreEarned,
  isDaily,
  dailyDate,
  theme,
  onHome,
  onPlayAgain,
}: MatchSummaryProps) {
  if (!visible) return null;

  const handleShare = () => {
    const text = `🧩 Sudoku Player ${isDaily ? `Daily Challenge (${dailyDate})` : 'Puzzle Completed'}\n⏱️ Time: ${formatTime(timeSeconds)}\n⚡ Score: +${scoreEarned} XP\n🎯 Mistakes: ${mistakes} | Hints: ${hintsUsed}\n\nPlay at: https://ramcraft.app`;
    Share.share({ message: text });
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: theme.cardBg, borderColor: theme.blockBg }]}>
          <Text style={styles.trophyEmoji}>{isWon ? '🎉' : '❌'}</Text>
          <Text style={[styles.title, { color: theme.textPrimary }]}>
            {isWon ? (isDaily ? 'Daily Challenge Solved!' : 'Victory!') : 'Game Over'}
          </Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
            {isWon ? 'Outstanding performance!' : 'Better luck next time!'}
          </Text>

          <View style={[styles.statsBox, { backgroundColor: theme.appBg }]}>
            <View style={styles.statRow}>
              <Text style={[styles.statLabel, { color: theme.textSecondary }]}>Time Taken</Text>
              <Text style={[styles.statVal, { color: theme.textPrimary }]}>{formatTime(timeSeconds)}</Text>
            </View>
            <View style={styles.statRow}>
              <Text style={[styles.statLabel, { color: theme.textSecondary }]}>Mistakes Made</Text>
              <Text style={[styles.statVal, { color: theme.textPrimary }]}>{mistakes}</Text>
            </View>
            <View style={styles.statRow}>
              <Text style={[styles.statLabel, { color: theme.textSecondary }]}>Hints Used</Text>
              <Text style={[styles.statVal, { color: theme.textPrimary }]}>{hintsUsed}</Text>
            </View>
            {isWon && (
              <View style={[styles.statRow, { borderBottomWidth: 0 }]}>
                <Text style={[styles.statLabel, { color: theme.textSecondary }]}>XP Earned</Text>
                <Text style={[styles.statVal, { color: '#EAB308' }]}>+{scoreEarned} XP</Text>
              </View>
            )}
          </View>

          {isWon && (
            <Pressable style={[styles.shareBtn, { backgroundColor: '#3B82F6' }]} onPress={handleShare}>
              <Text style={styles.shareBtnText}>📤 Share Match Result</Text>
            </Pressable>
          )}

          <View style={styles.btnRow}>
            <Pressable style={[styles.actionBtn, { backgroundColor: theme.appBg }]} onPress={onHome}>
              <Text style={[styles.actionBtnText, { color: theme.textPrimary }]}>Home</Text>
            </Pressable>
            <Pressable style={[styles.actionBtn, { backgroundColor: theme.accentBtn }]} onPress={onPlayAgain}>
              <Text style={[styles.actionBtnText, { color: '#FFFFFF' }]}>Play Again</Text>
            </Pressable>
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
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    elevation: 10,
  },
  trophyEmoji: {
    fontSize: 48,
    marginBottom: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 13,
    marginTop: 2,
    marginBottom: 16,
    textAlign: 'center',
  },
  statsBox: {
    width: '100%',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(128,128,128,0.15)',
  },
  statLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  statVal: {
    fontSize: 14,
    fontWeight: '700',
  },
  shareBtn: {
    width: '100%',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 10,
  },
  shareBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  btnRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  actionBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
});