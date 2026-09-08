import { useRoomStore } from '../stores/useRoomStore';
import { motion, AnimatePresence } from 'motion/react';
import { useEffect } from 'react';

export default function ReactionLayer() {
  const reactions = useRoomStore(state => state.reactions);
  const removeReaction = useRoomStore(state => state.removeReaction);

  useEffect(() => {
    // Auto cleanup old reactions
    const interval = setInterval(() => {
      const now = Date.now();
      // Reactions shouldn't live more than a few seconds, but we clean them based on ID parsing if we embedded timestamp, 
      // or just remove the oldest if there are too many.
      // Since motion handles exit animation, we can just remove them after 2.5s
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="absolute inset-0 pointer-events-none z-50 overflow-hidden">
      <AnimatePresence>
        {reactions.map((r) => (
          <motion.div
            key={r.id}
            initial={{ opacity: 0, y: 50, scale: 0.5, x: `${r.x}vw` }}
            animate={{ opacity: 1, y: -200, scale: 1.5, x: `${r.x + (Math.random() * 5 - 2.5)}vw` }}
            exit={{ opacity: 0, scale: 2 }}
            transition={{ duration: 2.5, ease: "easeOut" }}
            onAnimationComplete={() => removeReaction(r.id)}
            className="absolute bottom-10 text-4xl drop-shadow-lg"
            style={{ left: '0' }}
          >
            {r.reaction}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
